import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetUrl } from './asset-url';

/**
 * `assetUrl` строит путь к статике от `import.meta.env.BASE_URL` (KI-647).
 *
 * В вебе `base: '/'`, в сборке Capacitor — `'./'`: без префикса логотип
 * искался бы в корне `https://localhost`, а не рядом с `index.html`.
 * `vi.stubEnv('BASE_URL', …)` действительно меняет `import.meta.env.BASE_URL`
 * в Vitest 4 (проверено парой тестов ниже), поэтому внутренний helper не нужен.
 */
describe('assetUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('при base "/" возвращает путь от корня', () => {
    vi.stubEnv('BASE_URL', '/');

    expect(assetUrl('logo.svg')).toBe('/logo.svg');
  });

  it('при base "./" возвращает относительный путь (сборка Capacitor)', () => {
    vi.stubEnv('BASE_URL', './');

    expect(assetUrl('/logo-dark.svg')).toBe('./logo-dark.svg');
  });
});
