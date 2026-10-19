/**
 * Единый реестр HTTP-префиксов API (KI-299/072/120, KI-472).
 *
 * **Источник правды — `api-prefixes.json` в корне репозитория (v0.10.2).**
 * Тот же файл читает backend (`src/common/api-prefixes.ts`) и строит из него
 * RegExp SPA-fallback'а. Раньше список дублировался здесь и в
 * `src/app.module.ts` — при добавлении контроллера один из списков забывали
 * (KI-072, KI-120, KI-299, KI-472).
 *
 * Используется:
 * - в `web/vite.config.ts` — для генерации `server.proxy`;
 * - в тест-паритетах на frontend и backend (`api-prefixes.spec.ts`).
 *
 * Порядок не важен; `sse: true` — для потоковых ручек (timeout: 0),
 * `htmlFallback: true` — HTML-deep-link получает `index.html`.
 */

import registry from '../../../api-prefixes.json';

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
 * Запись реестра из JSON: к полям `ApiPrefix` добавлены флаги, которые нужны
 * backend-spec'у (`controller`, `spaExclude`) и Vite (`proxy`).
 */
interface ApiPrefixRegistryEntry extends ApiPrefix {
  /** Проксируется ли префикс Vite (дефолт `true`; legacy `/api` — `false`). */
  readonly proxy?: boolean;
  /** Исключать ли префикс из SPA-fallback backend'а (дефолт `true`). */
  readonly spaExclude?: boolean;
  /** Есть ли у префикса backend-контроллер (дефолт `true`). */
  readonly controller?: boolean;
}

/**
 * Приводит JSON-модуль к типизированной форме.
 *
 * JSON читается как внешние данные (RULES 1.17), но на frontend его схему
 * валидирует backend-spec (там есть Zod) — здесь нужен только тип, чтобы
 * Vite-конфиг и spec'и видели флаги.
 */
const REGISTRY = registry as { prefixes: readonly ApiPrefixRegistryEntry[] };

/**
 * Реестр префиксов: единственный источник правды для Vite-прокси и тестов.
 *
 * Записи с `proxy: false` отфильтрованы: `/api` — legacy-префикс backend'а
 * (он отвечает с корня, `/api` нужен только SPA-fallback'у в `app.module.ts`),
 * проксировать его в dev-сервере незачем.
 */
export const API_PREFIXES: readonly ApiPrefix[] = REGISTRY.prefixes
  .filter((entry) => entry.proxy !== false)
  .map((entry) => ({
    prefix: entry.prefix,
    // Флаги копируются только когда включены: спец-проверки spec'ов ждут
    // отсутствие ключа, а не `false`.
    ...(entry.sse === true ? { sse: true } : {}),
    ...(entry.htmlFallback === true ? { htmlFallback: true } : {}),
  }));
