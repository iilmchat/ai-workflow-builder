/**
 * Единый источник правды по HTTP-префиксам API (v0.10.2, KI-472).
 *
 * До v0.10.2 список префиксов жил в двух местах: Regex `API_ROUTE_PATTERN` в
 * `src/app.module.ts` (исключение API-ручек из SPA-fallback `ServeStatic`) и
 * `web/src/lib/api-prefixes.ts` (генерация `server.proxy` для Vite, тест-
 * паритеты). При добавлении контроллера один из списков забывали, и
 * SPA-fallback начинал отдавать `index.html` вместо JSON-404.
 *
 * Теперь список один — машиночитаемый `api-prefixes.json` в корне репозитория.
 * Его читают:
 * - этот модуль (backend) — строит {@link API_ROUTE_PATTERN};
 * - `web/src/lib/api-prefixes.ts` — собирает `API_PREFIXES` для Vite.
 *
 * JSON лежит в корне, а не в `docs/`: файл нужен в **рантайме** backend'а
 * (Docker-образ копирует его отдельным слоем), а `docs/` в образ не попадает.
 * Путь строится от `import.meta.url`, а не от `process.cwd()`: процесс может
 * быть запущен из другого каталога (RULES 1.9).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Описание одного HTTP-префикса API.
 *
 * Флаги необязательны: `undefined` трактуется как `false` (кроме
 * `controller`, где `undefined` означает «контроллер ожидается»).
 */
export interface ApiPrefix {
  /** Первый сегмент маршрута без слэша (`workflow`, `auth`, …). */
  readonly prefix: string;
  /** SSE-поток: Vite proxy с `timeout: 0, proxyTimeout: 0`. */
  readonly sse?: boolean;
  /** HTML-deep-link получает `/index.html` (R6.2.2, `/workflow/share/:token`). */
  readonly htmlFallback?: boolean;
  /** Проксируется ли префикс Vite (дефолт `true`; `false` — legacy `/api`). */
  readonly proxy?: boolean;
  /** Исключать ли префикс из SPA-fallback backend'а (дефолт `true`). */
  readonly spaExclude?: boolean;
  /** Есть ли у префикса `@Controller(...)` (дефолт `true`; `false` — `/api`). */
  readonly controller?: boolean;
}

/** Zod-схема одной записи реестра: внешние данные валидируются (RULES 1.17). */
const ApiPrefixSchema = z.object({
  prefix: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/, 'префикс должен быть сегментом пути в lowercase'),
  sse: z.boolean().optional(),
  htmlFallback: z.boolean().optional(),
  proxy: z.boolean().optional(),
  spaExclude: z.boolean().optional(),
  controller: z.boolean().optional(),
});

/** Zod-схема файла реестра. */
const ApiPrefixRegistrySchema = z
  .object({
    version: z.literal(1),
    prefixes: z.array(ApiPrefixSchema).min(1),
  })
  .superRefine((registry, ctx) => {
    const seen = new Set<string>();

    for (const [index, entry] of registry.prefixes.entries()) {
      if (seen.has(entry.prefix)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `префикс '${entry.prefix}' повторяется`,
          path: ['prefixes', index, 'prefix'],
        });
      }

      seen.add(entry.prefix);
    }
  });

/**
 * Абсолютный путь к единому реестру префиксов.
 *
 * `src/common/api-prefixes.ts` → корень репозитория — два уровня вверх; в
 * собранном виде `dist/common/api-prefixes.js` — те же два уровня (`/app`).
 */
const REGISTRY_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'api-prefixes.json',
);

/**
 * Читает и валидирует `api-prefixes.json`.
 *
 * Выполняется один раз при импорте модуля (fail-fast): сломанный реестр не
 * должен «тихо» превращаться в пустой SPA-fallback.
 *
 * @returns записи реестра в порядке файла
 * @throws Error если файл недоступен, невалидный JSON или не соответствует схеме
 */
function readRegistry(): readonly ApiPrefix[] {
  let raw: string;

  try {
    raw = readFileSync(REGISTRY_PATH, 'utf8');
  } catch {
    throw new Error(
      `Не прочитан единый реестр API-префиксов: ${REGISTRY_PATH}. ` +
        'В Docker-образе файл копируется Dockerfile.',
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`api-prefixes.json не является валидным JSON: ${REGISTRY_PATH}`);
  }

  const result = ApiPrefixRegistrySchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Некорректный api-prefixes.json: ${z.prettifyError(result.error)}`,
    );
  }

  return result.data.prefixes;
}

/**
 * Единый реестр HTTP-префиксов API (записи файла без изменений).
 *
 * Число записей и флаги проверяют spec'и; backend нужен только `prefix` и
 * `spaExclude`, frontend — `sse`/`htmlFallback`/`proxy`.
 */
export const API_PREFIXES: readonly ApiPrefix[] = readRegistry();

/**
 * Экранирует символы строки для использования в `RegExp`.
 *
 * @param value - префикс из реестра
 * @returns строка, безопасная внутри регулярного выражения
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Префиксы, которые SPA-fallback не должен перехватывать.
 *
 * `spaExclude: false` (если появится) оставит префикс за `ServeStatic`.
 */
export const SPA_EXCLUDED_PREFIXES: readonly string[] = API_PREFIXES.filter(
  (entry) => entry.spaExclude !== false,
).map((entry) => entry.prefix);

/**
 * RegExp API-маршрутов для `ServeStaticModule.exclude` (`app.module.ts`).
 *
 * Строится из {@link SPA_EXCLUDED_PREFIXES}, поэтому новый контроллер не
 * требует правки `app.module.ts`: достаточно добавить префикс в
 * `api-prefixes.json`. `path-to-regexp@8` не понимает `'/api*'` (KI-467),
 * поэтому это именно RegExp.
 */
export const API_ROUTE_PATTERN = new RegExp(
  `^/(?:${SPA_EXCLUDED_PREFIXES.map(escapeRegExp).join('|')})(?:/|$)`,
);
