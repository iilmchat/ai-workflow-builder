/**
 * Гейт локальных markdown-ссылок (KI-499).
 *
 * Проверяет только относительные ссылки на файлы: внешние URL, якоря и
 * почтовые адреса пропускаются. Вызывается в CI docs-only шагом.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/**
 * Активные документы — те, что поддерживаются вручную. Архивные промпты и
 * исторические отчёты содержат устаревшие пути и в гейт не входят (KI-499).
 */
const LIVE_FILES = [
  'README.md',
  'docs/README.md',
  'docs/CHANGELOG.md',
  'docs/KNOWN_ISSUES.md',
  'docs/development/RULES.md',
  'docs/development/SMOKE_CDP.md',
  'docs/development/reports/README.md',
];

const problems = [];

for (const relative of LIVE_FILES) {
  const file = path.join(ROOT, relative);

  if (!fs.existsSync(file)) {
    problems.push(`${relative}: файл не найден`);
    continue;
  }
  const text = fs.readFileSync(file, 'utf8');

  for (const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];

    if (
      target.startsWith('http://') ||
      target.startsWith('https://') ||
      target.startsWith('mailto:') ||
      target.startsWith('#')
    ) {
      continue;
    }

    const clean = decodeURIComponent(target.split('#')[0]);

    if (clean === '') {
      continue;
    }

    // Исторические корневые файлы (RELEASE_NOTES.md) писали ссылки «как из
    // docs/» — пробуем оба основания, чтобы не плодить ложные срабатывания.
    const candidates = [path.resolve(path.dirname(file), clean)];

    if (path.dirname(file) === ROOT && !clean.startsWith('/')) {
      candidates.push(path.resolve(ROOT, 'docs', clean));
    }

    const resolved = candidates.find((candidate) => fs.existsSync(candidate));

    if (resolved === undefined) {
      problems.push(`${path.relative(ROOT, file)} → ${target}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Markdown links: не найдено ${problems.length}:\n${problems.join('\n')}`);
  process.exit(1);
}

console.log('Markdown links OK');
