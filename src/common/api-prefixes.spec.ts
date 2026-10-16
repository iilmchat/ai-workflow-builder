/**
 * Тест-паритет: все `@Controller('...')` из `src/**` должны быть в реестре
 * `web/src/lib/api-prefixes.ts` (KI-299/072/120).
 *
 * Ловит забытый префикс, который иначе падал бы только в CDP-смоуке:
 * Vite отдаёт на непроксированный префикс SPA-fallback (`200 text/html`),
 * Zod не разбирает HTML, и падает конкретная вкладка (`/llm` → KI-072,
 * `/media` → KI-120, `/templates` → KI-299).
 *
 * Путь строится от `import.meta.url`, а не от `process.cwd()`: иначе spec
 * зависел бы от каталога запуска (RULES 1.9, ср. `template-loader.service.ts`).
 */
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Корень проекта: spec лежит в `src/common/`, то есть двумя уровнями ниже. */
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Реестр префиксов на frontend — источник правды для Vite-прокси. */
const REGISTRY_PATH = join(
  PROJECT_ROOT,
  'web',
  'src',
  'lib',
  'api-prefixes.ts',
);

/** Каталог backend-исходников. */
const SRC_DIR = join(PROJECT_ROOT, 'src');

/** Запись `prefix: 'xxx'` из реестра. */
const REGISTRY_ENTRY_RE = /prefix:\s*['"]([a-z][a-z0-9_-]*)['"]/g;

/** Полнострочный комментарий. */
const LINE_COMMENT_RE = /\/\/.*$/gm;

/** Блочный комментарий (включая JSDoc). */
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

/** `@Controller('xxx')` — префикс в кавычках. */
const CONTROLLER_PREFIX_RE = /@Controller\(\s*['"]([^'"]+)['"]/;

/** Любой `@Controller(` — чтобы отличить корневой контроллер от забытого. */
const CONTROLLER_ROOT_RE = /@Controller\(\s*\)/;

/** Объектная форма `@Controller({ path: '…' })` — разбор её не поддерживает. */
const CONTROLLER_OBJECT_RE = /@Controller\(\s*\{/;

/** Разобранный контроллер: файл и нормализованный префикс первого сегмента. */
interface ControllerInfo {
  /** Абсолютный путь к файлу контроллера. */
  readonly file: string;
  /** Первый сегмент `@Controller('...')` (`workflow/share` → `workflow`). */
  readonly prefix: string | null;
}

/**
 * Рекурсивно собирает пути файлов `*.controller.ts` под каталогом.
 *
 * @param dir - каталог для обхода
 * @returns абсолютные пути найденных контроллеров
 */
async function collectControllersAsync(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });

  const nested = await Promise.all(
    entries.map((entry) => {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        return collectControllersAsync(fullPath);
      }

      return Promise.resolve(
        entry.name.endsWith('.controller.ts') ? [fullPath] : [],
      );
    }),
  );

  return nested.flat();
}

/**
 * Убирает комментарии из исходника реестра.
 *
 * Без этого закомментированная запись (`// { prefix: 'templates' },`) считалась
 * бы объявленной, и spec молча пропустил бы удалённый префикс — проверено
 * негативным прогоном.
 *
 * @param source - текст `api-prefixes.ts`
 * @returns текст без блочных и строчных комментариев
 */
function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENT_RE, '').replace(LINE_COMMENT_RE, '');
}

/**
 * Читает реестр `web/src/lib/api-prefixes.ts` и извлекает префиксы.
 *
 * @returns префиксы из массива `API_PREFIXES`
 */
async function readRegistryPrefixesAsync(): Promise<string[]> {
  const source = await readFile(REGISTRY_PATH, 'utf8');

  return [...stripComments(source).matchAll(REGISTRY_ENTRY_RE)].map(
    (match) => match[1],
  );
}

/**
 * Разбирает контроллеры: префикс — первый сегмент пути декоратора.
 *
 * `@Controller()` (корневой, `GET /`) даёт `prefix: null` — это не API-префикс,
 * отдельная проверка следит, что таких контроллеров ровно один.
 *
 * @returns разобранные контроллеры в порядке обхода `src`
 */
async function parseControllersAsync(): Promise<ControllerInfo[]> {
  const files = await collectControllersAsync(SRC_DIR);

  return Promise.all(
    files.map(async (file) => {
      const source = await readFile(file, 'utf8');
      const match = source.match(CONTROLLER_PREFIX_RE);

      if (match) {
        return { file, prefix: match[1].split('/')[0] };
      }

      if (CONTROLLER_OBJECT_RE.test(source)) {
        throw new Error(
          `Объектная форма @Controller({ path: … }) не разобрана: ${file} — ` +
            "используй @Controller('…') или расширь spec",
        );
      }

      if (CONTROLLER_ROOT_RE.test(source)) {
        // Корневой `@Controller()` — не API-префикс (проверяется отдельно).
        return { file, prefix: null };
      }

      // Контроллер без распознанного декоратора — разбор молча пропустил бы
      // его, поэтому падаем явно.
      throw new Error(`Не разобран @Controller в ${file}`);
    }),
  );
}

