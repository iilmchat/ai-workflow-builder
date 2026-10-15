import { describe, expect, it } from 'vitest';
import { buildAbsoluteShareUrl, isValidShareToken } from './share-url';

/** Валидный uuid v4 для тестов. */
const TOKEN = '55555555-5555-4555-8555-555555555555';

describe('buildAbsoluteShareUrl (R6.2.2)', () => {
  it('собирает абсолютный URL из относительного пути', () => {
    expect(
      buildAbsoluteShareUrl('https://app.example', `/workflow/share/${TOKEN}`),
    ).toBe(`https://app.example/workflow/share/${TOKEN}`);
  });

  it('корректно обрабатывает origin с портом и без слэша на конце', () => {
    expect(
      buildAbsoluteShareUrl('http://localhost:5173', `/workflow/share/${TOKEN}`),
    ).toBe(`http://localhost:5173/workflow/share/${TOKEN}`);
  });

  it('оставляет абсолютный URL как есть', () => {
    const absolute = `https://other.example/workflow/share/${TOKEN}`;

    expect(buildAbsoluteShareUrl('https://app.example', absolute)).toBe(absolute);
  });
});

describe('isValidShareToken (R6.2.2)', () => {
  it('принимает uuid в разных регистрах', () => {
    expect(isValidShareToken(TOKEN)).toBe(true);
    expect(isValidShareToken(TOKEN.toUpperCase())).toBe(true);
  });

  it('отклоняет undefined, пустую строку и не-uuid', () => {
    expect(isValidShareToken(undefined)).toBe(false);
    expect(isValidShareToken('')).toBe(false);
    expect(isValidShareToken('not-a-uuid')).toBe(false);
    expect(isValidShareToken(`${TOKEN}-extra`)).toBe(false);
  });
});
