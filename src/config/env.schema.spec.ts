import { EnvSchema, WorkerEnvSchema, validateEnv } from './env.schema.js';

/** Минимально валидное окружение (обязательные URL). */
const baseEnv = {
  DATABASE_URL: 'postgres://workflow:devpass123@127.0.0.1:5433/workflow_builder',
  REDIS_URL: 'redis://127.0.0.1:6379',
};

describe('WorkerEnvSchema (KI-065, KI-032)', () => {
  it('применяет дефолты, когда переменные не заданы', () => {
    expect(WorkerEnvSchema.parse({})).toEqual({
      WORKFLOW_RUNS_CONCURRENCY: 5,
      WORKFLOW_RUNS_LOCK_DURATION_MS: 300_000,
      WORKFLOW_RUNS_MAX_STALLED_COUNT: 2,
      WORKFLOW_RUNS_STALE_THRESHOLD_MS: 300_000,
    });
  });

  it('парсит значения окружения в числа', () => {
    const parsed = WorkerEnvSchema.parse({
      WORKFLOW_RUNS_CONCURRENCY: '12',
      WORKFLOW_RUNS_LOCK_DURATION_MS: '60000',
      WORKFLOW_RUNS_MAX_STALLED_COUNT: '0',
      WORKFLOW_RUNS_STALE_THRESHOLD_MS: '120000',
    });

    expect(parsed).toEqual({
      WORKFLOW_RUNS_CONCURRENCY: 12,
      WORKFLOW_RUNS_LOCK_DURATION_MS: 60_000,
      WORKFLOW_RUNS_MAX_STALLED_COUNT: 0,
      WORKFLOW_RUNS_STALE_THRESHOLD_MS: 120_000,
    });
  });

  it('отклоняет значения вне границ и нечисловые значения', () => {
    // concurrency: 1..50 (главный предохранитель KI-065).
    expect(WorkerEnvSchema.safeParse({ WORKFLOW_RUNS_CONCURRENCY: '0' }).success).toBe(
      false,
    );
    expect(
      WorkerEnvSchema.safeParse({ WORKFLOW_RUNS_CONCURRENCY: '100' }).success,
    ).toBe(false);
    expect(
      WorkerEnvSchema.safeParse({ WORKFLOW_RUNS_CONCURRENCY: 'abc' }).success,
    ).toBe(false);
    // maxStalledCount: 0..10.
    expect(
      WorkerEnvSchema.safeParse({ WORKFLOW_RUNS_MAX_STALLED_COUNT: '11' }).success,
    ).toBe(false);
    // lockDuration и stale-порог: не меньше 10 секунд.
    expect(
      WorkerEnvSchema.safeParse({ WORKFLOW_RUNS_LOCK_DURATION_MS: '1000' }).success,
    ).toBe(false);
    expect(
      WorkerEnvSchema.safeParse({ WORKFLOW_RUNS_STALE_THRESHOLD_MS: '5000' }).success,
    ).toBe(false);
  });
});

describe('EnvSchema и validateEnv', () => {
  it('включает настройки воркера в общее окружение', () => {
    const parsed = EnvSchema.parse({ ...baseEnv, WORKFLOW_RUNS_CONCURRENCY: '2' });

    expect(parsed.WORKFLOW_RUNS_CONCURRENCY).toBe(2);
    expect(parsed.WORKFLOW_RUNS_LOCK_DURATION_MS).toBe(300_000);
    expect(parsed.WORKFLOW_RUNS_STALE_THRESHOLD_MS).toBe(300_000);
  });

  it('validateEnv падает на некорректном значении воркера', () => {
    expect(() =>
      validateEnv({ ...baseEnv, WORKFLOW_RUNS_CONCURRENCY: '0' }),
    ).toThrow('Некорректная конфигурация окружения');
  });

  it('validateEnv сохраняет неизвестные переменные и применяет дефолты', () => {
    const result = validateEnv({ ...baseEnv, SOME_OTHER_VAR: 'x' });

    expect(result.SOME_OTHER_VAR).toBe('x');
    expect(result.WORKFLOW_RUNS_CONCURRENCY).toBe(5);
  });
});

describe('OPENAI_BASE_URL (R5.0)', () => {
  it('опционален: без него окружение валидно', () => {
    const parsed = EnvSchema.parse(baseEnv);

    expect(parsed.OPENAI_BASE_URL).toBeUndefined();
  });

  it('принимает URL OpenAI-совместимого прокси (RouterAI)', () => {
    const parsed = EnvSchema.parse({
      ...baseEnv,
      OPENAI_BASE_URL: 'https://routerai.ru/api/v1',
    });

    expect(parsed.OPENAI_BASE_URL).toBe('https://routerai.ru/api/v1');
  });

  it('отклоняет не-URL и пустое значение', () => {
    // Пустая строка — частая ошибка при копировании .env.example
    // (там `OPENAI_BASE_URL=`), поэтому она обязана падать fail-fast.
    expect(EnvSchema.safeParse({ ...baseEnv, OPENAI_BASE_URL: 'not-a-url' }).success).toBe(
      false,
    );
    expect(EnvSchema.safeParse({ ...baseEnv, OPENAI_BASE_URL: '' }).success).toBe(false);
  });

  it('валидирует значение через validateEnv при старте', () => {
    expect(() => validateEnv({ ...baseEnv, OPENAI_BASE_URL: 'routerai.ru' })).toThrow(
      'Некорректная конфигурация окружения',
    );

    const result = validateEnv({
      ...baseEnv,
      OPENAI_BASE_URL: 'https://routerai.ru/api/v1',
    });

    expect(result.OPENAI_BASE_URL).toBe('https://routerai.ru/api/v1');
  });
});
