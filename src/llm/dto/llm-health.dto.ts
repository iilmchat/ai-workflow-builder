/**
 * Состояние локального LLM-бэкенда в ответе `GET /llm/health` (v1.2.0 S3,
 * KI-618, DESIGN V120 § 3.4).
 *
 * Отдаётся «плоским» объектом без обёртки `{ success, data }`: ручка внутренняя
 * (для SPA), как и `GET /llm/models`. `available` — результат
 * `LlmHealthService.getStatus()` (только статус `available` означает «GPU
 * можно использовать»), `lastCheck` — ISO-строка последней завершённой проверки
 * либо `''`, если проверок ещё не было.
 */
export interface LocalLlmHealth {
  /** `true`, если последняя проверка подтвердила доступность LM Studio. */
  available: boolean;
  /**
   * ISO-строка (`Date.toISOString()`) последней завершённой проверки; `''` —
   * проверок ещё не было (healthcheck не запускался или локальный провайдер не
   * сконфигурирован).
   */
  lastCheck: string;
}

/**
 * Ответ `GET /llm/health` (v1.2.0 S3, KI-618).
 *
 * Состав фиксирован и минимален: UI-индикатору нужны состояние GPU и признак
 * участия роутера в маршрутизации. Статусы `unknown` и `unavailable`
 * сворачиваются в `local.available: false`: для индикатора «GPU доступен» —
 * бинарный признак, а различие «не проверяли» и «недоступен» видно по
 * `lastCheck`.
 */
export interface LlmHealthResponse {
  /** Состояние локального провайдера (LM Studio). */
  local: LocalLlmHealth;
  /** Текущий флаг `LLM_ROUTER_ENABLED`: участвует ли GPU в маршрутизации. */
  routerEnabled: boolean;
}
