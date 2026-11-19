import { describe, expect, it } from 'vitest';
import { parseDurationToMs } from './parse-duration.js';

describe('parseDurationToMs (KI-218)', () => {
  it('поддерживает все единицы', () => {
    expect(parseDurationToMs('30s')).toBe(30_000);
    expect(parseDurationToMs('15m')).toBe(900_000);
    expect(parseDurationToMs('1h')).toBe(3_600_000);
    expect(parseDurationToMs('7d')).toBe(604_800_000);
  });

  it('терпит обрамляющие пробелы', () => {
    expect(parseDurationToMs('  24h  ')).toBe(86_400_000);
  });

  it('отвергает неверный формат', () => {
    expect(() => parseDurationToMs('пять минут')).toThrow(/Неверный формат/);
    expect(() => parseDurationToMs('10')).toThrow(/Неверный формат/);
    expect(() => parseDurationToMs('5w')).toThrow(/Неверный формат/);
    expect(() => parseDurationToMs('-1h')).toThrow(/Неверный формат/);
  });
});
