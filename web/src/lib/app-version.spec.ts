import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import { APP_COPYRIGHT_YEAR, APP_VERSION } from './app-version';

/**
 * Версия и копирайт в интерфейсе (RULES 1.11/1.12, KI-446).
 *
 * Версия не дублируется руками: единственный источник — `web/package.json`.
 * Тест ловит рассинхрон, который иначе виден только на скриншоте шапки.
 */
describe('APP_VERSION: версия из package.json (RULES 1.11)', () => {
  it('совпадает с версией пакета web', () => {
    expect(APP_VERSION).toBe(packageJson.version);
  });

  it('имеет вид semver', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+([-+].+)?$/);
  });

  it('год копирайта — четырёхзначный (RULES 1.12)', () => {
    expect(APP_COPYRIGHT_YEAR).toMatch(/^\d{4}$/);
  });
});
