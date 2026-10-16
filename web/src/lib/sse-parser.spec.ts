import { describe, expect, it } from 'vitest';
import { RunStreamMessageSchema, type RunStreamMessage } from '@/types/run-stream';
import { parseSseEvents } from './sse-parser';

describe('parseSseEvents: кадры SSE (KI-268)', () => {
  it('разбирает одиночный кадр и не оставляет остатка', () => {
    const result = parseSseEvents('data: {"type":"run_started"}\n\n');

    expect(result.events).toEqual(['{"type":"run_started"}']);
    expect(result.rest).toBe('');
  });

  it('склеивает несколько data:-строк одного кадра через \\n', () => {
    const result = parseSseEvents('data: a\ndata: b\n\n');

    expect(result.events).toEqual(['a\nb']);
    expect(result.rest).toBe('');
  });

  it('пропускает keep-alive комментарий', () => {
    const result = parseSseEvents(': keep-alive\n\n');

    expect(result.events).toEqual([]);
    expect(result.rest).toBe('');
  });

  it('возвращает два события из двух кадров подряд', () => {
    const result = parseSseEvents('data: first\n\ndata: second\n\n');

    expect(result.events).toEqual(['first', 'second']);
    expect(result.rest).toBe('');
  });

  it('сохраняет неполный кадр в rest', () => {
    const result = parseSseEvents('data: ready\n\ndata: partial');

    expect(result.events).toEqual(['ready']);
    expect(result.rest).toBe('data: partial');
  });

  it('игнорирует id: и event:, забирая только data:', () => {
    const result = parseSseEvents('id: 42\nevent: node_started\ndata: {"a":1}\n\n');

    expect(result.events).toEqual(['{"a":1}']);
    expect(result.rest).toBe('');
  });

  it('нормализует CRLF и снимает один пробел после двоеточия', () => {
    const result = parseSseEvents('data:{"a":1}\r\n\r\ndata:  2\r\n\r\n');

    expect(result.events).toEqual(['{"a":1}', ' 2']);
    expect(result.rest).toBe('');
  });
});

/** ISO-время события в тестовых кадрах. */
const ISO_AT = '2026-10-16T10:00:00.000Z';

/**
 * Прогоняет payload кадра через Zod-схему зеркала контракта.
 *
 * Хелпер, а не `safeParse` на месте: при отказе схемы в отчёт попадают issues
 * (`expect(parsed.success).toBe(true)` их не показывает), а TS не приходится
 * сужать union `ZodSafeParseResult` перед каждым `expect`.
 *
 * @param payload - payload кадра SSE (JSON-строка)
 * @returns валидированное сообщение потока
 * @throws Error если сообщение не соответствует зеркалу backend-контракта
 */
function parseMessage(payload: string): RunStreamMessage {
  const parsed = RunStreamMessageSchema.safeParse(JSON.parse(payload) as unknown);

  if (!parsed.success) {
    throw new Error(`Сообщение не прошло схему: ${JSON.stringify(parsed.error.issues)}`);
  }

  return parsed.data;
}

/**
 * Собирает узел снимка состояния со всеми обязательными полями.
 *
 * @param status - статус узла в снимке
 * @returns payload узла (ещё не валидированный)
 */
function snapshotNode(status: string): Record<string, unknown> {
  return {
    nodeId: `node-${status}`,
    nodeType: 'text',
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

describe('зеркало SSE-контракта (KI-288)', () => {
  it('кадр node_skipped проходит валидацию зеркала', () => {
    const frame =
      'event: node_skipped\n' +
      'data: {"type":"node_skipped","runId":"22222222-2222-4222-8222-222222222222",' +
      '"nodeId":"C","nodeType":"llm","reason":"Пропущен: упал предшественник",' +
      `"skippedAt":"${ISO_AT}"}\n\n`;
    const { events } = parseSseEvents(frame);

    expect(events).toHaveLength(1);

    const message = parseMessage(events[0] ?? '{}');

    expect(message.type).toBe('node_skipped');
    expect(message).toEqual(
      expect.objectContaining({ nodeId: 'C', nodeType: 'llm', reason: 'Пропущен: упал предшественник' }),
    );
  });

  it('кадр snapshot со skipped-узлом проходит валидацию зеркала', () => {
    // До KI-288 `NodeRunSnapshotSchema.status` был `z.enum(RUN_STATUSES)` без
    // `skipped`: снимок запуска с пропущенным узлом падал на `parse`, и поток
    // запуска закрывался ошибкой на первом же сообщении.
    const snapshot = {
      type: 'snapshot',
      run: {
        id: '22222222-2222-4222-8222-222222222222',
        workflowId: '11111111-1111-4111-8111-111111111111',
        status: 'failed',
        createdAt: ISO_AT,
      },
      nodes: [
        snapshotNode('completed'),
        snapshotNode('failed'),
        snapshotNode('skipped'),
      ],
    };
    const { events } = parseSseEvents(`data: ${JSON.stringify(snapshot)}\n\n`);

    expect(events).toHaveLength(1);

    const message = parseMessage(events[0] ?? '{}');

    expect(message.type).toBe('snapshot');

    if (message.type === 'snapshot') {
      expect(message.nodes.map((node) => node.status)).toEqual([
        'completed',
        'failed',
        'skipped',
      ]);
    }
  });
});
