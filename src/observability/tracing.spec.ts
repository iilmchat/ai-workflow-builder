import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NoopTracingAdapter,
  getTracingAdapter,
  resetTracingAdapter,
  setTracingAdapter,
  withSpanAsync,
  type TraceAttributes,
  type TraceSpan,
  type TracingAdapter,
} from './tracing.js';

/**
 * Адаптер трассировки: накопление span'ов вместо OTel (R7.7, KI-365).
 *
 * Бизнес-код общается с интерфейсом `TracingAdapter`, поэтому тест подменяет
 * его записывающей реализацией и проверяет имена, атрибуты и обработку ошибок
 * без запуска SDK и без сети.
 */
class RecordingTracingAdapter implements TracingAdapter {
  /** Записанные span'ы: имя, атрибуты, атрибуты из тела. */
  readonly spans: Array<{
    name: string;
    attributes: TraceAttributes | undefined;
    set: Array<[string, unknown]>;
    errors: unknown[];
    finished: boolean;
  }> = [];

  /**
   * Выполняет функцию, записывая span.
   *
   * @param name - имя span'а
   * @param options - атрибуты
   * @param fn - тело операции
   * @returns результат `fn`
   */
  async runAsync<T>(
    name: string,
    options: { attributes?: TraceAttributes },
    fn: (span: TraceSpan) => Promise<T>,
  ): Promise<T> {
    const record = {
      name,
      attributes: options.attributes,
      set: [] as Array<[string, unknown]>,
      errors: [] as unknown[],
      finished: false,
    };

    this.spans.push(record);

    try {
      return await fn({
        setAttribute: (key, value) => {
          record.set.push([key, value]);
        },
        recordException: (error) => {
          record.errors.push(error);
        },
      });
    } finally {
      record.finished = true;
    }
  }
}

afterEach(() => {
  resetTracingAdapter();
  vi.restoreAllMocks();
});

describe('Трассировка: слой без SDK (R7.7, KI-365)', () => {
  it('по умолчанию — no-op: вызов проходит, ничего не отправляется', async () => {
    expect(getTracingAdapter()).toBeInstanceOf(NoopTracingAdapter);

    await expect(
      withSpanAsync('run.execute', { 'run.id': 'r1' }, async (span) => {
        span.setAttribute('run.status', 'completed');
        span.recordException(new Error('не должно упасть'));

        return 'ok';
      }),
    ).resolves.toBe('ok');
  });

  it('передаёт имя span’а и атрибуты в адаптер', async () => {
    const adapter = new RecordingTracingAdapter();

    setTracingAdapter(adapter);

    await withSpanAsync('node.execute', { 'node.id': 'n1', 'node.type': 'llm' }, () =>
      Promise.resolve(undefined),
    );

    expect(adapter.spans).toHaveLength(1);
    expect(adapter.spans[0]?.name).toBe('node.execute');
    expect(adapter.spans[0]?.attributes).toEqual({
      'node.id': 'n1',
      'node.type': 'llm',
    });
    expect(adapter.spans[0]?.finished).toBe(true);
  });

  it('даёт бизнес-коду выставить свои атрибуты внутри span’а', async () => {
    const adapter = new RecordingTracingAdapter();

    setTracingAdapter(adapter);

    await withSpanAsync('llm.call', { 'llm.model': 'gpt-4o' }, async (span) => {
      span.setAttribute('llm.input_tokens', 100);
      span.setAttribute('llm.cache_read_tokens', null);
    });

    expect(adapter.spans[0]?.set).toEqual([
      ['llm.input_tokens', 100],
      ['llm.cache_read_tokens', null],
    ]);
  });

  it('пробрасывает ошибку операции и помечает span завершённым (адаптер сам пишет exception)', async () => {
    const adapter = new RecordingTracingAdapter();
    const failure = new Error('провайдер упал');

    setTracingAdapter(adapter);

    await expect(
      withSpanAsync('media.createTask', { 'media.model': 'flux' }, () =>
        Promise.reject(failure),
      ),
    ).rejects.toBe(failure);

    expect(adapter.spans[0]?.finished).toBe(true);
  });

  it('resetTracingAdapter возвращает no-op', async () => {
    setTracingAdapter(new RecordingTracingAdapter());
    resetTracingAdapter();

    expect(getTracingAdapter()).toBeInstanceOf(NoopTracingAdapter);
  });
});
