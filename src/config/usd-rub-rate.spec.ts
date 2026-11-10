import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { DEFAULT_USD_RUB_RATE, resolveUsdRubRate } from './usd-rub-rate.js';

/**
 * Заглушка ConfigService с заданными значениями.
 *
 * @param values - карта «имя переменной → значение»
 * @returns заглушка для `resolveUsdRubRate`
 */
function configStub(values: Record<string, unknown>): Pick<ConfigService, 'get'> {
  return { get: (key: string) => values[key] };
}

describe('resolveUsdRubRate (S8.1, KI-383)', () => {
  it('читает единый USD_RUB_RATE', () => {
    expect(resolveUsdRubRate(configStub({ USD_RUB_RATE: 92 }))).toBe(92);
  });

  it('поддерживает legacy WORKFLOW_RUN_USD_RUB_RATE', () => {
    expect(
      resolveUsdRubRate(configStub({ WORKFLOW_RUN_USD_RUB_RATE: 80 })),
    ).toBe(80);
  });

  it('поддерживает legacy MEDIA_USD_RUB_RATE', () => {
    expect(resolveUsdRubRate(configStub({ MEDIA_USD_RUB_RATE: '75' }))).toBe(75);
  });

  it('USD_RUB_RATE приоритетнее legacy-алиасов', () => {
    expect(
      resolveUsdRubRate(
        configStub({
          USD_RUB_RATE: 90,
          WORKFLOW_RUN_USD_RUB_RATE: 80,
          MEDIA_USD_RUB_RATE: 70,
        }),
      ),
    ).toBe(90);
  });

  it('невалидные значения пропускает и возвращает дефолт', () => {
    expect(resolveUsdRubRate(configStub({ USD_RUB_RATE: 'abc' }))).toBe(
      DEFAULT_USD_RUB_RATE,
    );
    expect(resolveUsdRubRate(configStub({ USD_RUB_RATE: 0 }))).toBe(
      DEFAULT_USD_RUB_RATE,
    );
    expect(resolveUsdRubRate(configStub({}))).toBe(DEFAULT_USD_RUB_RATE);
  });
});
