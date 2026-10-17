/**
 * Трассировка (OpenTelemetry) без жёсткой зависимости бизнес-кода от SDK (R7.7).
 *
 * Зачем отдельный слой:
 * - `ExecutionEngineService`, `LlmService` и `MediaNodeExecutor` создаются в
 *   десятках тестов через `Test.createTestingModule`/`new`. Если бы они
 *   импортировали `@opentelemetry/api` напрямую, каждый тест тянул бы SDK, а
 *   `OTEL_ENABLED=false` не выключал бы инструментацию;
 * - SDK инициализируется **один раз** в {@link OtelService} (и только при
 *   `OTEL_ENABLED=true`), а бизнес-код работает с интерфейсом
 *   {@link TracingAdapter}. Пока адаптер не установлен, действует
 *   {@link NoopTracingAdapter} — вызовы не стоят ничего и ничего не отправляют.
 *
 * Контракт намеренно минимален: `runAsync(name, options, fn)`. Вложенность
 * span'ов задаётся вложенностью вызовов: OTel-адаптер использует
 * `startActiveSpan`, поэтому `node.execute` автоматически становится ребёнком
 * `run.execute`.
 */

/** Значение атрибута span'а, которое мы готовы отдать в телеметрию. */
export type TraceAttributeValue = string | number | boolean | null | undefined;

/** Атрибуты span'а. */
export type TraceAttributes = Readonly<Record<string, TraceAttributeValue>>;

/** Опции создания span'а. */
export interface TraceSpanOptions {
  /** Атрибуты: id запуска/узла, модель, тип media и т. п. */
  attributes?: TraceAttributes;
}

/** Упрощённый span: то, что нужно бизнес-коду. */
export interface TraceSpan {
  /**
   * Устанавливает атрибут span'а.
   *
   * @param key - имя атрибута
   * @param value - значение (null/undefined игнорируются)
   */
  setAttribute(key: string, value: TraceAttributeValue): void;

  /**
   * Записывает исключение в span (не пробрасывает его).
   *
   * @param error - ошибка из `catch`
   */
  recordException(error: unknown): void;
}

/** Адаптер трассировки: no-op либо реальный OTel. */
export interface TracingAdapter {
  /**
   * Выполняет `fn` внутри span'а.
   *
   * @param name - имя span'а (`run.execute`, `llm.call`, ...)
   * @param options - атрибуты span'а
   * @param fn - тело операции; получает span для собственных атрибутов
   * @returns результат `fn`
   * @throws ошибку `fn` без изменений — трассировка не должна её глотать
   */
  runAsync<T>(
    name: string,
    options: TraceSpanOptions,
    fn: (span: TraceSpan) => Promise<T>,
  ): Promise<T>;
}

/** Span-заглушка: все операции — no-op. */
const NOOP_SPAN: TraceSpan = {
  setAttribute: () => undefined,
  recordException: () => undefined,
};

/** Адаптер по умолчанию: трассировка выключена. */
export class NoopTracingAdapter implements TracingAdapter {
  /**
   * Выполняет функцию без трассировки.
   *
   * @param _name - имя span'а (не используется)
   * @param _options - атрибуты (не используются)
   * @param fn - тело операции
   * @returns результат `fn`
   */
  async runAsync<T>(
    _name: string,
    _options: TraceSpanOptions,
    fn: (span: TraceSpan) => Promise<T>,
  ): Promise<T> {
    return fn(NOOP_SPAN);
  }
}

/** Активный адаптер. Меняется только {@link setTracingAdapter}. */
let activeAdapter: TracingAdapter = new NoopTracingAdapter();

/**
 * Устанавливает активный адаптер трассировки.
 *
 * Вызывается {@link OtelService} при старте приложения и сбрасывается в no-op
 * при остановке. Тесты подставляют сюда записывающий адаптер.
 *
 * @param adapter - новый адаптер
 */
export function setTracingAdapter(adapter: TracingAdapter): void {
  activeAdapter = adapter;
}

/**
 * Возвращает текущий адаптер (для диагностики и тестов).
 *
 * @returns активный адаптер трассировки
 */
export function getTracingAdapter(): TracingAdapter {
  return activeAdapter;
}

/**
 * Сбрасывает трассировку в no-op (используется при остановке SDK и в тестах).
 */
export function resetTracingAdapter(): void {
  activeAdapter = new NoopTracingAdapter();
}

/**
 * Выполняет операцию внутри span'а.
 *
 * @param name - имя span'а (`run.execute`, `node.execute`, `llm.call`,
 *   `media.createTask`)
 * @param attributes - атрибуты span'а
 * @param fn - тело операции
 * @returns результат `fn`
 * @throws ошибку `fn` без изменений
 */
export async function withSpanAsync<T>(
  name: string,
  attributes: TraceAttributes,
  fn: (span: TraceSpan) => Promise<T>,
): Promise<T> {
  return activeAdapter.runAsync(name, { attributes }, fn);
}
