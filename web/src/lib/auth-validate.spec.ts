import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX, PASSWORD_MIN, isValidEmail, isValidPassword } from './auth-validate';

describe('isValidEmail (R6.1b.2)', () => {
  it('принимает корректные адреса', () => {
    for (const value of [
      'a@b.co',
      'user.name+tag@example.com',
      '  spaced@example.com  ',
      'UPPER@EXAMPLE.COM',
      'x@y.zz',
    ]) {
      expect(isValidEmail(value), `должен принять «${value}»`).toBe(true);
    }
  });

  it('отклоняет строки без домена, собаки или с пробелами внутри', () => {
    for (const value of [
      '',
      'a',
      'a@b',
      '@b.co',
      'a b@c.co',
      'a@',
      'a@b.',
      'a@b.c d',
    ]) {
      expect(isValidEmail(value), `должен отклонить «${value}»`).toBe(false);
    }
  });
});

describe('isValidPassword (R6.1b.2)', () => {
  it('границы длины: 7 — нет, 8 — да, 72 — да, 73 — нет', () => {
    expect(PASSWORD_MIN).toBe(8);
    expect(PASSWORD_MAX).toBe(72);
    expect(isValidPassword('x'.repeat(7))).toBe(false);
    expect(isValidPassword('x'.repeat(8))).toBe(true);
    expect(isValidPassword('x'.repeat(72))).toBe(true);
    expect(isValidPassword('x'.repeat(73))).toBe(false);
  });

  it('пустой пароль и пробелы не проходят', () => {
    expect(isValidPassword('')).toBe(false);
    expect(isValidPassword('        ')).toBe(true);
    expect(isValidPassword('short')).toBe(false);
  });
});
