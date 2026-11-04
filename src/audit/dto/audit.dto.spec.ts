/**
 * Unit-тесты курсора keyset-пагинации журнала аудита (v1.0.0 S3).
 *
 * Курсор — непрозрачная строка, но именно он задаёт продолжение журнала,
 * поэтому проверяются round-trip, отказ мусору (это 400 от `ZodValidationPipe`,
 * а не 500 из сервиса) и микровторная точность: `Date` теряет µs, а
 * `timestamptz` — нет, иначе tie-break по id мог бы пропускать записи,
 * сделанные в одну миллисекунду.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDIT_LIMIT,
  MAX_AUDIT_LIMIT,
  AuditCursorSchema,
  AuditQuerySchema,
  decodeAuditCursor,
  encodeAuditCursor,
} from './audit.dto.js';

/** Позиция пагинации с микросекундной датой и ненулевым id. */
const CURSOR = {
  createdAt: '2026-11-02T09:00:00.123456Z',
  id: '33333333-3333-4333-8333-333333333333',
};

/** Кодирует произвольный «сырой» объект в base64url — для негативных кейсов. */
function encodeRaw(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe('keyset-курсор журнала аудита (v1.0.0 S3)', () => {
  it('encode/decode — round-trip без потери микросекунд', () => {
    const encoded = encodeAuditCursor(CURSOR);
    const decoded = decodeAuditCursor(encoded);

    // Именно строка: `new Date(...).toISOString()` вернул бы `.123Z`.
    expect(decoded.createdAt).toBe(CURSOR.createdAt);
    expect(decoded.id).toBe(CURSOR.id);
    // URL-safe: base64url не содержит `+`, `/`, `=`.
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['не base64url/JSON', 'not-a-cursor'],
    ['JSON без полей', encodeRaw({})],
    ['невалидный uuid', encodeRaw({ c: CURSOR.createdAt, i: 'nope' })],
    ['дата не по формату', encodeRaw({ c: '2026-13-40', i: CURSOR.id })],
    [
      'формат ISO, но невалидная дата',
      encodeRaw({ c: '2026-13-40T00:00:00.000000Z', i: CURSOR.id }),
    ],
    [
      'дата без дробных цифр',
      encodeRaw({ c: '2026-11-02T09:00:00Z', i: CURSOR.id }),
    ],
  ])('decode отклоняет %s', (_label, value) => {
    expect(() => decodeAuditCursor(value)).toThrow(
      'некорректный cursor журнала аудита',
    );
  });

  it('decode принимает ms-курсор (3 дробные цифры)', () => {
    const legacy = encodeRaw({
      c: '2026-11-02T09:00:00.123Z',
      i: CURSOR.id,
    });

    expect(decodeAuditCursor(legacy).createdAt).toBe(
      '2026-11-02T09:00:00.123Z',
    );
  });

  it('AuditCursorSchema принимает только декодируемый курсор разумной длины', () => {
    const encoded = encodeAuditCursor(CURSOR);

    expect(AuditCursorSchema.parse(encoded)).toBe(encoded);
    expect(AuditCursorSchema.safeParse('not-a-cursor').success).toBe(false);
    expect(AuditCursorSchema.safeParse('').success).toBe(false);
    // Ограничение длины — как у run-history cursor (512 символов).
    expect(AuditCursorSchema.safeParse('a'.repeat(513)).success).toBe(false);
    expect(AuditCursorSchema.safeParse('a'.repeat(512)).success).toBe(false);
  });

  it('query-схема: limit по умолчанию 20, cursor опционален', () => {
    expect(AuditQuerySchema.parse({})).toEqual({
      limit: DEFAULT_AUDIT_LIMIT,
    });

    const encoded = encodeAuditCursor(CURSOR);
    const parsed = AuditQuerySchema.parse({ limit: '5', cursor: encoded });

    expect(parsed.limit).toBe(5);
    expect(parsed.cursor).toBe(encoded);
  });

  it('query-схема приводит limit и держит границы 1..MAX', () => {
    expect(AuditQuerySchema.parse({ limit: '1' }).limit).toBe(1);
    expect(AuditQuerySchema.parse({ limit: '100' }).limit).toBe(
      MAX_AUDIT_LIMIT,
    );
    expect(AuditQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(AuditQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(AuditQuerySchema.safeParse({ limit: '2.5' }).success).toBe(false);
    expect(AuditQuerySchema.safeParse({ limit: 'abc' }).success).toBe(false);
  });

  it('query-схема отклоняет мусорный cursor (400, а не 500 в сервисе)', () => {
    expect(AuditQuerySchema.safeParse({ cursor: 'garbage' }).success).toBe(
      false,
    );
  });
});

describe('фильтры журнала аудита (v1.1.0 S3, KI-585)', () => {
  /** Автор действия для фильтра. */
  const AUTHOR_ID = '88888888-8888-4888-8888-888888888888';

  it('принимает action/userId/from/to и нормализует даты в Date', () => {
    const parsed = AuditQuerySchema.parse({
      action: 'workflow.create',
      userId: AUTHOR_ID,
      from: '2026-11-01',
      to: '2026-11-02',
    });

    expect(parsed.action).toBe('workflow.create');
    expect(parsed.userId).toBe(AUTHOR_ID);
    // Дата без времени — UTC-сутки: from — начало, to — конец включительно.
    expect(parsed.from).toEqual(new Date('2026-11-01T00:00:00.000Z'));
    expect(parsed.to).toEqual(new Date('2026-11-02T23:59:59.999Z'));
  });

  it('принимает полный ISO-8601 и fallback-действия интерсептора', () => {
    const parsed = AuditQuerySchema.parse({
      action: 'http.post',
      from: '2026-11-01T00:30:00+03:00',
      to: '2026-11-01T21:30:00.000Z',
    });

    expect(parsed.action).toBe('http.post');
    expect(parsed.from).toEqual(new Date('2026-10-31T21:30:00.000Z'));
    expect(parsed.to).toEqual(new Date('2026-11-01T21:30:00.000Z'));
  });

  it.each([
    ['не календарная дата', '2026-02-30'],
    ['месяц вне диапазона', '2026-13-01'],
    ['не дата', 'yesterday'],
    ['пустая строка', ''],
  ])('отклоняет from = %s', (_label, value) => {
    expect(AuditQuerySchema.safeParse({ from: value }).success).toBe(false);
  });

  it('отклоняет from позже to (400, а не пустая страница)', () => {
    expect(
      AuditQuerySchema.safeParse({ from: '2026-11-03', to: '2026-11-01' })
        .success,
    ).toBe(false);
    // Равные границы допустимы: фильтр на одни сутки.
    expect(
      AuditQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-01' })
        .success,
    ).toBe(true);
  });

  it.each([
    ['пробел', 'not an action'],
    ['без точки', 'workflow'],
    ['верхний регистр', 'Workflow.Create'],
    ['пустая строка', ''],
    ['слишком длинный', `workflow.${'a'.repeat(130)}`],
  ])('отклоняет action (%s)', (_label, value) => {
    expect(AuditQuerySchema.safeParse({ action: value }).success).toBe(false);
  });

  it('отклоняет userId не-uuid', () => {
    expect(AuditQuerySchema.safeParse({ userId: 'not-a-uuid' }).success).toBe(
      false,
    );
  });

  it('без фильтров схема не добавляет лишних полей', () => {
    // Опциональные поля не появляются в результате — сервис видит «фильтра нет».
    expect(AuditQuerySchema.parse({})).toEqual({
      limit: DEFAULT_AUDIT_LIMIT,
    });
  });
});
