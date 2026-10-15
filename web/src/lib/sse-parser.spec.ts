import { describe, expect, it } from 'vitest';
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
