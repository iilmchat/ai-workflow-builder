/**
 * Паритет-гейт `ReasoningEffort`: backend ↔ frontend (KI-249).
 *
 * До KI-249 один и тот же набор режимов хранился в трёх местах: backend-тип,
 * фронтенд-константа валидации и inline-union в `web/src/types/graph.ts`.
 * После расширения union в KI-246 бэк знал шесть режимов, а фронт — только три,
 * поэтому `validateReasoningEffort()` молча выбрасывал `minimal`/`low`/`xhigh`
 * при загрузке графа из БД. Теперь у фронта один источник (`REASONING_EFFORTS`,
 * от него же тип в `types/graph.ts`), а этот spec сверяет его с backend-типом.
 *
 * Приём тот же, что в `src/runs/dto/api-contract.spec.ts`: исходники читаются
 * как текст, а литералы извлекаются регуляркой. Если файл переименован или
 * формат объявления изменён — тест падает с понятным сообщением, а не
 * «зеленеет» на пустом списке. Пути строятся от `import.meta.url`, а не от
 * `process.cwd()` (RULES 1.9).
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Каталог этого spec'а (`src/llm`). */
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));

/** Путь к backend-типу. */
const BACKEND_PATH = join(SPEC_DIR, 'llm-provider.interface.ts');

/** Путь к фронтенд-константе (web — отдельный пакет в том же репозитории). */
const FRONTEND_PATH = join(
  SPEC_DIR,
  '..',
  '..',
  'web',
  'src',
  'lib',
  'llm-node-fields.ts',
);

/**
 * Извлекает строковые литералы из объявления по регулярке.
 *
 * @param source - текст исходника
 * @param pattern - регулярка с одной группой, содержащей литералы
 * @param label - путь к файлу для сообщения об ошибке
 * @returns отсортированный список литералов
 */
function extractLiterals(
  source: string,
  pattern: RegExp,
  label: string,
): string[] {
  const declaration = pattern.exec(source)?.[1];

  if (declaration === undefined) {
    throw new Error(`Не найдено объявление в ${label}`);
  }

  const literals = [...declaration.matchAll(/'([^']+)'/g)].map(
    (match) => match[1],
  );

  if (literals.length === 0) {
    throw new Error(`Не найдены строковые литералы в ${label}`);
  }

  return literals.sort();
}

/**
 * Читает исходник и извлекает из него литералы.
 *
 * @param path - путь к исходнику
 * @param label - путь для сообщения об ошибке
 * @param pattern - регулярка объявления
 * @returns отсортированный список литералов
 */
async function literalsFromAsync(
  path: string,
  label: string,
  pattern: RegExp,
): Promise<string[]> {
  return extractLiterals(await readFile(path, 'utf8'), pattern, label);
}

describe('паритет ReasoningEffort (KI-249)', () => {
  it('фронтенд-список валидации совпадает с backend-типом', async () => {
    const backend = await literalsFromAsync(
      BACKEND_PATH,
      'src/llm/llm-provider.interface.ts',
      /export type ReasoningEffort\s*=([^;]+);/,
    );
    const frontend = await literalsFromAsync(
      FRONTEND_PATH,
      'web/src/lib/llm-node-fields.ts',
      /export const REASONING_EFFORTS\s*=\s*\[([^\]]+)\]\s*as const;/,
    );

    expect(frontend).toEqual(backend);
  });
});