/**
 * Находит префиксы контроллеров, которых нет в реестре.
 *
 * @param controllerPrefixes - префиксы из `@Controller('...')`
 * @param registryPrefixes - префиксы из `API_PREFIXES`
 * @returns забытые префиксы (по одному разу, в порядке появления)
 */
function findMissingPrefixes(
  controllerPrefixes: readonly string[],
  registryPrefixes: readonly string[],
): string[] {
  const known = new Set(registryPrefixes);

  return [...new Set(controllerPrefixes)].filter(
    (prefix) => !known.has(prefix),
  );
}

/**
 * Находит записи реестра, под которые нет контроллера.
 *
 * @param registryPrefixes - префиксы из `API_PREFIXES`
 * @param controllerPrefixes - префиксы из `@Controller('...')`
 * @returns лишние записи реестра (по одной, в порядке появления)
 */
function findOrphanPrefixes(
  registryPrefixes: readonly string[],
  controllerPrefixes: readonly string[],
): string[] {
  const known = new Set(controllerPrefixes);

  return [...new Set(registryPrefixes)].filter((prefix) => !known.has(prefix));
}

describe('API_PREFIXES: паритет с @Controller (KI-299/072/120)', () => {
  it('каждый @Controller-префикс есть в реестре web/src/lib/api-prefixes.ts', async () => {
    const controllers = await parseControllersAsync();
    const registryPrefixes = await readRegistryPrefixesAsync();
    const controllerPrefixes = controllers
      .map((controller) => controller.prefix)
      .filter((prefix): prefix is string => prefix !== null);
    const missing = findMissingPrefixes(controllerPrefixes, registryPrefixes);

    expect(
      missing,
      `Забыли добавить '${missing[0]}' в web/src/lib/api-prefixes.ts`,
    ).toEqual([]);
    expect(controllerPrefixes).toContain('workflow');
    expect(controllerPrefixes).toContain('runs');
  });

  it('в реестре нет префиксов без контроллера', async () => {
    const controllers = await parseControllersAsync();
    const registryPrefixes = await readRegistryPrefixesAsync();
    const controllerPrefixes = controllers
      .map((controller) => controller.prefix)
      .filter((prefix): prefix is string => prefix !== null);
    const orphans = findOrphanPrefixes(registryPrefixes, controllerPrefixes);

    expect(
      orphans,
      'Прокси ведёт в никуда: контроллера для префикса нет',
    ).toEqual([]);
  });

  it('детектор ловит забытый префикс (негативная проверка)', () => {
    expect(findMissingPrefixes(['workflow', 'brandnew'], ['workflow'])).toEqual(
      ['brandnew'],
    );
    expect(findMissingPrefixes(['workflow'], ['workflow'])).toEqual([]);
    expect(findOrphanPrefixes(['workflow', 'ghost'], ['workflow'])).toEqual([
      'ghost',
    ]);
  });

  it('закомментированная запись реестра не считается объявленным префиксом', () => {
    const source = [
      "// { prefix: 'templates' },",
      "{ prefix: 'llm' },",
      "/** prefix: 'ghost' */",
    ].join('\n');
    const parsed = [...stripComments(source).matchAll(REGISTRY_ENTRY_RE)].map(
      (match) => match[1],
    );

    expect(parsed).toEqual(['llm']);
  });

  it('корневой @Controller() (GET /) не считается API-префиксом', async () => {
    const controllers = await parseControllersAsync();
    const rootControllers = controllers.filter(
      (controller) => controller.prefix === null,
    );

    expect(
      rootControllers.map((controller) => basename(controller.file)),
    ).toEqual(['app.controller.ts']);
    expect(controllers.map((controller) => controller.prefix)).not.toContain(
      '',
    );
  });

  it('реестр не пустой и содержит префиксы трёх «забытых» KI', async () => {
    const registryPrefixes = await readRegistryPrefixesAsync();

    expect(registryPrefixes.length).toBeGreaterThanOrEqual(7);
    expect(registryPrefixes).toContain('llm');
    expect(registryPrefixes).toContain('media');
    expect(registryPrefixes).toContain('templates');
    expect(new Set(registryPrefixes).size).toBe(registryPrefixes.length);
  });
});
