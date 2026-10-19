/**
 * Тест-паритет: все `@Controller('...')` из `src/**` должны быть в едином
 * реестре `api-prefixes.json` в корне репозитория (KI-299/072/120/472).
 *
 * С v0.10.2 источник правды по префиксам один — `api-prefixes.json`. Его
 * читают backend (`src/common/api-prefixes.ts`) и frontend
 * (`web/src/lib/api-prefixes.ts`), поэтому spec парсит JSON напрямую, а не
 * текст frontend-модуля (раньше префиксы искались регуляркой по `prefix:`).
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

/** Единый реестр API-префиксов — источник правды для backend и Vite-прокси. */
const REGISTRY_PATH = join(PROJECT_ROOT, 'api-prefixes.json');

/** Каталог backend-исходников. */
const SRC_DIR = join(PROJECT_ROOT, 'src');

/**
 * Ожидаемые префиксы с контроллерами (8).
 *
 * `/api` сюда не входит: это legacy-префикс backend'а без собственного
 * `@Controller` (`controller: false` в реестре).
 */
const EXPECTED_CONTROLLER_PREFIXES = [
  'auth',
  'engine',
  'llm',
  'media',
  'nodes',
  'runs',
  'templates',
  'workflow',
] as const;

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

/** Запись единого реестра `api-prefixes.json`. */
interface RegistryEntry {
  /** Префикс без слэша (`workflow`, `auth`, …). */
  readonly prefix: string;
  /**
   * Есть ли у префикса backend-контроллер (дефолт `true`).
   *
   * `false` только у legacy `/api`: ручка отвечает с корня, своего
   * `@Controller('api')` нет, поэтому в паритете с контроллерами не участвует.
   */
  readonly controller?: boolean;
}

/**
 * Проверяет, что значение — запись реестра с валидным префиксом.
 *
 * @param value - элемент массива `prefixes` из JSON
 * @returns `true`, если это запись реестра
 */
function isRegistryEntry(value: unknown): value is RegistryEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const entry = value as Record<string, unknown>;

  return (
    typeof entry.prefix === 'string' &&
    /^[a-z][a-z0-9_-]*$/.test(entry.prefix)
  );
}

/**
 * Разбирает JSON единого реестра (`{ version: 1, prefixes: [...] }`).
 *
 * JSON читается как внешние данные (RULES 1.17): без проверки формы
 * `prefixes` тихо стал бы пустым массивом, и spec ложно позеленел бы.
 *
 * @param raw - содержимое `api-prefixes.json`
 * @returns записи реестра в порядке файла
 * @throws Error если формат файла не соответствует контракту
 */
function parseRegistry(raw: string): readonly RegistryEntry[] {
  const parsed: unknown = JSON.parse(raw);

  if (typeof parsed !== 'object' || parsed === null || !('prefixes' in parsed)) {
    throw new Error('api-prefixes.json: нет поля prefixes');
  }

  const { prefixes } = parsed as { prefixes: unknown };

  if (
    !Array.isArray(prefixes) ||
    prefixes.length === 0 ||
    !prefixes.every(isRegistryEntry)
  ) {
    throw new Error(
      'api-prefixes.json: prefixes должен быть непустым массивом записей с полем prefix',
    );
  }

  return prefixes;
}

/**
 * Читает единый реестр `api-prefixes.json`.
 *
 * @returns все записи реестра в порядке файла
 */
async function readRegistryAsync(): Promise<readonly RegistryEntry[]> {
  return parseRegistry(await readFile(REGISTRY_PATH, 'utf8'));
}

/**
 * Читает префиксы, под которые ожидается `@Controller`.
 *
 * Записи с `controller: false` (`/api`) исключены: своего контроллера у них
 * нет, и проверка «нет лишних записей» не должна считать их забытыми.
 *
 * @returns префиксы с контроллерами в порядке реестра
 */
async function readRegistryPrefixesAsync(): Promise<string[]> {
  const entries = await readRegistryAsync();

  return entries
    .filter((entry) => entry.controller !== false)
    .map((entry) => entry.prefix);
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
 * @param registryPrefixes - префиксы с контроллерами из `api-prefixes.json`
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
 * @param registryPrefixes - префиксы с контроллерами из `api-prefixes.json`
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

describe('API_PREFIXES: паритет с @Controller (KI-299/072/120/472)', () => {
  it('каждый @Controller-префикс есть в реестре api-prefixes.json', async () => {
    const controllers = await parseControllersAsync();
    const registryPrefixes = await readRegistryPrefixesAsync();
    const controllerPrefixes = controllers
      .map((controller) => controller.prefix)
      .filter((prefix): prefix is string => prefix !== null);
    const missing = findMissingPrefixes(controllerPrefixes, registryPrefixes);

    expect(
      missing,
      `Забыли добавить '${missing[0]}' в api-prefixes.json`,
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

  it('парсер реестра отклоняет JSON не по контракту', () => {
    expect(() => parseRegistry('{}')).toThrow('нет поля prefixes');
    expect(() => parseRegistry('{"prefixes": []}')).toThrow();
    expect(() => parseRegistry('{"prefixes": [{"nope": 1}]}')).toThrow();
    expect(() => parseRegistry('{"prefixes": [{"prefix": "Bad"}]}')).toThrow();
    expect(parseRegistry('{"prefixes": [{"prefix": "llm"}]}')).toEqual([
      { prefix: 'llm' },
    ]);
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

  it('реестр содержит все 8 префиксов с контроллерами', async () => {
    const entries = await readRegistryAsync();
    const registryPrefixes = await readRegistryPrefixesAsync();

    expect(registryPrefixes.length).toBeGreaterThanOrEqual(7);
    expect(registryPrefixes).toEqual(
      expect.arrayContaining([...EXPECTED_CONTROLLER_PREFIXES]),
    );
    expect(registryPrefixes).toContain('llm');
    expect(registryPrefixes).toContain('media');
    expect(registryPrefixes).toContain('templates');
    expect(new Set(registryPrefixes).size).toBe(registryPrefixes.length);
    // Дубли ловятся и по всему реестру, включая `/api` без контроллера.
    expect(new Set(entries.map((entry) => entry.prefix)).size).toBe(
      entries.length,
    );
  });
});
