/**
 * Единый реестр HTTP-префиксов API (KI-299/072/120).
 *
 * Используется:
 * - в `web/vite.config.ts` — для генерации `server.proxy` (иначе легко забыть
 *   префикс: `/llm` → KI-072, `/media` → KI-120, `/templates` → KI-299);
 * - в тест-паритетах на frontend и backend (`api-prefixes.spec.ts`).
 *
 * Порядок не важен; `sse: true` — для потоковых ручек (timeout: 0).
 */

/** Описание одного HTTP-префикса API. */
export interface ApiPrefix {
  /** Префикс без слэша (`workflow`, `auth`, ...). */
  readonly prefix: string;
  /** SSE-поток: Vite proxy с `timeout: 0, proxyTimeout: 0`. */
  readonly sse?: boolean;
  /**
   * SPA fallback: если запрос идёт с `Accept: text/html`, отдать
   * `/index.html` (для deep-link `/workflow/share/:token`, R6.2.2).
   */
  readonly htmlFallback?: boolean;
}

/**
 * Реестр префиксов: единственный источник правды для Vite-прокси и тестов.
 *
 * `nodes` в реестре, потому что в backend есть `@Controller('nodes')`
 * (`src/nodes/nodes.controller.ts`, пока без ручек): паритетное spec'о
 * сверяет список с `@Controller(...)`, и пропуск дал бы ложное расхождение.
 * Как только в этом контроллере появится ручка, прокси для неё уже есть.
 */
export const API_PREFIXES: readonly ApiPrefix[] = [
  { prefix: 'workflow', htmlFallback: true },
  { prefix: 'engine' },
  { prefix: 'llm' },
  { prefix: 'media' },
  { prefix: 'auth' },
  { prefix: 'templates' },
  { prefix: 'runs', sse: true },
  { prefix: 'nodes' },
] as const;
