import { describe, expect, it } from 'vitest';
import { parseCorsAllowedOrigins, resolveCorsOrigin } from './cors.js';

describe('parseCorsAllowedOrigins (S6-A)', () => {
  it('пустая строка и undefined дают пустой список', () => {
    expect(parseCorsAllowedOrigins(undefined)).toMatchObject([]);
    expect(parseCorsAllowedOrigins('')).toMatchObject([]);
    expect(parseCorsAllowedOrigins('  ,  ,')).toMatchObject([]);
  });

  it('режет по запятой и обрезает пробелы вокруг элементов', () => {
    const origins = parseCorsAllowedOrigins(
      ' https://app.example.com , https://localhost ,capacitor://localhost ',
    );

    expect(origins).toMatchObject([
      'https://app.example.com',
      'https://localhost',
      'capacitor://localhost',
    ]);
  });

  it('срезает хвостовой слэш — Origin в запросе приходит без него', () => {
    expect(parseCorsAllowedOrigins('https://app.example.com/')).toMatchObject([
      'https://app.example.com',
    ]);
    // Несколько слэшей тоже срезаются, иначе origin не совпал бы с браузерным.
    expect(parseCorsAllowedOrigins('https://app.example.com///')).toMatchObject([
      'https://app.example.com',
    ]);
  });

  it('игнорирует хвостовую запятую — частая опечатка в .env', () => {
    expect(
      parseCorsAllowedOrigins('https://app.example.com,https://localhost,'),
    ).toMatchObject(['https://app.example.com', 'https://localhost']);
  });

  it('убирает дубли', () => {
    expect(
      parseCorsAllowedOrigins('https://a.example.com,https://a.example.com'),
    ).toMatchObject(['https://a.example.com']);
  });

  it('отклоняет не-URL и недопустимые схемы', () => {
    expect(() => parseCorsAllowedOrigins('app.example.com')).toThrow(
      'CORS_ALLOWED_ORIGINS',
    );
    expect(() => parseCorsAllowedOrigins('ftp://app.example.com')).toThrow(
      'CORS_ALLOWED_ORIGINS',
    );
    expect(() => parseCorsAllowedOrigins('file:///etc/passwd')).toThrow(
      'CORS_ALLOWED_ORIGINS',
    );
  });
});

describe('resolveCorsOrigin (S6-A)', () => {
  it('вне production сохраняет прежнее `origin: true`', () => {
    expect(resolveCorsOrigin('development', undefined)).toBe(true);
    expect(resolveCorsOrigin('test', '')).toBe(true);
    expect(resolveCorsOrigin(undefined, undefined)).toBe(true);
    // staging/preprod остаются на прежнем поведении (см. KI-668).
    expect(resolveCorsOrigin('staging', 'https://app.example.com')).toBe(true);
    expect(resolveCorsOrigin('preprod', undefined)).toBe(true);
  });

  it("в production возвращает массив origin'ов", () => {
    const origin = resolveCorsOrigin(
      'production',
      'https://app.example.com,https://localhost,capacitor://localhost',
    );

    expect(origin).toMatchObject([
      'https://app.example.com',
      'https://localhost',
      'capacitor://localhost',
    ]);
  });

  it('в production без allowlist — ошибка старта, а не «разрешить всё»', () => {
    expect(() => resolveCorsOrigin('production', undefined)).toThrow(
      'CORS_ALLOWED_ORIGINS обязателен при NODE_ENV=production',
    );
    expect(() => resolveCorsOrigin('production', '')).toThrow(
      'CORS_ALLOWED_ORIGINS обязателен при NODE_ENV=production',
    );
    expect(() => resolveCorsOrigin('production', ' , , ')).toThrow(
      'CORS_ALLOWED_ORIGINS обязателен при NODE_ENV=production',
    );
  });

  it('в production с мусором падает с понятным сообщением', () => {
    expect(() => resolveCorsOrigin('production', 'not-a-url')).toThrow(
      'CORS_ALLOWED_ORIGINS',
    );
  });
});
