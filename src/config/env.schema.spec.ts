import {
  DocumentTemplateEnvSchema,
  EnvSchema,
  LlmRouterEnvSchema,
  McpEnvSchema,
  NetworkSafetyEnvSchema,
  NodeRetryEnvSchema,
  RunLeaseEnvSchema,
  RuStorePushEnvSchema,
  SmtpEnvSchema,
  ThrottlerEnvSchema,
  VectorEnvSchema,
  WebSearchEnvSchema,
  WorkerEnvSchema,
  validateEnv,
} from './env.schema.js';

/** Минимально валидное окружение (обязательные URL и секрет подписи). */
const baseEnv = {
  DATABASE_URL: 'postgres://workflow:devpass123@127.0.0.1:5433/workflow_builder',
  REDIS_URL: 'redis://127.0.0.1:6379',
  // R6.1a: JWT_SECRET обязателен (min 32 символа).
  JWT_SECRET: 'test-secret-at-least-32-characters-long',
};

describe('PGVECTOR_ENABLED (v0.10 S0, KI-455)', () => {
  it('по умолчанию включён — обратная совместимость', () => {
    expect(VectorEnvSchema.parse({}).PGVECTOR_ENABLED).toBe(true);
    expect(EnvSchema.parse(baseEnv).PGVECTOR_ENABLED).toBe(true);
  });

  it('строго разбирает true/false и пустую строку', () => {
    expect(VectorEnvSchema.parse({ PGVECTOR_ENABLED: 'false' }).PGVECTOR_ENABLED).toBe(
      false,
    );
    expect(VectorEnvSchema.parse({ PGVECTOR_ENABLED: 'true' }).PGVECTOR_ENABLED).toBe(
      true,
    );
    expect(VectorEnvSchema.parse({ PGVECTOR_ENABLED: false }).PGVECTOR_ENABLED).toBe(
      false,
    );
    // KI-084: пустая переменная в .env — «не задана», а не ошибка.
    expect(VectorEnvSchema.parse({ PGVECTOR_ENABLED: '' }).PGVECTOR_ENABLED).toBe(true);
  });

  it('отклоняет мусор, а не включает/выключает флаг молча', () => {
    expect(VectorEnvSchema.safeParse({ PGVECTOR_ENABLED: 'yes' }).success).toBe(false);
    expect(VectorEnvSchema.safeParse({ PGVECTOR_ENABLED: '1' }).success).toBe(false);
  });
});

describe('web-search env (v0.10 S1, v0.15 S3)', () => {
  it('дефолты: провайдер tavily, ключи не заданы', () => {
    expect(WebSearchEnvSchema.parse({})).toEqual({
      WEB_SEARCH_PROVIDER: 'tavily',
    });

    const parsed = EnvSchema.parse(baseEnv);

    expect(parsed.WEB_SEARCH_PROVIDER).toBe('tavily');
    expect(parsed.TAVILY_API_KEY).toBeUndefined();
    expect(parsed.BING_API_KEY).toBeUndefined();
    expect(parsed.BRAVE_API_KEY).toBeUndefined();
  });

  it('пустые ключи — «не заданы» (KI-084), значения читаются как есть', () => {
    const empty = WebSearchEnvSchema.parse({
      TAVILY_API_KEY: '',
      BING_API_KEY: '',
      BRAVE_API_KEY: '',
    });

    expect(empty.TAVILY_API_KEY).toBeUndefined();
    expect(empty.BING_API_KEY).toBeUndefined();
    expect(empty.BRAVE_API_KEY).toBeUndefined();

    const filled = WebSearchEnvSchema.parse({
      TAVILY_API_KEY: 'tvly-test',
      BING_API_KEY: 'bing-test',
      BRAVE_API_KEY: 'brave-test',
    });

    expect(filled.TAVILY_API_KEY).toBe('tvly-test');
    expect(filled.BING_API_KEY).toBe('bing-test');
    expect(filled.BRAVE_API_KEY).toBe('brave-test');
  });

  it.each(['tavily', 'bing', 'brave'] as const)(
    'принимает провайдера %s',
    (provider) => {
      expect(
        WebSearchEnvSchema.parse({ WEB_SEARCH_PROVIDER: provider })
          .WEB_SEARCH_PROVIDER,
      ).toBe(provider);
    },
  );

  it('отклоняет неизвестного провайдера, а не фолбэчит молча', () => {
    expect(
      WebSearchEnvSchema.safeParse({ WEB_SEARCH_PROVIDER: 'google' }).success,
    ).toBe(false);
    expect(() =>
      validateEnv({ ...baseEnv, WEB_SEARCH_PROVIDER: 'google' }),
    ).toThrow('Некорректная конфигурация окружения');
  });
});

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

