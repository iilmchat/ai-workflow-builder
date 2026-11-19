/**
 * Гейт согласованности реестра KI (RULES 3.20/3.21).
 *
 * Проверяет, что число заголовков `### KI-NNN` совпадает с числом строк
 * статуса, и что сводная таблица в конце файла не расходится с фактом.
 * Вызывается в CI до тестов — расхождение не должно попадать в main.
 */
import fs from 'node:fs';

const file = 'docs/KNOWN_ISSUES.md';
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

/** Число секций реестра. */
const sections = lines.filter((line) => /^### KI-\d+/.test(line)).length;

/** Статусы по строкам (только записи реестра, не легенда/проза). */
const counts = {};
for (const line of lines) {
  const match = line.match(
    /^- \*\*Приоритет:\*\*[^\n]*\*\*Статус:\*\*\s*([^|\n]+?)\s*\|/,
  );
  if (!match) continue;
  const key = match[1].trim();
  counts[key] = (counts[key] ?? 0) + 1;
}

const statusSum = Object.values(counts).reduce((sum, value) => sum + value, 0);
const problems = [];

if (sections === 0) {
  problems.push('не найдено ни одной секции KI');
}
if (sections !== statusSum) {
  problems.push(`заголовков ${sections}, строк статуса ${statusSum}`);
}

// Только финальная секция «Сводка по статусам» — в файле есть исторические
// таблицы с такими же названиями статусов (например, v0.1.0 Planned).
const summaryStart = lines.findIndex((line) => line.trim() === '## Сводка по статусам');
if (summaryStart === -1) {
  problems.push('не найдена секция «Сводка по статусам»');
} else {
  const summary = lines.slice(summaryStart).join('\n');
  const totalMatch = summary.match(/\*\*Итого\*\*\s*\|\s*\*\*(\d+)\*\*/);

  if (!totalMatch) {
    problems.push('не найдена строка **Итого** в сводке по статусам');
  } else if (Number(totalMatch[1]) !== statusSum) {
    problems.push(`в сводке ${totalMatch[1]}, фактически ${statusSum}`);
  }

  // KI-671: проверяем ВСЕ строки сводки, включая статусы с нулевым счётом.
  // Раньше итерация шла по факту (counts), поэтому «Open | 4» при Open=0
  // оставалась незамеченной.
  const summaryRows = [...summary.matchAll(/^\| ([^|*][^|]*?) \| (\d+) \|$/gm)];

  for (const [, rawStatus, rawCount] of summaryRows) {
    const status = rawStatus.trim();
    const actual = counts[status] ?? 0;

    if (Number(rawCount) !== actual) {
      problems.push(
        `строка «${status}»: ${rawCount} в сводке, фактически ${actual}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`KNOWN_ISSUES: расхождения (RULES 3.20):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

console.log(`KNOWN_ISSUES OK: ${sections} KI, ${statusSum} статусов, сводка сходится`);
