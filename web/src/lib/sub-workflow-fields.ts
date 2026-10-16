/**
 * Поля узла `sub_workflow` (R6.7, KI-200, DESIGN v0.8 § 5).
 *
 * Здесь живут валидаторы недоверенных значений (jsonb-граф после Load, ответ
 * `GET /workflow`): backend валидирует `data` своей Zod-схемой
 * (`SubWorkflowNodeDataSchema`), но UI обязан отбросить мусор раньше — иначе
 * селект не сможет отрисовать значение, а следующий Save затрёт БД
 * (KI-129: поля со значением `undefined` не присваиваются вовсе).
 */

/**
 * Регулярное выражение uuid — **копия** `z.uuid()` из Zod 4.
 *
 * Держим его здесь, а не «своё»: `workflowId`, который UI считает валидным, не
 * должен отвергаться backend-схемой (и наоборот). Допускаются nil- и
 * all-f-значения — ровно как в Zod.
 */
const UUID_RE =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

/**
 * Проверяет, что строка — uuid workflow.
 *
 * Пустая строка (узел только что создан) невалидна: селект покажет подсказку
 * «выберите workflow», а Run честно упадёт валидацией на backend, а не
 * «подставит» первый попавшийся workflow (принцип KI-069).
 *
 * @param value - значение `data.workflowId` или элемента списка workflow
 * @returns `true`, если строка — uuid, который примет backend
 */
export function isValidWorkflowId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * Проверяет снимок версии графа из `data.version`.
 *
 * @param value - значение из jsonb
 * @returns положительное целое либо `undefined` (поле не задано/мусор)
 */
export function validateWorkflowVersion(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

/**
 * Проверяет маппинг входов `data.inputsMap`.
 *
 * @param value - значение из jsonb
 * @returns копия карты строковых пар либо `undefined`, если маппинга нет
 */
export function validateInputsMap(
  value: unknown,
): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[0].trim().length > 0,
  );

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Определяет, что подграф в БД новее снимка из узла (DESIGN § 5.5).
 *
 * @param snapshotVersion - `data.version` узла (снимок на момент выбора)
 * @param currentVersion - `workflow.version` из `GET /workflow`
 * @returns `true`, если в БД есть более новая версия и стоит показать warning
 */
export function hasNewerWorkflowVersion(
  snapshotVersion: number | undefined,
  currentVersion: number,
): boolean {
  return snapshotVersion !== undefined && currentVersion > snapshotVersion;
}

/**
 * Собирает ссылку на workflow для кнопки «Открыть в редакторе».
 *
 * `?workflowId=` — тот же параметр, что читает `App` при загрузке страницы
 * (url-sync, A3), поэтому новая вкладка открывается сразу на нужном графе.
 * Невалидный id не превращается в ссылку: кнопка такая же, но открывать
 * нечего.
 *
 * @param workflowId - uuid workflow
 * @returns относительная ссылка с `?workflowId=` либо `null`
 */
export function workflowEditorUrl(workflowId: string): string | null {
  return isValidWorkflowId(workflowId)
    ? `/?workflowId=${encodeURIComponent(workflowId)}`
    : null;
}
