import {
  isCapacitorOrigin,
  isRefreshCookieSameSite,
  resolveRefreshCookieOptions,
} from './auth.cookie.js';

/**
 * Минимальный мок запроса: логике нужен только `headers.origin`.
 *
 * @param origin - значение заголовка `Origin`
 * @returns объект с формой `request.headers`
 */
function requestWithOrigin(origin?: string): {
  headers: { origin?: string };
} {
  return { headers: { origin } };
}

describe('resolveRefreshCookieOptions (v1.6.0 S6-B, KI-664)', () => {
  it('production + capacitor://localhost → SameSite=None; Secure', () => {
    const request = requestWithOrigin('capacitor://localhost');

    expect(
      resolveRefreshCookieOptions({
        origin: request.headers.origin,
        nodeEnv: 'production',
        configuredSameSite: 'Strict',
        // Даже при COOKIE_SECURE=false None обязан быть Secure.
        secure: false,
      }),
    ).toEqual({ sameSite: 'None', secure: true });
  });

  it('production + https://localhost → SameSite=None; Secure', () => {
    const request = requestWithOrigin('https://localhost');

    expect(
      resolveRefreshCookieOptions({
        origin: request.headers.origin,
        nodeEnv: 'production',
        configuredSameSite: undefined,
        secure: true,
      }),
    ).toEqual({ sameSite: 'None', secure: true });
  });

  it('production + обычный веб-origin → COOKIE_SAMESITE (дефолт Strict)', () => {
    const request = requestWithOrigin('https://ai-workflow-builder.ru');

    expect(
      resolveRefreshCookieOptions({
        origin: request.headers.origin,
        nodeEnv: 'production',
        configuredSameSite: undefined,
        secure: true,
      }),
    ).toEqual({ sameSite: 'Strict', secure: true });
  });

  it('вне production Capacitor-origin не переключает cookie на None', () => {
    const request = requestWithOrigin('capacitor://localhost');

    expect(
      resolveRefreshCookieOptions({
        origin: request.headers.origin,
        nodeEnv: 'development',
        configuredSameSite: undefined,
        secure: false,
      }),
    ).toEqual({ sameSite: 'Strict', secure: false });
  });

  it('уважает COOKIE_SAMESITE=Lax', () => {
    const request = requestWithOrigin('https://ai-workflow-builder.ru');

    expect(
      resolveRefreshCookieOptions({
        origin: request.headers.origin,
        nodeEnv: 'production',
        configuredSameSite: 'Lax',
        secure: true,
      }),
    ).toEqual({ sameSite: 'Lax', secure: true });
  });

  it('COOKIE_SAMESITE=None включает Secure', () => {
    const request = requestWithOrigin(undefined);

    expect(
      resolveRefreshCookieOptions({
        origin: request.headers.origin,
        nodeEnv: 'development',
        configuredSameSite: 'None',
        secure: false,
      }),
    ).toEqual({ sameSite: 'None', secure: true });
  });

  it('мусор в env и Origin не ослабляет cookie', () => {
    const request = requestWithOrigin('https://evil.example.com');

    expect(
      resolveRefreshCookieOptions({
        origin: request.headers.origin,
        nodeEnv: 'production',
        configuredSameSite: 'strict-small',
        secure: true,
      }),
    ).toEqual({ sameSite: 'Strict', secure: true });
  });
});

describe('isCapacitorOrigin', () => {
  it('распознаёт оба origin Capacitor', () => {
    expect(isCapacitorOrigin('capacitor://localhost')).toBe(true);
    expect(isCapacitorOrigin('https://localhost')).toBe(true);
    expect(isCapacitorOrigin('HTTPS://LOCALHOST')).toBe(true);
  });

  it('не считает Capacitor чужие origin и не-строки', () => {
    expect(isCapacitorOrigin('https://localhost.evil.example.com')).toBe(false);
    expect(isCapacitorOrigin(undefined)).toBe(false);
    expect(isCapacitorOrigin(42)).toBe(false);
  });
});

describe('isRefreshCookieSameSite', () => {
  it('принимает только значения из enum', () => {
    expect(isRefreshCookieSameSite('Strict')).toBe(true);
    expect(isRefreshCookieSameSite('None')).toBe(true);
    expect(isRefreshCookieSameSite('strict')).toBe(false);
    expect(isRefreshCookieSameSite(undefined)).toBe(false);
  });
});
