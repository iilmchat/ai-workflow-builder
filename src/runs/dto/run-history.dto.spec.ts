/**
 * Unit-тесты курсора keyset-пагинации истории запусков (v0.16 S1, KI-542).
 *
 * Курсор — непрозрачная строка, но именно он заменяет `offset`, поэтому
 * проверяются round-trip, отказ мусору (это 400, а не 500) и то, что старая
 * схема `offset` больше не является частью контракта. Отдельно проверяется
 * микровторная точность: `Date` её теряет, а `timestamptz` — нет (иначе
 * tie-break по id мог бы пропускать запуски одной миллисекунды).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUN_HISTORY_LIMIT,
  RunHistoryCursorSchema,
  RunHistoryQuerySchema,
  decodeRunHistoryCursor,
  encodeRunHistoryCursor,
} from './run-history.dto.js';

/** Позиция пагинации с микросекундной датой и ненулевым id. */
const CURSOR = {
  createdAt: '2026-11-02T09:00:00.123456Z',
  id: '22222222-2222-4222-8222-222222222222',
};

describe('keyset-курсор истории запусков (v0.16 S1, KI-542)', () => {
  it('encode/decode — round-trip без потери микросекунд', () => {
    const encoded = encodeRunHistoryCursor(CURSOR);
    const decoded = decodeRunHistoryCursor(encoded);

    // Именно строка: `new Date(...).toISOString()` вернул бы `.123Z`.
    expect(decoded.createdAt).toBe(CURSOR.createdAt);
    expect(decoded.id).toBe(CURSOR.id);
    // URL-safe: base64url не содержит `+`, `/`, `=`.
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['не base64url/JSON', 'not-a-cursor'],
    ['JSON без полей', Buffer.from('{}', 'utf8').toString('base64url')],
    [
      'невалидный uuid',
      Buffer.from(
        JSON.stringify({ c: CURSOR.createdAt, i: 'nope' }),
        'utf8',
      ).toString('base64url'),
    ],
    [
      'дата не по формату',
      Buffer.from(JSON.stringify({ c: '2026-13-40', i: CURSOR.id }), 'utf8').toString(
        'base64url',
      ),
    ],
    [
      'формат ISO, но невалидная дата',
      Buffer.from(
        JSON.stringify({ c: '2026-13-40T00:00:00.000000Z', i: CURSOR.id }),
        'utf8',
      ).toString('base64url'),
    ],
  ])('decode отклоняет %s', (_label, value) => {
    expect(() => decodeRunHistoryCursor(value)).toThrow(
      'некорректный cursor истории запусков',
    );
  });

  it('decode принимает старый ms-курсор (совместимость при деплое)', () => {
    const legacy = Buffer.from(
      JSON.stringify({ c: '2026-11-02T09:00:00.123Z', i: CURSOR.id }),
      'utf8',
    ).toString('base64url');

    expect(decodeRunHistoryCursor(legacy).createdAt).toBe(
      '2026-11-02T09:00:00.123Z',
    );
  });

  it('RunHistoryCursorSchema принимает только декодируемый курсор', () => {
    expect(RunHistoryCursorSchema.parse(encodeRunHistoryCursor(CURSOR))).toBe(
      encodeRunHistoryCursor(CURSOR),
    );
    expect(RunHistoryCursorSchema.safeParse('not-a-cursor').success).toBe(false);
    expect(RunHistoryCursorSchema.safeParse('').success).toBe(false);
  });

  it('query-схема: limit по умолчанию, cursor опционален, offset удалён', () => {
    expect(RunHistoryQuerySchema.parse({})).toEqual({
      limit: DEFAULT_RUN_HISTORY_LIMIT,
    });

    const parsed = RunHistoryQuerySchema.parse({
      limit: '5',
      cursor: encodeRunHistoryCursor(CURSOR),
      // Старый параметр: Zod отбрасывает неизвестные ключи (whitelist-поведение
      // DTO), но в типе его больше нет.
      offset: '40',
    });

    expect(parsed.limit).toBe(5);
    expect(parsed.cursor).toBe(encodeRunHistoryCursor(CURSOR));
    expect(parsed).not.toHaveProperty('offset');
  });

  it('query-схема отклоняет мусорный cursor (400, а не 500 в сервисе)', () => {
    expect(RunHistoryQuerySchema.safeParse({ cursor: 'garbage' }).success).toBe(
      false,
    );
  });
});