describe('S3_PUBLIC_BUCKET (KI-444)', () => {
  it('по умолчанию false — приватный бакет и presigned GET', () => {
    expect(EnvSchema.parse(baseEnv).S3_PUBLIC_BUCKET).toBe(false);
    // Пустая строка в .env = «не задано» (KI-084).
    expect(EnvSchema.parse({ ...baseEnv, S3_PUBLIC_BUCKET: '' }).S3_PUBLIC_BUCKET).toBe(
      false,
    );
  });

  it("различает 'true' и 'false' из .env", () => {
    expect(
      EnvSchema.parse({ ...baseEnv, S3_PUBLIC_BUCKET: 'true' }).S3_PUBLIC_BUCKET,
    ).toBe(true);
    expect(
      EnvSchema.parse({ ...baseEnv, S3_PUBLIC_BUCKET: 'false' }).S3_PUBLIC_BUCKET,
    ).toBe(false);
    expect(
      EnvSchema.parse({ ...baseEnv, S3_PUBLIC_BUCKET: true }).S3_PUBLIC_BUCKET,
    ).toBe(true);
    expect(
      EnvSchema.parse({ ...baseEnv, S3_PUBLIC_BUCKET: false }).S3_PUBLIC_BUCKET,
    ).toBe(false);
  });

  it('отклоняет мусор вместо булева значения', () => {
    expect(() => EnvSchema.parse({ ...baseEnv, S3_PUBLIC_BUCKET: 'yes' })).toThrow();
    expect(() => EnvSchema.parse({ ...baseEnv, S3_PUBLIC_BUCKET: '1' })).toThrow();
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

/**
 * Допустимый диапазон числового env-ключа v0.11 (границы включительно).
 *
 * Таблица вместо копипасты: у новых ключей проверка «дефолт + обе границы»
 * отличается только именем и числами.
 */
interface EnvIntegerBound {
  readonly key: string;
  readonly min: number;
  readonly max: number;
}

/**
 * Проверяет, что схема принимает обе границы и отвергает значения за ними.
 *
 * Заодно проверяется, что нечисловая строка — ошибка, а не «0» после
 * `Number('')`/`Number('abc')`: молчаливый 0 включил бы лимит на минимуме.
 *
 * @param schema - Zod-схема группы env-ключей
 * @param bounds - ключи и допустимые диапазоны
 */
function expectIntegerBounds(
  schema: { safeParse: (value: unknown) => { success: boolean } },
  bounds: readonly EnvIntegerBound[],
): void {
  for (const { key, min, max } of bounds) {
    expect(
      schema.safeParse({ [key]: String(min) }).success,
      `${key}: нижняя граница ${min}`,
    ).toBe(true);
    expect(
      schema.safeParse({ [key]: String(max) }).success,
      `${key}: верхняя граница ${max}`,
    ).toBe(true);
    expect(
      schema.safeParse({ [key]: String(min - 1) }).success,
      `${key}: ниже нижней границы ${min}`,
    ).toBe(false);
    expect(
      schema.safeParse({ [key]: String(max + 1) }).success,
      `${key}: выше верхней границы ${max}`,
    ).toBe(false);
    expect(
      schema.safeParse({ [key]: 'abc' }).success,
      `${key}: нечисловое значение`,
    ).toBe(false);
  }
}

/** Диапазоны лимитов DOCX-шаблонов (DESIGN v0.11 § 3.1.9). */
const DOCUMENT_TEMPLATE_BOUNDS: readonly EnvIntegerBound[] = [
  { key: 'DOCUMENT_TEMPLATE_MAX_BYTES', min: 1024, max: 20_971_520 },
  {
    key: 'DOCUMENT_TEMPLATE_MAX_UNCOMPRESSED_BYTES',
    min: 1_048_576,
    max: 209_715_200,
  },
  { key: 'DOCUMENT_TEMPLATE_MAX_ENTRIES', min: 10, max: 10_000 },
  { key: 'DOCUMENT_TEMPLATE_MAX_PER_WORKFLOW', min: 1, max: 500 },
  {
    key: 'DOCUMENT_TEMPLATE_MAX_VARIABLES_BYTES',
    min: 1024,
    max: 2_097_152,
  },
];

/** Диапазоны таймаутов и лимитов MCP (DESIGN v0.11 § 3.2.1, § 4.3). */
const MCP_BOUNDS: readonly EnvIntegerBound[] = [
  { key: 'MCP_CONNECT_TIMEOUT_MS', min: 1000, max: 60_000 },
  { key: 'MCP_REQUEST_TIMEOUT_MS', min: 1000, max: 300_000 },
  { key: 'MCP_CATALOG_TTL_MS', min: 5000, max: 600_000 },
  { key: 'MCP_MAX_TOOLS_PER_SERVER', min: 1, max: 500 },
  { key: 'MCP_MAX_TOOLS_PER_NODE', min: 1, max: 20 },
  { key: 'MCP_MAX_RESULT_CHARS', min: 500, max: 20_000 },
];

/** Диапазоны дефолтов повторов узлов (DESIGN v0.11 § 3.3.2). */
const NODE_RETRY_BOUNDS: readonly EnvIntegerBound[] = [
  { key: 'NODE_RETRY_MAX_ATTEMPTS', min: 1, max: 5 },
  { key: 'NODE_RETRY_BASE_DELAY_MS', min: 100, max: 10_000 },
  { key: 'NODE_RETRY_MAX_DELAY_MS', min: 1000, max: 60_000 },
  { key: 'NODE_RETRY_JITTER_MS', min: 0, max: 2000 },
];

describe('Document templates env (v0.11 S0)', () => {
  it('дефолты совпадают с DESIGN § 3.1.9', () => {
    expect(DocumentTemplateEnvSchema.parse({})).toMatchObject({
      DOCUMENT_TEMPLATE_MAX_BYTES: 5_242_880,
      DOCUMENT_TEMPLATE_MAX_UNCOMPRESSED_BYTES: 52_428_800,
      DOCUMENT_TEMPLATE_MAX_ENTRIES: 2000,
      DOCUMENT_TEMPLATE_MAX_PER_WORKFLOW: 50,
      DOCUMENT_TEMPLATE_MAX_VARIABLES_BYTES: 262_144,
    });
  });

  it('принимает обе границы диапазона и отвергает выход за них', () => {
    expectIntegerBounds(DocumentTemplateEnvSchema, DOCUMENT_TEMPLATE_BOUNDS);
  });

  it('переменные попадают в общее окружение EnvSchema', () => {
    const parsed = EnvSchema.parse({
      ...baseEnv,
      DOCUMENT_TEMPLATE_MAX_BYTES: '1048576',
      DOCUMENT_TEMPLATE_MAX_ENTRIES: '500',
    });

    expect(parsed.DOCUMENT_TEMPLATE_MAX_BYTES).toBe(1_048_576);
    expect(parsed.DOCUMENT_TEMPLATE_MAX_ENTRIES).toBe(500);
    // Остальные — дефолты схемы.
    expect(parsed.DOCUMENT_TEMPLATE_MAX_PER_WORKFLOW).toBe(50);
  });
});

describe('MCP env (v0.11 S0, stdio — v0.12 S4)', () => {
  it('дефолты: MCP выключен, stdio выключен, реестр пустой, лимиты DESIGN § 4.3', () => {
    expect(McpEnvSchema.parse({})).toMatchObject({
      MCP_ENABLED: false,
      MCP_ENABLE_STDIO: false,
      MCP_SERVERS: '{}',
      MCP_CONNECT_TIMEOUT_MS: 10_000,
      MCP_REQUEST_TIMEOUT_MS: 30_000,
      MCP_CATALOG_TTL_MS: 60_000,
      MCP_MAX_TOOLS_PER_SERVER: 200,
      MCP_MAX_TOOLS_PER_NODE: 20,
      MCP_MAX_RESULT_CHARS: 4000,
      // v0.13 S1: env allowlist и каталог изоляции stdio-процессов.
      MCP_STDIO_ENV_ALLOWLIST: '',
      MCP_STDIO_CWD: './data/mcp',
    });
  });

  it("MCP_ENABLED строго разбирает 'true'/'false', мусор — ошибка", () => {
    expect(McpEnvSchema.parse({ MCP_ENABLED: 'true' }).MCP_ENABLED).toBe(true);
    expect(McpEnvSchema.parse({ MCP_ENABLED: 'false' }).MCP_ENABLED).toBe(false);
    expect(McpEnvSchema.safeParse({ MCP_ENABLED: 'garbage' }).success).toBe(false);
    // RULES 4.35: не строка 'true'/'false' — ошибка, а не молчаливый true.
    expect(McpEnvSchema.safeParse({ MCP_ENABLED: '1' }).success).toBe(false);
    // KI-084: пустая переменная в .env — «не задана», уходит в дефолт false.
    expect(McpEnvSchema.parse({ MCP_ENABLED: '' }).MCP_ENABLED).toBe(false);
  });

  it("MCP_ENABLE_STDIO (v0.12 S4): строгий boolean, default false", () => {
    expect(McpEnvSchema.parse({}).MCP_ENABLE_STDIO).toBe(false);
    expect(McpEnvSchema.parse({ MCP_ENABLE_STDIO: 'true' }).MCP_ENABLE_STDIO).toBe(
      true,
    );
    expect(
      McpEnvSchema.parse({ MCP_ENABLE_STDIO: 'false' }).MCP_ENABLE_STDIO,
    ).toBe(false);
    // Запуск локального процесса не включается «сам» из '1'/'yes'.
    expect(McpEnvSchema.safeParse({ MCP_ENABLE_STDIO: '1' }).success).toBe(false);
    expect(McpEnvSchema.parse({ MCP_ENABLE_STDIO: '' }).MCP_ENABLE_STDIO).toBe(
      false,
    );
  });

  it('MCP_SERVERS — строка (разбор JSON отложен до S6)', () => {
    expect(
      McpEnvSchema.parse({ MCP_SERVERS: '{"filesystem":{"transport":"http"}}' })
        .MCP_SERVERS,
    ).toBe('{"filesystem":{"transport":"http"}}');
    // Объект принимается только после появления JSON-парсера в S6.
    expect(McpEnvSchema.safeParse({ MCP_SERVERS: {} }).success).toBe(false);
  });

  it('MCP_STDIO_ENV_ALLOWLIST (v0.13 S1): default — пустая строка', () => {
    expect(McpEnvSchema.parse({}).MCP_STDIO_ENV_ALLOWLIST).toBe('');
    // Значение — как есть: разбор списка делает клиент (parseStdioEnvAllowlist).
    expect(
      McpEnvSchema.parse({
        MCP_STDIO_ENV_ALLOWLIST: 'GITHUB_TOKEN, MCP_SERVER_MODE',
      }).MCP_STDIO_ENV_ALLOWLIST,
    ).toBe('GITHUB_TOKEN, MCP_SERVER_MODE');
    // KI-084: пустая переменная в .env — «не задана», а не ошибка старта.
    expect(
      McpEnvSchema.parse({ MCP_STDIO_ENV_ALLOWLIST: '' }).MCP_STDIO_ENV_ALLOWLIST,
    ).toBe('');
  });

  it('MCP_STDIO_CWD (v0.13 S1): default ./data/mcp, пустое — дефолт', () => {
    expect(McpEnvSchema.parse({}).MCP_STDIO_CWD).toBe('./data/mcp');
    expect(
      McpEnvSchema.parse({ MCP_STDIO_CWD: './var/mcp-servers' }).MCP_STDIO_CWD,
    ).toBe('./var/mcp-servers');
    expect(McpEnvSchema.parse({ MCP_STDIO_CWD: '' }).MCP_STDIO_CWD).toBe(
      './data/mcp',
    );
    // Пробельная строка — не путь: лучше ошибка старта, чем cwd «   ».
    expect(McpEnvSchema.safeParse({ MCP_STDIO_CWD: '   ' }).success).toBe(false);
  });

  it('принимает обе границы int-лимитов и отвергает выход за них', () => {
    expectIntegerBounds(McpEnvSchema, MCP_BOUNDS);
  });
});

describe('Run lease / heartbeat env (v0.11 S1, KI-066)', () => {
  it('дефолты: heartbeat 30 с, TTL 90 с', () => {
    expect(RunLeaseEnvSchema.parse({})).toMatchObject({
      WORKFLOW_RUN_HEARTBEAT_MS: 30_000,
      WORKFLOW_RUN_LEASE_TTL_MS: 90_000,
    });
  });

  it('heartbeat ограничен 5000..300000, TTL — целое число', () => {
    expectIntegerBounds(RunLeaseEnvSchema, [
      { key: 'WORKFLOW_RUN_HEARTBEAT_MS', min: 5000, max: 300_000 },
    ]);
    expect(
      RunLeaseEnvSchema.safeParse({ WORKFLOW_RUN_LEASE_TTL_MS: '1.5' }).success,
    ).toBe(false);
  });

  it('superRefine: TTL < 2 × heartbeat — ошибка, TTL == 2 × heartbeat — ок', () => {
    expect(
      EnvSchema.safeParse({
        ...baseEnv,
        WORKFLOW_RUN_HEARTBEAT_MS: '30000',
        WORKFLOW_RUN_LEASE_TTL_MS: '59999',
      }).success,
    ).toBe(false);
    expect(
      EnvSchema.safeParse({
        ...baseEnv,
        WORKFLOW_RUN_HEARTBEAT_MS: '30000',
        WORKFLOW_RUN_LEASE_TTL_MS: '60000',
      }).success,
    ).toBe(true);
    expect(() =>
      validateEnv({
        ...baseEnv,
        WORKFLOW_RUN_HEARTBEAT_MS: '60000',
        WORKFLOW_RUN_LEASE_TTL_MS: '1000',
      }),
    ).toThrow('WORKFLOW_RUN_LEASE_TTL_MS');
  });

  it('дефолты проходят кросс-проверку в общем EnvSchema', () => {
    const parsed = EnvSchema.parse(baseEnv);

    expect(parsed.WORKFLOW_RUN_HEARTBEAT_MS).toBe(30_000);
    expect(parsed.WORKFLOW_RUN_LEASE_TTL_MS).toBe(90_000);
  });
});

describe('Node retry env (v0.11 S1, KI-104)', () => {
  it('дефолты и границы DESIGN § 3.3.2', () => {
    expect(NodeRetryEnvSchema.parse({})).toMatchObject({
      NODE_RETRY_MAX_ATTEMPTS: 3,
      NODE_RETRY_BASE_DELAY_MS: 500,
      NODE_RETRY_MAX_DELAY_MS: 10_000,
      NODE_RETRY_JITTER_MS: 250,
    });
    expectIntegerBounds(NodeRetryEnvSchema, NODE_RETRY_BOUNDS);
  });
});

describe('Throttler env (v0.11 S5, KI-420)', () => {
  it('дефолты: Redis и префикс throttle:v1', () => {
    expect(ThrottlerEnvSchema.parse({})).toMatchObject({
      THROTTLER_STORAGE: 'redis',
      THROTTLER_KEY_PREFIX: 'throttle:v1',
    });
  });

  it('storage — только redis/memory, префикс не пустой', () => {
    expect(
      ThrottlerEnvSchema.parse({ THROTTLER_STORAGE: 'memory' }).THROTTLER_STORAGE,
    ).toBe('memory');
    expect(
      ThrottlerEnvSchema.safeParse({ THROTTLER_STORAGE: 'postgres' }).success,
    ).toBe(false);
    expect(
      ThrottlerEnvSchema.safeParse({ THROTTLER_KEY_PREFIX: '' }).success,
    ).toBe(false);
  });
});

describe('HTTP_NODE_ALLOW_PRIVATE_NETWORKS (v0.11 S14, KI-434/435/478)', () => {
  it('по умолчанию false — SSRF-защита http-узла включена', () => {
    expect(
      NetworkSafetyEnvSchema.parse({}).HTTP_NODE_ALLOW_PRIVATE_NETWORKS,
    ).toBe(false);
    expect(EnvSchema.parse(baseEnv).HTTP_NODE_ALLOW_PRIVATE_NETWORKS).toBe(false);
  });

  it("строго разбирает 'true'/'false', мусор — ошибка", () => {
    expect(
      NetworkSafetyEnvSchema.parse({
        HTTP_NODE_ALLOW_PRIVATE_NETWORKS: 'true',
      }).HTTP_NODE_ALLOW_PRIVATE_NETWORKS,
    ).toBe(true);
    expect(
      NetworkSafetyEnvSchema.parse({
        HTTP_NODE_ALLOW_PRIVATE_NETWORKS: 'false',
      }).HTTP_NODE_ALLOW_PRIVATE_NETWORKS,
    ).toBe(false);
    expect(
      NetworkSafetyEnvSchema.safeParse({
        HTTP_NODE_ALLOW_PRIVATE_NETWORKS: 'garbage',
      }).success,
    ).toBe(false);
    // KI-084: пустая переменная в .env — «не задана», защита остаётся включена.
    expect(
      NetworkSafetyEnvSchema.parse({
        HTTP_NODE_ALLOW_PRIVATE_NETWORKS: '',
      }).HTTP_NODE_ALLOW_PRIVATE_NETWORKS,
    ).toBe(false);
  });
});

describe('SMTP env (v1.1.0 S1, DESIGN V110 § 3.1)', () => {
  it('дефолты: почта не настроена, порт 587, secure=false, адрес отправителя и APP_PUBLIC_URL', () => {
    expect(SmtpEnvSchema.parse({})).toEqual({
      SMTP_PORT: 587,
      SMTP_FROM: 'noreply@workflow-builder.local',
      SMTP_SECURE: false,
      APP_PUBLIC_URL: 'http://localhost:3000',
    });

    const parsed = EnvSchema.parse(baseEnv);

    expect(parsed.SMTP_HOST).toBeUndefined();
    expect(parsed.SMTP_USER).toBeUndefined();
    expect(parsed.SMTP_PASS).toBeUndefined();
    expect(parsed.SMTP_PORT).toBe(587);
    expect(parsed.SMTP_SECURE).toBe(false);
    expect(parsed.APP_PUBLIC_URL).toBe('http://localhost:3000');
    // Пустая переменная в .env — «не задана» (KI-084): fallback остаётся WARN.
    expect(
      SmtpEnvSchema.parse({ SMTP_HOST: '' }).SMTP_HOST,
    ).toBeUndefined();
  });

  it('SMTP_SECURE — строгий boolean (RULES 4.35), мусор отклоняется', () => {
    expect(SmtpEnvSchema.parse({ SMTP_SECURE: 'true' }).SMTP_SECURE).toBe(true);
    expect(SmtpEnvSchema.parse({ SMTP_SECURE: 'false' }).SMTP_SECURE).toBe(false);
    expect(SmtpEnvSchema.parse({ SMTP_SECURE: true }).SMTP_SECURE).toBe(true);
    expect(SmtpEnvSchema.parse({ SMTP_SECURE: false }).SMTP_SECURE).toBe(false);
    // `z.coerce.boolean()` здесь дал бы true на строку 'false' — гейт против
    // регресса: строка 'false' обязана остаться false.
    expect(SmtpEnvSchema.parse({ SMTP_SECURE: 'false' }).SMTP_SECURE).not.toBe(true);
    expect(SmtpEnvSchema.safeParse({ SMTP_SECURE: 'yes' }).success).toBe(false);
    expect(SmtpEnvSchema.safeParse({ SMTP_SECURE: '1' }).success).toBe(false);
    // Пустая строка — «не задана», остаётся дефолт false.
    expect(SmtpEnvSchema.parse({ SMTP_SECURE: '' }).SMTP_SECURE).toBe(false);
  });

  it('порт приводится к числу и ограничен диапазоном', () => {
    expect(SmtpEnvSchema.parse({ SMTP_PORT: '2525' }).SMTP_PORT).toBe(2525);
    expect(() => SmtpEnvSchema.parse({ SMTP_PORT: '0' })).toThrow();
    expect(() => SmtpEnvSchema.parse({ SMTP_PORT: '70000' })).toThrow();
    expect(() => SmtpEnvSchema.parse({ SMTP_PORT: 'abc' })).toThrow();
  });

  it('APP_PUBLIC_URL: только http(s), без пустого значения', () => {
    expect(
      SmtpEnvSchema.parse({ APP_PUBLIC_URL: 'https://app.example.com' })
        .APP_PUBLIC_URL,
    ).toBe('https://app.example.com');
    expect(() =>
      SmtpEnvSchema.parse({ APP_PUBLIC_URL: 'ftp://example.com' }),
    ).toThrow();
    expect(() => SmtpEnvSchema.parse({ APP_PUBLIC_URL: 'not-a-url' })).toThrow();
    // Пустое значение — дефолт локального запуска.
    expect(SmtpEnvSchema.parse({ APP_PUBLIC_URL: '' }).APP_PUBLIC_URL).toBe(
      'http://localhost:3000',
    );
  });
});

describe('LLM Router env (v1.2 S1, DESIGN V120 § 3.1)', () => {
  it('дефолты: роутер выключен, fallback gpt-4o-mini', () => {
    const parsed = EnvSchema.parse(baseEnv);

    expect(parsed.LLM_ROUTER_ENABLED).toBe(false);
    expect(parsed.LLM_ROUTER_FALLBACK_MODEL).toBe('gpt-4o-mini');
  });

  it("строго разбирает 'true'/'false' и пустую строку (RULES 4.35)", () => {
    expect(
      LlmRouterEnvSchema.parse({ LLM_ROUTER_ENABLED: 'true' }).LLM_ROUTER_ENABLED,
    ).toBe(true);
    expect(
      LlmRouterEnvSchema.parse({ LLM_ROUTER_ENABLED: 'false' }).LLM_ROUTER_ENABLED,
    ).toBe(false);
    // Строка 'false' не должна превращаться в true (ловушка coerce.boolean).
    expect(EnvSchema.parse({ ...baseEnv, LLM_ROUTER_ENABLED: 'false' }).LLM_ROUTER_ENABLED).toBe(
      false,
    );
    expect(
      EnvSchema.parse({ ...baseEnv, LLM_ROUTER_ENABLED: '' }).LLM_ROUTER_ENABLED,
    ).toBe(false);
    expect(() =>
      EnvSchema.parse({ ...baseEnv, LLM_ROUTER_ENABLED: 'yes' }),
    ).toThrow();
  });

  it('fallback-модель: пустое значение уходит в дефолт (KI-084)', () => {
    expect(
      LlmRouterEnvSchema.parse({ LLM_ROUTER_FALLBACK_MODEL: '' })
        .LLM_ROUTER_FALLBACK_MODEL,
    ).toBe('gpt-4o-mini');
    expect(
      LlmRouterEnvSchema.parse({ LLM_ROUTER_FALLBACK_MODEL: '  gpt-4o  ' })
        .LLM_ROUTER_FALLBACK_MODEL,
    ).toBe('gpt-4o');
  });
});

describe('RuStore Push env (S4-B)', () => {
  it('обе переменные опциональны: без них отправка выключена, приложение поднимается', () => {
    expect(RuStorePushEnvSchema.parse({})).toEqual({});

    const parsed = EnvSchema.parse(baseEnv);

    expect(parsed.RUSTORE_PROJECT_ID).toBeUndefined();
    expect(parsed.RUSTORE_SERVICE_TOKEN).toBeUndefined();
  });

  it('пустые строки — «не заданы» (KI-084), значения тримятся', () => {
    const empty = RuStorePushEnvSchema.parse({
      RUSTORE_PROJECT_ID: '',
      RUSTORE_SERVICE_TOKEN: '',
    });

    expect(empty.RUSTORE_PROJECT_ID).toBeUndefined();
    expect(empty.RUSTORE_SERVICE_TOKEN).toBeUndefined();

    const filled = RuStorePushEnvSchema.parse({
      RUSTORE_PROJECT_ID: '  project-42  ',
      RUSTORE_SERVICE_TOKEN: ' service-token ',
    });

    expect(filled).toEqual({
      RUSTORE_PROJECT_ID: 'project-42',
      RUSTORE_SERVICE_TOKEN: 'service-token',
    });
  });

  it('переменные попадают в общее окружение EnvSchema', () => {
    const parsed = EnvSchema.parse({
      ...baseEnv,
      RUSTORE_PROJECT_ID: 'project-42',
      RUSTORE_SERVICE_TOKEN: 'service-token',
    });

    expect(parsed.RUSTORE_PROJECT_ID).toBe('project-42');
    expect(parsed.RUSTORE_SERVICE_TOKEN).toBe('service-token');
  });
});
