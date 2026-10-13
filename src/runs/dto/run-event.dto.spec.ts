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
