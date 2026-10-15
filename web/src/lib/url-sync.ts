/**
 * Синхронизация адресной строки с состоянием редактора (KI-271).
 *
 * Логика работы с query-параметрами живёт в одном месте: `?workflowId=` (A3) и
 * `?runId=` (KI-271) правятся одинаково — через `URL` + `history.replaceState`,
 * поэтому остальные параметры и hash сохраняются, а история не засоряется
 * (`replaceState`, а не `pushState`).
 *
 * Ядро — чистые функции над строкой URL (`withQueryParam`, `withoutQueryParam`,
 * `queryParamOf` и доменные обёртки `withRunId`/`withoutRunId`/`runIdOf`): их
 * можно тестировать без DOM. Публичные функции ниже читают/пишут
 * `window.location` и покрыты смоуком.
 */

/** Параметр с id текущего запуска (KI-271). */
const RUN_ID_PARAM = 'runId';

/** Параметр с id текущего workflow. */
const WORKFLOW_ID_PARAM = 'workflowId';

/**
 * Возвращает URL с установленным параметром.
 *
 * @param url - абсолютный URL (обычно `window.location.href`)
 * @param name - имя параметра
 * @param value - значение параметра
 * @returns новый URL: существующие параметры и hash сохранены
 */
export function withQueryParam(url: string, name: string, value: string): string {
  const parsed = new URL(url);

  parsed.searchParams.set(name, value);

  return parsed.toString();
}

/**
 * Возвращает URL без указанного параметра.
 *
 * @param url - абсолютный URL
 * @param name - имя параметра
 * @returns новый URL без параметра (остальные и hash сохранены)
 */
export function withoutQueryParam(url: string, name: string): string {
  const parsed = new URL(url);

  parsed.searchParams.delete(name);

  return parsed.toString();
}

/**
 * Читает параметр из URL.
 *
 * @param url - абсолютный URL
 * @param name - имя параметра
 * @returns значение параметра либо `null`, если его нет
 */
export function queryParamOf(url: string, name: string): string | null {
  return new URL(url).searchParams.get(name);
}

/**
 * Возвращает URL с `?runId=` (KI-271).
 *
 * @param url - абсолютный URL
 * @param runId - id запуска
 * @returns новый URL
 */
export function withRunId(url: string, runId: string): string {
  return withQueryParam(url, RUN_ID_PARAM, runId);
}

/**
 * Возвращает URL без `?runId=` (KI-271).
 *
 * @param url - абсолютный URL
 * @returns новый URL
 */
export function withoutRunId(url: string): string {
  return withoutQueryParam(url, RUN_ID_PARAM);
}

/**
 * Читает `?runId=` из URL (KI-271).
 *
 * @param url - абсолютный URL
 * @returns id запуска либо `null`
 */
export function runIdOf(url: string): string | null {
  return queryParamOf(url, RUN_ID_PARAM);
}

/**
 * Записывает `?runId=` в адресную строку (KI-271).
 *
 * Вызывается при старте запуска: после F5 id восстанавливается из URL, и UI
 * подписывается на поток заново (KI-271).
 *
 * @param runId - id запущенного workflow-запуска
 */
export function setRunIdInUrl(runId: string): void {
  replaceUrl(withRunId(window.location.href, runId));
}

/**
 * Убирает `?runId=` из адресной строки (KI-271).
 *
 * Вызывается на финале запуска: искать больше нечего, а «висящий» id после F5
 * заставил бы UI подписываться на уже завершённый запуск.
 */
export function clearRunIdFromUrl(): void {
  replaceUrl(withoutRunId(window.location.href));
}

/**
 * Читает `?runId=` из адресной строки (KI-271).
 *
 * @returns id запуска либо `null`, если запуск не отслеживается
 */
export function getRunIdFromUrl(): string | null {
  return runIdOf(window.location.href);
}

/**
 * Записывает `?workflowId=` в адресную строку (A3).
 *
 * @param workflowId - id сохранённого workflow
 */
export function syncWorkflowUrlParam(workflowId: string): void {
  replaceUrl(withQueryParam(window.location.href, WORKFLOW_ID_PARAM, workflowId));
}

/**
 * Убирает `?workflowId=` из адресной строки (A3).
 *
 * Вызывается при создании нового workflow: старый id в URL открывал бы прежний
 * граф после перезагрузки страницы.
 */
export function clearWorkflowUrlParam(): void {
  replaceUrl(withoutQueryParam(window.location.href, WORKFLOW_ID_PARAM));
}

/**
 * Заменяет текущую запись истории.
 *
 * `replaceState` (а не `pushState`) — навигация по графу/запускам не должна
 * плодить записи: кнопка «Назад» возвращает на предыдущую страницу, а не по
 * шагам внутри редактора.
 *
 * @param url - абсолютный URL той же origin
 */
function replaceUrl(url: string): void {
  window.history.replaceState(null, '', url);
}
