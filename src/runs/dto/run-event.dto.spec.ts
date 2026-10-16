import { RunEventSchema } from './run-event.dto.js';

/** Стабильный uuid запуска для тестовых событий. */
const RUN_ID = '11111111-1111-4111-8111-111111111111';
/** Валидная ISO-дата события. */
const ISO_NOW = '2026-10-13T10:00:00.000Z';

describe('RunEventSchema', () => {
  it('принимает валидные события всех типов', () => {
    const events = [
      { type: 'run_started', runId: RUN_ID, startedAt: ISO_NOW },
      {
        type: 'node_started',
        runId: RUN_ID,
        nodeId: 'n1',
        nodeType: 'llm',
        startedAt: ISO_NOW,
      },
      {
        type: 'node_completed',
        runId: RUN_ID,
        nodeId: 'n1',
        outputs: { text: 'привет' },
        durationMs: 12,
        finishedAt: ISO_NOW,
      },
      {
        type: 'node_failed',
        runId: RUN_ID,
        nodeId: 'n1',
        error: 'бум',
        finishedAt: ISO_NOW,
      },
      {
        type: 'node_skipped',
        runId: RUN_ID,
        nodeId: 'n2',
        nodeType: 'llm',
        reason: 'Пропущен: упал предшественник',
        skippedAt: ISO_NOW,
      },
      {
        type: 'run_completed',
        runId: RUN_ID,
        status: 'failed',
        attemptsMade: 1,
        attempts: 3,
        final: false,
        finishedAt: ISO_NOW,
      },
    ];

    for (const event of events) {
      const parsed = RunEventSchema.safeParse(event);

      expect(parsed.success, `событие ${event.type} должно быть валидным`).toBe(true);
    }
  });

  it('принимает метрики в node_completed / node_failed (KI-075)', () => {
    const completed = RunEventSchema.safeParse({
      type: 'node_completed',
      runId: RUN_ID,
      nodeId: 'img',
      outputs: { imageUrl: 'https://cdn.example/result.png' },
      durationMs: 6443,
      costRub: '0.600000',
      tokensIn: 128,
      tokensOut: 256,
      costUsd: '0.004200',
      logs: ['попытка 1/3 упала: 429 — повтор через 1000 мс'],
      finishedAt: ISO_NOW,
    });

    expect(completed.success).toBe(true);

    const failed = RunEventSchema.safeParse({
      type: 'node_failed',
      runId: RUN_ID,
      nodeId: 'llm',
      error: 'провайдер недоступен',
      costRub: null,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      logs: [],
      finishedAt: ISO_NOW,
    });

    expect(failed.success).toBe(true);
  });

  it('отклоняет отрицательные токены в node_completed (KI-075)', () => {
    const parsed = RunEventSchema.safeParse({
      type: 'node_completed',
      runId: RUN_ID,
      nodeId: 'n1',
      outputs: {},
      durationMs: 1,
      tokensIn: -1,
      finishedAt: ISO_NOW,
    });

    expect(parsed.success).toBe(false);
  });

  it('принимает attempts = null и требует attemptsMade (KI-059)', () => {
    const base = {
      type: 'run_completed',
      runId: RUN_ID,
      status: 'failed',
      finishedAt: ISO_NOW,
    };

    // Лимит попыток неизвестен: клиент трактует это как «не финал».
    expect(
      RunEventSchema.safeParse({
        ...base,
        attemptsMade: 0,
        attempts: null,
        final: true,
      }).success,
    ).toBe(true);

    // attemptMade обязателен: без него нельзя понять, будет ли retry.
    expect(
      RunEventSchema.safeParse({ ...base, attempts: 3, final: false }).success,
    ).toBe(false);

    // attempts = 0 невалиден (положительное число), отрицательный attemptsMade тоже.
    expect(
      RunEventSchema.safeParse({
        ...base,
        attemptsMade: 0,
        attempts: 0,
        final: false,
      }).success,
    ).toBe(false);
    expect(
      RunEventSchema.safeParse({
        ...base,
        attemptsMade: -1,
        attempts: 3,
        final: false,
      }).success,
    ).toBe(false);
  });

  it('требует явный признак финальности final (KI-060)', () => {
    const base = {
      type: 'run_completed',
      runId: RUN_ID,
      status: 'failed',
      attemptsMade: 0,
      attempts: 3,
      finishedAt: ISO_NOW,
    };

    expect(RunEventSchema.safeParse({ ...base, final: true }).success).toBe(true);
    expect(RunEventSchema.safeParse({ ...base, final: false }).success).toBe(true);

    // Без final событие невалидно: эвристика по attemptsMade убрана (KI-060).
    expect(RunEventSchema.safeParse(base).success).toBe(false);
    // final обязан быть boolean.
    expect(RunEventSchema.safeParse({ ...base, final: 'true' }).success).toBe(false);
  });

  it('требует nodeId/nodeType/reason в node_skipped (KI-288)', () => {
    const base = {
      type: 'node_skipped',
      runId: RUN_ID,
      skippedAt: ISO_NOW,
    };

    // Без nodeId/nodeType/reason событие бесполезно: UI не знает, какой узел
    // пропущен и почему.
    expect(RunEventSchema.safeParse(base).success).toBe(false);
    expect(
      RunEventSchema.safeParse({ ...base, nodeId: 'n2', nodeType: 'llm' }).success,
    ).toBe(false);
    expect(
      RunEventSchema.safeParse({
        ...base,
        nodeId: 'n2',
        nodeType: 'llm',
        reason: 'Пропущен: упал предшественник',
      }).success,
    ).toBe(true);
    // Дата пропуска обязана быть ISO-строкой.
    expect(
      RunEventSchema.safeParse({
        ...base,
        nodeId: 'n2',
        nodeType: 'llm',
        reason: 'Пропущен: упал предшественник',
        skippedAt: 'вчера',
      }).success,
    ).toBe(false);
  });

  it('отклоняет событие с неизвестным дискриминатором type', () => {
    const parsed = RunEventSchema.safeParse({ type: 'run_paused', runId: RUN_ID });

    expect(parsed.success).toBe(false);
  });

  it('отклоняет событие с невалидным полем', () => {
    // node_failed без обязательного `error`.
    expect(
      RunEventSchema.safeParse({
        type: 'node_failed',
        runId: RUN_ID,
        nodeId: 'n1',
        finishedAt: ISO_NOW,
      }).success,
    ).toBe(false);

    // node_completed с отрицательной длительностью и битым runId.
    expect(
      RunEventSchema.safeParse({
        type: 'node_completed',
        runId: 'not-a-uuid',
        nodeId: 'n1',
        outputs: {},
        durationMs: -1,
        finishedAt: ISO_NOW,
      }).success,
    ).toBe(false);
  });
});
