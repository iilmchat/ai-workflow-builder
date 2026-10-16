import {
  NodeRunSnapshotSchema,
  RunSnapshotSchema,
  SnapshotMessageSchema,
} from './run-stream-message.dto.js';

/** Стабильный uuid запуска. */
const RUN_ID = '22222222-2222-4222-8222-222222222222';
/** Стабильный uuid workflow. */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
/** Валидная ISO-дата. */
const ISO_NOW = '2026-10-16T10:00:00.000Z';

/**
 * Собирает узел снимка состояния со всеми обязательными полями.
 *
 * @param status - значение `status`, которое нужно проверить схемой
 * @returns объект узла снимка (ещё не валидированный)
 */
function nodeSnapshot(status: string): Record<string, unknown> {
  return {
    nodeId: 'n1',
    nodeType: 'llm',
    status,
    inputs: {},
    outputs: null,
    error: null,
    logs: null,
    tokensIn: null,
    tokensOut: null,
    costUsd: null,
    costRub: null,
    durationMs: null,
    startedAt: null,
    finishedAt: null,
  };
}

describe('RunStreamMessageSchema: статус узла skipped (KI-288)', () => {
  it('принимает узел со статусом skipped', () => {
    const parsed = NodeRunSnapshotSchema.safeParse(nodeSnapshot('skipped'));

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.status).toBe('skipped');
  });

  it('по-прежнему принимает статусы запуска у узла', () => {
    for (const status of ['pending', 'running', 'completed', 'failed', 'cancelled']) {
      expect(
        NodeRunSnapshotSchema.safeParse(nodeSnapshot(status)).success,
        `статус ${status} должен быть валиден`,
      ).toBe(true);
    }
  });

  it('отклоняет неизвестный статус узла', () => {
    expect(NodeRunSnapshotSchema.safeParse(nodeSnapshot('paused')).success).toBe(false);
  });

  it('не даёт статус skipped запуску: это статус только узла', () => {
    const parsed = RunSnapshotSchema.safeParse({
      id: RUN_ID,
      workflowId: WORKFLOW_ID,
      status: 'skipped',
      createdAt: ISO_NOW,
    });

    expect(parsed.success).toBe(false);
  });

  it('пропускает снимок целиком, если среди узлов есть skipped', () => {
    // До KI-288 снимок с пропущенным узлом не проходил `SnapshotMessageSchema`,
    // и SSE-поток запуска падал на первом же сообщении (RULES 1.17).
    const parsed = SnapshotMessageSchema.safeParse({
      type: 'snapshot',
      run: {
        id: RUN_ID,
        workflowId: WORKFLOW_ID,
        status: 'failed',
        createdAt: ISO_NOW,
      },
      nodes: [
        { ...nodeSnapshot('completed'), nodeId: 'A' },
        { ...nodeSnapshot('failed'), nodeId: 'B' },
        { ...nodeSnapshot('skipped'), nodeId: 'C' },
      ],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.nodes.map((item) => item.status)).toEqual([
      'completed',
      'failed',
      'skipped',
    ]);
  });
});
