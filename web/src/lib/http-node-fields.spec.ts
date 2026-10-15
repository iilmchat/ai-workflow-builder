import { describe, expect, it } from 'vitest';
import {
  HTTP_METHODS_WITH_BODY,
  HTTP_TIMEOUT_LIMIT,
  isValidHttpUrl,
  validateHttpHeaders,
  validateHttpMethod,
  validateTimeoutMs,
} from './http-node-fields';

describe('validateHttpMethod (R6.5.2)', () => {
  it('принимает четыре метода backend-схемы', () => {
    expect(validateHttpMethod('GET')).toBe('GET');
    expect(validateHttpMethod('POST')).toBe('POST');
    expect(validateHttpMethod('PUT')).toBe('PUT');
    expect(validateHttpMethod('DELETE')).toBe('DELETE');
  });

  it('неизвестный метод заменяет на GET', () => {
    expect(validateHttpMethod('PATCH')).toBe('GET');
    expect(validateHttpMethod('get')).toBe('GET');
    expect(validateHttpMethod(undefined)).toBe('GET');
    expect(validateHttpMethod(42)).toBe('GET');
  });
});

describe('HTTP_METHODS_WITH_BODY (R6.5.2)', () => {
  it('тело запроса — только у POST/PUT/DELETE', () => {
    expect([...HTTP_METHODS_WITH_BODY]).toEqual(['POST', 'PUT', 'DELETE']);
  });
});

describe('validateTimeoutMs (R6.5.2)', () => {
  it('принимает положительное целое в пределах лимита', () => {
    expect(validateTimeoutMs(1)).toBe(1);
    expect(validateTimeoutMs(30_000)).toBe(30_000);
    expect(validateTimeoutMs(HTTP_TIMEOUT_LIMIT)).toBe(HTTP_TIMEOUT_LIMIT);
  });

  it('отбрасывает мусор и значения выше лимита backend', () => {
    expect(validateTimeoutMs(0)).toBeUndefined();
    expect(validateTimeoutMs(-1)).toBeUndefined();
    expect(validateTimeoutMs(1.5)).toBeUndefined();
    expect(validateTimeoutMs('30000')).toBeUndefined();
    expect(validateTimeoutMs(undefined)).toBeUndefined();
    expect(validateTimeoutMs(HTTP_TIMEOUT_LIMIT + 1)).toBeUndefined();
  });
});

describe('validateHttpHeaders (R6.5.2, KI-129)', () => {
  it('возвращает копию карты строковых заголовков', () => {
    const headers = { 'X-Api-Key': 'token', Accept: 'application/json' };

    expect(validateHttpHeaders(headers)).toEqual(headers);
    // Копия, а не та же ссылка: значение из `data` не мутируем.
    expect(validateHttpHeaders(headers)).not.toBe(headers);
  });

  it('отбрасывает нестроковые значения и пустую карту', () => {
    expect(validateHttpHeaders({ A: 1, B: 'ok' })).toEqual({ B: 'ok' });
    expect(validateHttpHeaders({})).toBeUndefined();
  });

  it('отбрасывает не-объекты и массивы', () => {
    expect(validateHttpHeaders('X-Api-Key: token')).toBeUndefined();
    expect(validateHttpHeaders(null)).toBeUndefined();
    expect(validateHttpHeaders(['A', 'B'])).toBeUndefined();
    expect(validateHttpHeaders(undefined)).toBeUndefined();
  });
});

describe('isValidHttpUrl (R6.5.2)', () => {
  it('принимает абсолютные http/https-адреса', () => {
    expect(isValidHttpUrl('https://api.example.com/items?page=1')).toBe(true);
    expect(isValidHttpUrl('  http://127.0.0.1:3000/health  ')).toBe(true);
  });

  it('отвергает относительные пути, другие протоколы и пустую строку', () => {
    expect(isValidHttpUrl('/workflow/list')).toBe(false);
    expect(isValidHttpUrl('api.example.com')).toBe(false);
    expect(isValidHttpUrl('ftp://api.example.com')).toBe(false);
    expect(isValidHttpUrl('')).toBe(false);
    expect(isValidHttpUrl('   ')).toBe(false);
  });
});
