import { EnvSchema, WorkerEnvSchema, validateEnv } from './env.schema.js';

/** Минимально валидное окружение (обязательные URL и секрет подписи). */
const baseEnv = {
  DATABASE_URL: 'postgres://workflow:devpass123@127.0.0.1:5433/workflow_builder',
  REDIS_URL: 'redis://127.0.0.1:6379',
  // R6.1a: JWT_SECRET обязателен (min 32 символа).
  JWT_SECRET: 'test-secret-at-least-32-characters-long',
};

describe('WorkerEnvSchema (KI-065, KI-032)', () => {
  it('применяет дефолты, когда переменные не заданы', () => {
    expect(WorkerEnvSchema.parse({})).toEqual({
      WORKFLOW_RUNS_CONCURRENCY: 5,
      WORKFLOW_RUNS_LOCK_DURATION_MS: 300_000,
      WORKFLOW_RUNS_MAX_STALLED_COUNT: 2,
      WORKFLOW_RUNS_STALE_THRESHOLD_MS: 300_000,
      // KI-387: изоляция очередей между инстансами.
      BULLMQ_PREFIX: 'workflow-runs',
      REDIS_QUEUE_DB: 0,
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
      BULLMQ_PREFIX: 'workflow-runs',
      REDIS_QUEUE_DB: 0,
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

describe('изоляция очередей BullMQ (R7.2b, KI-387)', () => {
  it('BULLMQ_PREFIX по умолчанию и из окружения', () => {
    expect(WorkerEnvSchema.parse({}).BULLMQ_PREFIX).toBe('workflow-runs');
    expect(
      WorkerEnvSchema.parse({ BULLMQ_PREFIX: 'workflow-runs-dev' }).BULLMQ_PREFIX,
    ).toBe('workflow-runs-dev');
  });

  it('пустой BULLMQ_PREFIX уходит в дефолт (KI-084)', () => {
    expect(WorkerEnvSchema.parse({ BULLMQ_PREFIX: '' }).BULLMQ_PREFIX).toBe(
      'workflow-runs',
    );
  });

  it('REDIS_QUEUE_DB парсится в число и ограничен 0..15', () => {
    expect(WorkerEnvSchema.parse({}).REDIS_QUEUE_DB).toBe(0);
    expect(WorkerEnvSchema.parse({ REDIS_QUEUE_DB: '3' }).REDIS_QUEUE_DB).toBe(3);
    expect(WorkerEnvSchema.safeParse({ REDIS_QUEUE_DB: '16' }).success).toBe(false);
    expect(WorkerEnvSchema.safeParse({ REDIS_QUEUE_DB: '-1' }).success).toBe(false);
    expect(WorkerEnvSchema.safeParse({ REDIS_QUEUE_DB: 'abc' }).success).toBe(false);
  });

  it('INSTANCE_ID опционален, пустая строка — «не задан»', () => {
    expect(WorkerEnvSchema.parse({}).INSTANCE_ID).toBeUndefined();
    expect(WorkerEnvSchema.parse({ INSTANCE_ID: '' }).INSTANCE_ID).toBeUndefined();
    expect(WorkerEnvSchema.parse({ INSTANCE_ID: 'dev' }).INSTANCE_ID).toBe('dev');
  });

  it('переменные попадают в общее окружение EnvSchema', () => {
    const parsed = EnvSchema.parse({
      ...baseEnv,
      BULLMQ_PREFIX: 'workflow-runs-smoke',
      REDIS_QUEUE_DB: '2',
      INSTANCE_ID: 'smoke',
    });

    expect(parsed.BULLMQ_PREFIX).toBe('workflow-runs-smoke');
    expect(parsed.REDIS_QUEUE_DB).toBe(2);
    expect(parsed.INSTANCE_ID).toBe('smoke');
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

describe('OPENAI_BASE_URL (R5.0, KI-084, KI-085)', () => {
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

  it('трактует пустую строку как «не задано» (KI-084)', () => {
    // `.env.example` содержит `OPENAI_BASE_URL=` — раньше это роняло старт.
    const parsed = EnvSchema.parse({ ...baseEnv, OPENAI_BASE_URL: '' });

    expect(parsed.OPENAI_BASE_URL).toBeUndefined();
  });

  it('отклоняет не-URL', () => {
    expect(EnvSchema.safeParse({ ...baseEnv, OPENAI_BASE_URL: 'not-a-url' }).success).toBe(
      false,
    );
  });

  it('отклоняет схемы кроме http/https (KI-085)', () => {
    expect(EnvSchema.safeParse({ ...baseEnv, OPENAI_BASE_URL: 'ftp://x.ru' }).success).toBe(
      false,
    );
    expect(EnvSchema.safeParse({ ...baseEnv, OPENAI_BASE_URL: 'ws://x.ru' }).success).toBe(
      false,
    );
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

describe('переменные провайдеров (v0.5.0)', () => {
  it('применяет дефолтные baseURL, когда переменные не заданы', () => {
    const parsed = EnvSchema.parse(baseEnv);

    expect(parsed.ROUTERAI_BASE_URL).toBe('https://routerai.ru/api/v1');
    expect(parsed.DEEPSEEK_BASE_URL).toBe('https://api.deepseek.com/v1');
    expect(parsed.YANDEX_BASE_URL).toBe('https://llm.api.cloud.yandex.net/v1');
    expect(parsed.LMSTUDIO_BASE_URL).toBe('http://localhost:1234/v1');
    expect(parsed.LMSTUDIO_MODELS).toBe('');
  });

  it('оставляет ключи провайдеров необязательными', () => {
    const parsed = EnvSchema.parse(baseEnv);

    expect(parsed.ROUTERAI_API_KEY).toBeUndefined();
    expect(parsed.DEEPSEEK_API_KEY).toBeUndefined();
    expect(parsed.YANDEX_API_KEY).toBeUndefined();
  });

  it('читает заполненные ключи и кастомные baseURL', () => {
    const parsed = EnvSchema.parse({
      ...baseEnv,
      ROUTERAI_API_KEY: 'sk-router',
      DEEPSEEK_API_KEY: 'sk-deepseek',
      YANDEX_API_KEY: 'sk-yandex',
      DEEPSEEK_BASE_URL: 'http://localhost:9999/v1',
      LMSTUDIO_MODELS: 'qwen2.5-7b-instruct,llama-3.3-70b',
    });

    expect(parsed.ROUTERAI_API_KEY).toBe('sk-router');
    expect(parsed.DEEPSEEK_API_KEY).toBe('sk-deepseek');
    expect(parsed.YANDEX_API_KEY).toBe('sk-yandex');
    expect(parsed.DEEPSEEK_BASE_URL).toBe('http://localhost:9999/v1');
    expect(parsed.LMSTUDIO_MODELS).toBe('qwen2.5-7b-instruct,llama-3.3-70b');
  });

  it('пустые ключи и baseURL трактуются как «не задано» (KI-084)', () => {
    const parsed = EnvSchema.parse({
      ...baseEnv,
      ROUTERAI_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      DEEPSEEK_BASE_URL: '',
      LMSTUDIO_MODELS: '',
    });

    expect(parsed.ROUTERAI_API_KEY).toBeUndefined();
    expect(parsed.DEEPSEEK_API_KEY).toBeUndefined();
    // Пустой baseURL уходит в дефолт, а не в ошибку.
    expect(parsed.DEEPSEEK_BASE_URL).toBe('https://api.deepseek.com/v1');
    expect(parsed.LMSTUDIO_MODELS).toBe('');
  });

  it('отклоняет не-http/https baseURL провайдера (KI-085)', () => {
    expect(
      EnvSchema.safeParse({ ...baseEnv, ROUTERAI_BASE_URL: 'ftp://routerai.ru' }).success,
    ).toBe(false);
    expect(
      EnvSchema.safeParse({ ...baseEnv, LMSTUDIO_BASE_URL: 'ws://localhost:1234' }).success,
    ).toBe(false);
  });
});

describe('переменные GPTunnel (v0.6.0b.1)', () => {
  it('все три переменные опциональны', () => {
    const parsed = EnvSchema.parse(baseEnv);

    expect(parsed.GPTUNNEL_API_KEY).toBeUndefined();
    // baseURL имеет дефолт, поэтому не undefined.
    expect(parsed.GPTUNNEL_BASE_URL).toBe('https://gptunnel.ru/v1');
    expect(parsed.GPTUNNEL_MODELS).toBe('');
  });

  it('пустые строки уходят в дефолты, а не в ошибку (KI-084)', () => {
    const parsed = EnvSchema.parse({
      ...baseEnv,
      GPTUNNEL_API_KEY: '',
      GPTUNNEL_BASE_URL: '',
      GPTUNNEL_MODELS: '',
    });

    expect(parsed.GPTUNNEL_API_KEY).toBeUndefined();
    expect(parsed.GPTUNNEL_BASE_URL).toBe('https://gptunnel.ru/v1');
    expect(parsed.GPTUNNEL_MODELS).toBe('');
  });

  it('читает список моделей и кастомный baseURL', () => {
    const parsed = EnvSchema.parse({
      ...baseEnv,
      GPTUNNEL_API_KEY: 'sk-gptunnel',
      GPTUNNEL_BASE_URL: 'https://proxy.example/v1',
      GPTUNNEL_MODELS: 'claude-5.5-sonnet:text+vision,gpt-5.6-luna:text',
    });

    expect(parsed.GPTUNNEL_API_KEY).toBe('sk-gptunnel');
    expect(parsed.GPTUNNEL_BASE_URL).toBe('https://proxy.example/v1');
    expect(parsed.GPTUNNEL_MODELS).toBe(
      'claude-5.5-sonnet:text+vision,gpt-5.6-luna:text',
    );
  });

  it('отклоняет не-http/https baseURL (KI-085)', () => {
    expect(
      EnvSchema.safeParse({ ...baseEnv, GPTUNNEL_BASE_URL: 'ftp://gptunnel.ru/v1' })
        .success,
    ).toBe(false);
  });
});

describe('AUTH_DISABLED в production (KI-213)', () => {
  it('отклоняет AUTH_DISABLED=true при NODE_ENV=production', () => {
    expect(() =>
      validateEnv({ ...baseEnv, NODE_ENV: 'production', AUTH_DISABLED: 'true' }),
    ).toThrow('AUTH_DISABLED=true недопустим в production');
  });

  it('принимает AUTH_DISABLED=false в production', () => {
    const result = validateEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      AUTH_DISABLED: 'false',
    });

    expect(result.AUTH_DISABLED).toBe(false);
  });

  it('разрешает AUTH_DISABLED=true в dev и CI', () => {
    const dev = EnvSchema.parse({ ...baseEnv, AUTH_DISABLED: 'true' });
    const test = EnvSchema.parse({
      ...baseEnv,
      NODE_ENV: 'test',
      AUTH_DISABLED: 'true',
    });

    expect(dev.AUTH_DISABLED).toBe(true);
    expect(test.AUTH_DISABLED).toBe(true);
  });

  it('не падает, если AUTH_DISABLED не задан', () => {
    const parsed = EnvSchema.parse({ ...baseEnv, NODE_ENV: 'production' });

    expect(parsed.AUTH_DISABLED).toBeUndefined();
  });
});

describe('COOKIE_SECURE в production (KI-220)', () => {
  it('отклоняет COOKIE_SECURE=false при NODE_ENV=production', () => {
    expect(() =>
      validateEnv({ ...baseEnv, NODE_ENV: 'production', COOKIE_SECURE: 'false' }),
    ).toThrow('COOKIE_SECURE=false недопустим в production');
  });

  it('принимает COOKIE_SECURE=true в production', () => {
    const result = validateEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
    });

    expect(result.COOKIE_SECURE).toBe(true);
  });
});

describe('staging / preprod считаются prod-подобными (KI-221)', () => {
  it('отклоняет AUTH_DISABLED=true при NODE_ENV=staging', () => {
    expect(() =>
      validateEnv({ ...baseEnv, NODE_ENV: 'staging', AUTH_DISABLED: 'true' }),
    ).toThrow('AUTH_DISABLED=true недопустим в production');
  });

  it('отклоняет COOKIE_SECURE=false при NODE_ENV=preprod', () => {
    expect(() =>
      validateEnv({ ...baseEnv, NODE_ENV: 'preprod', COOKIE_SECURE: 'false' }),
    ).toThrow('COOKIE_SECURE=false недопустим в production');
  });

  it('разрешает безопасные значения в staging', () => {
    const result = validateEnv({
      ...baseEnv,
      NODE_ENV: 'staging',
      AUTH_DISABLED: 'false',
      COOKIE_SECURE: 'true',
    });

    expect(result.AUTH_DISABLED).toBe(false);
    expect(result.COOKIE_SECURE).toBe(true);
  });
});

describe('TRUST_PROXY (R7.7, KI-419)', () => {
  it('по умолчанию выключен — прокси не доверяем', () => {
    expect(EnvSchema.parse(baseEnv).TRUST_PROXY).toBe(false);
    // Пустая строка в .env = «не задано» (KI-084), а не true.
    expect(EnvSchema.parse({ ...baseEnv, TRUST_PROXY: '' }).TRUST_PROXY).toBe(false);
  });

  it("различает 'true' и 'false' из .env", () => {
    expect(EnvSchema.parse({ ...baseEnv, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(EnvSchema.parse({ ...baseEnv, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(
      false,
    );
    expect(EnvSchema.parse({ ...baseEnv, TRUST_PROXY: true }).TRUST_PROXY).toBe(true);
    expect(EnvSchema.parse({ ...baseEnv, TRUST_PROXY: false }).TRUST_PROXY).toBe(false);
  });

  it('отклоняет мусор вместо булева значения', () => {
    expect(() => EnvSchema.parse({ ...baseEnv, TRUST_PROXY: 'yes' })).toThrow();
    expect(() => EnvSchema.parse({ ...baseEnv, TRUST_PROXY: '1' })).toThrow();
  });
});

describe('SANDBOX_* (R7.5, KI-364)', () => {
  it('дефолты: выключено, таймаут 100 мс, память 16 МБ', () => {
    const parsed = EnvSchema.parse(baseEnv);

    expect(parsed.SANDBOX_ENABLED).toBe(false);
    expect(parsed.SANDBOX_TIMEOUT_MS).toBe(100);
    expect(parsed.SANDBOX_MEMORY_MB).toBe(16);
  });

  it("SANDBOX_ENABLED понимает 'true'/'false' из .env", () => {
    expect(
      EnvSchema.parse({ ...baseEnv, SANDBOX_ENABLED: 'true' }).SANDBOX_ENABLED,
    ).toBe(true);
    expect(
      EnvSchema.parse({ ...baseEnv, SANDBOX_ENABLED: 'false' }).SANDBOX_ENABLED,
    ).toBe(false);
    // `.env.example` содержит `SANDBOX_ENABLED=false`, но пустая строка тоже
    // должна трактоваться как «не задано» (KI-084).
    expect(EnvSchema.parse({ ...baseEnv, SANDBOX_ENABLED: '' }).SANDBOX_ENABLED).toBe(
      false,
    );
  });

  it('отклоняет лимиты вне допустимых границ', () => {
    expect(() =>
      EnvSchema.parse({ ...baseEnv, SANDBOX_TIMEOUT_MS: '0' }),
    ).toThrow();
    expect(() =>
      EnvSchema.parse({ ...baseEnv, SANDBOX_MEMORY_MB: '257' }),
    ).toThrow();
  });
});
