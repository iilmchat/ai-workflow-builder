import { z } from 'zod';

/**
 * Приводит пустую строку к `undefined`.
 *
 * Нужен для `.env`, где переменная объявлена, но не заполнена
 * (`OPENAI_BASE_URL=`): `z.string().optional()` пропускает только `undefined`,
 * поэтому пустая строка раньше роняла старт приложения (KI-084).
 *
 * @param value - сырое значение переменной окружения
 * @returns `undefined` для пустой строки, иначе исходное значение
 */
const emptyToUndefined = (value: unknown): unknown =>
  value === '' ? undefined : value;

/**
 * URL, допустимый для обращения к LLM API: только `http`/`https`.
 *
 * Без ограничения схемы `z.url()` принимает `ftp://` и `ws://` (KI-085),
 * а такие baseURL заведомо нерабочие.
 */
const httpUrl = z.url({ protocol: /^https?$/ });

/**
 * Zod-схема настроек воркера очереди workflow-runs (KI-065) и порога
 * «зависшего» запуска (KI-032).
 *
 * Вынесена отдельным объектом, потому что эти значения нужны в двух местах:
 * - `ConfigModule` (DI, fail-fast при старте — как часть {@link EnvSchema});
 * - декоратор `@Processor` в `RunsProcessor`: декораторы выполняются вне DI и не
 *   могут инжектить `ConfigService`, поэтому настройки читаются из `process.env`
 *   в момент объявления класса.
 *
 * Схема — единственный источник истины для дефолтов и границ, чтобы оба пути
 * проверяли одно и то же.
 */
export const WorkerEnvSchema = z.object({
  /**
   * Число одновременных заданий очереди workflow-runs, которые обрабатывает один
   * воркер (KI-065). Дефолт 5 — компромисс между throughput и нагрузкой на
   * БД/Redis/провайдера.
   */
  WORKFLOW_RUNS_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  /**
   * Длительность удержания job'а BullMQ (мс). Если job не завершился за это
   * время и не продлил lock, BullMQ считает его зависшим (stalled) и переотдаёт
   * другому воркеру. Дефолт BullMQ — 30 000, но реальные LLM-вызовы бывают
   * дольше, поэтому по умолчанию 5 минут — как `RUN_STALE_THRESHOLD_MS` (KI-023).
   */
  WORKFLOW_RUNS_LOCK_DURATION_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .default(300_000),
  /**
   * Сколько раз BullMQ может переотдать job при истечении lock'а, прежде чем
   * пометит его failed. Дефолт BullMQ — 1; при `concurrency > 1` и долгих узлах
   * значение повышено, иначе параллельный воркер «украдёт» job у медленного.
   */
  WORKFLOW_RUNS_MAX_STALLED_COUNT: z.coerce.number().int().min(0).max(10).default(2),
  /**
   * Порог «зависшего» запуска (мс, lease-проверка KI-023). Раньше был
   * захардкожен в `runs.constants.ts` — вынесен в окружение (KI-032).
   */
  WORKFLOW_RUNS_STALE_THRESHOLD_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .default(300_000),
  /**
   * Префикс ключей очередей BullMQ в Redis (KI-387).
   *
   * BullMQ по умолчанию использует префикс `bull`, поэтому несколько
   * backend-инстансов (dev + smoke + prod) на одном Redis видят **одну** очередь
   * и забирают чужие задания. Уникальный префикс на инстанс разводит очереди по
   * разным пространствам ключей: dev-задание физически не попадёт в очередь
   * боевого воркера. Дефолт `workflow-runs` сохраняет привычное имя.
   */
  BULLMQ_PREFIX: z.preprocess(
    emptyToUndefined,
    z.string().min(1).max(64).default('workflow-runs'),
  ),
  /**
   * Номер БД Redis для очередей BullMQ (KI-387).
   *
   * Альтернатива {@link BULLMQ_PREFIX}: отдельная логическая БД Redis (0–15).
   * Значение передаётся в опцию `connection.db` очереди и наследуется воркером.
   * Внимание: при заданном `db` он перекрывает путь `/N` в `REDIS_URL`.
   */
  REDIS_QUEUE_DB: z.coerce.number().int().min(0).max(15).default(0),
  /**
   * Идентификатор инстанса backend (KI-387, KI-391).
   *
   * Попадает в payload задания и сверяется воркером: задание, созданное другим
   * инстансом, пропускается. Если переменная не задана, идентификатор
   * строится как `os.hostname():PORT` и стабилен между рестартами процесса на
   * том же хосте/порту. Для параллельных инстансов на общем Redis задавайте
   * значение явно (например, `dev`, `smoke`, `prod`): в среде с эфемерным
   * hostname (Docker/Kubernetes) автоидентификатор меняется при пересоздании.
   */
  INSTANCE_ID: z.preprocess(
    emptyToUndefined,
    z.string().min(1).max(200).optional(),
  ),
});

/** Валидированные настройки воркера очереди workflow-runs и lease-порога. */
export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

/**
 * Zod-схема бюджета запуска (R7.1, KI-048).
 *
 * Лимиты вынесены отдельным объектом по той же причине, что и
 * {@link WorkerEnvSchema}: значения нужны и `ConfigModule` (DI, fail-fast), и
 * тестам/документации как единственный источник дефолтов.
 */
export const CostBudgetEnvSchema = z.object({
  /**
   * Максимальная стоимость запуска в USD (LLM-узлы). Дефолт 5 — совпадает с
   * DESIGN v0.9 § 2.6.
   */
  WORKFLOW_RUN_MAX_COST_USD: z.coerce.number().positive().default(5),
  /**
   * Максимальная стоимость запуска в рублях (media-узлы: CreativeLab тарифицирует
   * в рублях). Дефолт 500.
   */
  WORKFLOW_RUN_MAX_COST_RUB: z.coerce.number().positive().default(500),
  /**
   * Режим бюджета: `hard` — превышение блокирует вызов провайдера (узел
   * `failed`), `soft` — только предупреждение в лог (DESIGN § 2.6).
   */
  WORKFLOW_RUN_BUDGET_MODE: z.enum(['hard', 'soft']).default('hard'),
  /**
   * Курс RUB→USD для нормализации лимитов в одну шкалу (сколько рублей в
   * долларе). Нужен, потому что лимиты заданы в двух валютах, а UI и текст
   * ошибки показывают одну цифру. Дефолт 100 — грубая оценка; в проде
   * значение задаётся из окружения.
   */
  WORKFLOW_RUN_USD_RUB_RATE: z.coerce.number().positive().default(100),
});

/** Валидированные настройки бюджета запуска. */
export type CostBudgetEnv = z.infer<typeof CostBudgetEnvSchema>;

/**
 * Zod-схема прямых image-провайдеров (R7.3, DESIGN v0.9 § 3.3).
 *
 * Replicate / FAL / OpenAI Images ходят в свои API напрямую, а не через
 * GPTunnel CreativeLab. Все ключи опциональны: без ключа провайдер не
 * регистрируется (`isConfigured === false`), приложение поднимается, а
 * `GET /media/models` просто не показывает его модели.
 *
 * Вынесена отдельным объектом по той же причине, что {@link WorkerEnvSchema} и
 * {@link CostBudgetEnvSchema}: это единственный источник дефолтов, а значения
 * нужны и `ConfigModule`, и `MediaModule` (сборка массива провайдеров).
 */
export const MediaDirectEnvSchema = z.object({
  // === Replicate (100+ моделей, REST API) ===
  /** Токен Replicate. Без него провайдер не регистрируется. */
  REPLICATE_API_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Base URL Replicate API (дефолт — публичный `https://api.replicate.com/v1`). */
  REPLICATE_BASE_URL: z
    .preprocess(emptyToUndefined, httpUrl.optional())
    .default('https://api.replicate.com/v1'),

  // === FAL (fast inference: flux, SDXL, Kling, ...) ===
  /** Ключ FAL. Без него провайдер не регистрируется. */
  FAL_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Base URL FAL (дефолт — `https://fal.run`; очередь — `https://queue.fal.run`). */
  FAL_BASE_URL: z
    .preprocess(emptyToUndefined, httpUrl.optional())
    .default('https://fal.run'),

  // === OpenAI Images (gpt-image-1, dall-e-3) ===
  /**
   * Ключ OpenAI Images. Может совпадать с ключом chat (`OPENAI_API_KEY`) —
   * тогда достаточно оставить эту переменную пустой, а ключ возьмётся из
   * `OPENAI_API_KEY` (fallback).
   */
  OPENAI_IMAGES_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Base URL OpenAI Images (дефолт — публичный `https://api.openai.com/v1`). */
  OPENAI_IMAGES_BASE_URL: z
    .preprocess(emptyToUndefined, httpUrl.optional())
    .default('https://api.openai.com/v1'),

  // === Приоритет провайдеров ===
  /**
   * Порядок провайдеров при коллизии id модели (DESIGN v0.9 § 3.3):
   * `creativelab,replicate,fal,openai_images`. Первый в списке побеждает.
   * Неизвестные имена игнорируются, отсутствующие дописываются в конец.
   */
  MEDIA_PROVIDER_PRIORITY: z
    .preprocess(emptyToUndefined, z.string().optional())
    .default('creativelab,replicate,fal,openai_images'),

  /**
   * Курс USD→RUB для оценки стоимости моделей Replicate/FAL: их каталог
   * тарифицируется в долларах, а бюджет и тарифы media-узлов считаются в
   * рублях (R7.1, KI-048). Без пересчёта такие модели получали бы нулевую
   * оценку и обходили предохранитель бюджета.
   */
  MEDIA_USD_RUB_RATE: z.coerce.number().positive().default(100),
});

/** Валидированные настройки прямых image-провайдеров (R7.3). */
export type MediaDirectEnv = z.infer<typeof MediaDirectEnvSchema>;

/**
 * Zod-схема WASM-песочницы QuickJS (R7.5, KI-364).
 *
 * `SANDBOX_ENABLED` — аварийный выключатель: по умолчанию `false`, потому что
 * режим `sandbox` исполняет пользовательский код (пусть и изолированный) и
 * требует осознанного включения. При `false` узел `condition` с `mode:
 * 'sandbox'` падает с понятной ошибкой, а режим `dsl` работает всегда.
 *
 * Вынесена отдельным объектом по той же причине, что {@link WorkerEnvSchema}:
 * значения нужны и `ConfigModule` (DI, fail-fast), и тестам как единственный
 * источник дефолтов.
 */
export const SandboxEnvSchema = z.object({
  /**
   * Включён ли режим `sandbox` (default false). Строка `'true'`/`'false'`
   * (как в `.env`) или boolean (как после `validateEnv`).
   */
  SANDBOX_ENABLED: z
    .preprocess(
      emptyToUndefined,
      z
        .union([z.boolean(), z.enum(['true', 'false'])])
        .transform((value) => value === true || value === 'true')
        .optional(),
    )
    .default(false),
  /**
   * Таймаут вычисления в песочнице, мс (default 100). Значение меньше 1 или
   * больше 5000 обрезается в коде-потребителе (защита от «вечного» узла).
   */
  SANDBOX_TIMEOUT_MS: z
    .preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(5000).optional())
    .default(100),
  /**
   * Лимит памяти песочницы, МБ (default 16). Верхняя граница 256 МБ — чтобы
   * опечатка в `.env` не съела память процесса.
   */
  SANDBOX_MEMORY_MB: z
    .preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(256).optional())
    .default(16),
});

/** Валидированные настройки WASM-песочницы (R7.5). */
export type SandboxEnv = z.infer<typeof SandboxEnvSchema>;

/**
 * Zod-схема лимитов agent-узла (R7.4b, DESIGN v0.9 § 3.4).
 *
 * Значения — **дефолты узла**, а не жёсткие лимиты запуска: `data.maxIterations`
 * и `data.maxTokensPerStep` переопределяют их на конкретном узле. Схема
 * ограничивает env теми же границами, что UI (1–10 итераций), чтобы опечатка
 * в `.env` не превратила агента в бесконечный цикл платных вызовов.
 */
export const AgentEnvSchema = z.object({
  /**
   * Лимит итераций цикла агента по умолчанию (default 5, диапазон 1–10).
   *
   * При исчерпании узел падает `AgentIterationLimitException` — запуск не
   * висит, а честно сообщает, что модель не дошла до финального ответа.
   */
  AGENT_MAX_ITERATIONS_DEFAULT: z
    .preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(10).optional())
    .default(5),
  /**
   * Лимит токенов ответа на одну итерацию (default 2048, до 8192).
   *
   * Каждый шаг — отдельный платный вызов, поэтому лимит ограничен сверху:
   * агент не должен «думать» на 32k токенов в каждом шаге.
   */
  AGENT_MAX_TOKENS_PER_STEP_DEFAULT: z
    .preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(8192).optional())
    .default(2048),
});

/** Валидированные настройки agent-узла (R7.4b). */
export type AgentEnv = z.infer<typeof AgentEnvSchema>;

/**
 * Zod-схема наблюдаемости (R7.7, KI-365).
 *
 * `OTEL_ENABLED` — аварийный выключатель: по умолчанию `false`, потому что
 * `NodeSDK.start()` подменяет глобальный провайдер трассировки во всём
 * процессе и держит фоновый экспортёр (процесс не завершается без `shutdown`).
 * Включать осознанно — когда есть коллектор.
 */
export const ObservabilityEnvSchema = z.object({
  /**
   * Включена ли трассировка (default false). Строка `'true'`/`'false'`
   * (как в `.env`) или boolean (как после `validateEnv`).
   */
  OTEL_ENABLED: z
    .preprocess(
      emptyToUndefined,
      z
        .union([z.boolean(), z.enum(['true', 'false'])])
        .transform((value) => value === true || value === 'true')
        .optional(),
    )
    .default(false),
  /**
   * Базовый URL OTLP/HTTP-коллектора (default `http://localhost:4318`).
   * Экспортёр ходит на `${endpoint}/v1/traces`.
   */
  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .preprocess(emptyToUndefined, httpUrl.optional())
    .default('http://localhost:4318'),
  /** Имя сервиса в телеметрии (`service.name`), default `workflow-builder`. */
  OTEL_SERVICE_NAME: z
    .preprocess(emptyToUndefined, z.string().min(1).max(128).optional())
    .default('workflow-builder'),
});

/** Валидированные настройки наблюдаемости (R7.7). */
export type ObservabilityEnv = z.infer<typeof ObservabilityEnvSchema>;

/**
 * Zod-схема хранилища media-результатов (R7.8, KI-362).
 *
 * `local` (default) — файлы на диске (`./data/media`), `s3` — внешнее
 * S3-совместимое хранилище (загрузка через `@aws-sdk/lib-storage`, KI-412),
 * `none` — ничего не сохраняем (ссылки провайдера живут 48 ч).
 */
export const MediaStorageEnvSchema = z.object({
  /** Бэкенд хранилища: `local`, `s3` или `none` (default `local`). */
  MEDIA_STORAGE_BACKEND: z
    .preprocess(emptyToUndefined, z.enum(['local', 's3', 'none']).optional())
    .default('local'),
  /** Каталог локального хранилища (default `./data/media`). */
  MEDIA_STORAGE_LOCAL_PATH: z
    .preprocess(emptyToUndefined, z.string().min(1).optional())
    .default('./data/media'),
  /**
   * TTL локального хранилища в днях (default 30). `0` — без срока
   * (`stored_expires_at = NULL`): файлы не удаляются автоматически.
   */
  MEDIA_STORAGE_LOCAL_TTL_DAYS: z
    .preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(3650).optional())
    .default(30),
  /** S3-совместимый endpoint (AWS S3, MinIO, R2, Yandex Object Storage). */
  S3_ENDPOINT: z.preprocess(emptyToUndefined, httpUrl.optional()),
  /** Бакет для media-файлов. */
  S3_BUCKET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** Access key S3. */
  S3_ACCESS_KEY_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Secret key S3 (в репозиторий не попадает, RULES 5.1). */
  S3_SECRET_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Регион S3 (для AWS обязателен, для MinIO — обычно `us-east-1`). */
  S3_REGION: z.preprocess(emptyToUndefined, z.string().optional()),
  /** TTL ссылок S3 в днях (default 30). */
  S3_TTL_DAYS: z
    .preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(3650).optional())
    .default(30),
  /**
   * Публичный ли бакет S3 (default `false`, KI-444).
   *
   * `true` — `stored_url` собирается прямым URL `<endpoint>/<bucket>/<key>`;
   * `false` — presigned GET на час. Для приватного бакета прямой URL даёт 403,
   * поэтому безопасный дефолт — подписанные ссылки. Разбор строгий, как у
   * `TRUST_PROXY`/`SANDBOX_ENABLED`: `z.coerce.boolean()` превращает непустую
   * строку `'false'` в `true`, и публичный бакет включился бы по ошибке.
   */
  S3_PUBLIC_BUCKET: z
    .preprocess(
      emptyToUndefined,
      z
        .union([z.boolean(), z.enum(['true', 'false'])])
        .transform((value) => value === true || value === 'true')
        .optional(),
    )
    .default(false),
});

/** Валидированные настройки хранилища media-результатов (R7.8). */
export type MediaStorageEnv = z.infer<typeof MediaStorageEnvSchema>;

/**
 * Zod-схема лимитов одновременных вызовов на провайдера LLM (R7.7, KI-067).
 *
 * Глобальный `concurrency` воркера (5) не разделяет провайдеров: пять тяжёлых
 * запусков бьют в одного и того же провайдера, ловят 429 и растят расходы.
 * Лимит по каждому провайдеру ограничивает число одновременных вызовов.
 *
 * Переменные перечислены явно (а не `z.record`): так их видно в `.env.example`
 * и в типах. Значение `0`/отсутствие — без ограничения (backward compat).
 * Для провайдера, которого здесь нет, лимит всё равно читается динамически
 * (`LLM_PROVIDER_MAX_CONCURRENCY_<NAME>`) — см. `provider-semaphore.ts`.
 */
export const ProviderConcurrencyEnvSchema = z.object({
  /** Лимит одновременных вызовов Anthropic (default — без ограничения). */
  LLM_PROVIDER_MAX_CONCURRENCY_ANTHROPIC: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(1000).optional(),
  ),
  /** Лимит одновременных вызовов OpenAI. */
  LLM_PROVIDER_MAX_CONCURRENCY_OPENAI: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(1000).optional(),
  ),
  /** Лимит одновременных вызовов RouterAI. */
  LLM_PROVIDER_MAX_CONCURRENCY_ROUTERAI: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(1000).optional(),
  ),
  /** Лимит одновременных вызовов DeepSeek. */
  LLM_PROVIDER_MAX_CONCURRENCY_DEEPSEEK: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(1000).optional(),
  ),
  /** Лимит одновременных вызовов Yandex AI Studio. */
  LLM_PROVIDER_MAX_CONCURRENCY_YANDEX: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(1000).optional(),
  ),
  /** Лимит одновременных вызовов LM Studio (локальный сервер). */
  LLM_PROVIDER_MAX_CONCURRENCY_LMSTUDIO: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(1000).optional(),
  ),
  /** Лимит одновременных вызовов GPTunnel. */
  LLM_PROVIDER_MAX_CONCURRENCY_GPTUNNEL: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(1000).optional(),
  ),
});

/** Валидированные лимиты одновременных вызовов на провайдера (R7.7). */
export type ProviderConcurrencyEnv = z.infer<typeof ProviderConcurrencyEnvSchema>;

/**
 * Zod-схема аварийного выключателя vector/memory-узлов (v0.10 S0, KI-455).
 *
 * `PGVECTOR_ENABLED` по умолчанию `true` — сохраняет текущее поведение:
 * vector- и memory-узлы работают. `false` — аварийное отключение без отката
 * релиза: `ExecutionEngineService` падает понятной ошибкой конфигурации, а не
 * пытается ходить в pgvector с выключенным индексом.
 *
 * Разбор строгий, как у `SANDBOX_ENABLED`/`OTEL_ENABLED`: `z.coerce.boolean()`
 * превращает непустую строку `'false'` в `true`, и выключатель не сработал бы
 * (это же ограничение зафиксировано в DESIGN v0.10 § 3.5.3).
 */
export const VectorEnvSchema = z.object({
  /** Включены ли vector/memory-узлы (default true). */
  PGVECTOR_ENABLED: z
    .preprocess(
      emptyToUndefined,
      z
        .union([z.boolean(), z.enum(['true', 'false'])])
        .transform((value) => value === true || value === 'true')
        .optional(),
    )
    .default(true),
});

/** Валидированные настройки vector-узлов (v0.10 S0). */
export type VectorEnv = z.infer<typeof VectorEnvSchema>;

/**
 * Zod-схема переменных окружения, обязательных для запуска приложения.
 *
 * Проверяется ровно один раз при инициализации `ConfigModule` (fail-fast):
 * приложение не поднимается с неполной или некорректной конфигурацией
 * (RULES 4.5, 1.17).
 */
export const EnvSchema = z.object({
  /** Режим работы приложения. */
  NODE_ENV: z.enum(['development', 'test', 'production', 'staging', 'preprod']).default('development'),
  /** Порт HTTP-сервера. */
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /**
   * Доверять ли `X-Forwarded-For` от reverse proxy (R7.7, KI-419).
   *
   * `@nestjs/throttler` считает лимит по `req.ip`, а Express за nginx/Caddy
   * видит адрес самого прокси: без `trust proxy` все клиенты делят один
   * счётчик (5/мин на всех). Включать **только** когда backend стоит за
   * прокси и недоступен напрямую: иначе клиент подделает `X-Forwarded-For` и
   * обойдёт rate limiting.
   *
   * Разбор строгий, как у `SANDBOX_ENABLED`/`OTEL_ENABLED`: `z.coerce.boolean()`
   * превращает непустую строку `'false'` в `true`, поэтому он не используется.
   */
  TRUST_PROXY: z
    .preprocess(
      emptyToUndefined,
      z
        .union([z.boolean(), z.enum(['true', 'false'])])
        .transform((value) => value === true || value === 'true')
        .optional(),
    )
    .default(false),
  /** Строка подключения к PostgreSQL (в Docker compose проброшен порт 5433). */
  DATABASE_URL: z.url('DATABASE_URL должен быть валидным URL'),
  /**
   * Строка подключения к Redis для BullMQ.
   *
   * Хост — только `127.0.0.1`: `localhost` на Windows может разрешиться в
   * IPv6 `::1`, который не проброшен контейнером (RULES 4.31).
   */
  REDIS_URL: z.url('REDIS_URL должен быть валидным URL'),
  /**
   * Ключ Anthropic (R3). Опционален: приложение и тесты поднимаются без ключа,
   * а провайдер отдаёт `LlmProviderException` только при реальном вызове.
   */
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Ключ OpenAI (R3). Опционален по той же причине, что и Anthropic. */
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /**
   * Base URL для OpenAI-совместимого API. Если не задан (или задан пустым) —
   * используется дефолт SDK `https://api.openai.com/v1`.
   *
   * В v0.5.0 оставлен для обратной совместимости: в мультипровайдерной схеме
   * у каждого OpenAI-совместимого провайдера свой `<PROVIDER>_BASE_URL`
   * (см. `ROUTERAI_BASE_URL` и ниже).
   */
  OPENAI_BASE_URL: z.preprocess(emptyToUndefined, httpUrl.optional()),

  // === RouterAI (OpenAI-совместимый прокси к 100+ моделям) ===
  /** Ключ RouterAI. Без него провайдер не регистрируется. */
  ROUTERAI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Base URL RouterAI. */
  ROUTERAI_BASE_URL: z
    .preprocess(emptyToUndefined, httpUrl.optional())
    .default('https://routerai.ru/api/v1'),

  // === GPTunnel (OpenAI-совместимый chat) ===
  /** Ключ GPTunnel. Без него провайдер не регистрируется. */
  GPTUNNEL_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Base URL GPTunnel. */
  GPTUNNEL_BASE_URL: z
    .preprocess(emptyToUndefined, httpUrl.optional())
    .default('https://gptunnel.ru/v1'),
  /**
   * Список моделей GPTunnel для UI: `id:modality+modality,id:modality`.
   * Формат совпадает с `LMSTUDIO_MODELS` (парсер переиспользуется).
   * Если пусто — провайдер не включается в список (как LM Studio).
   */
  GPTUNNEL_MODELS: z
    .preprocess(emptyToUndefined, z.string().optional())
    .default(''),

  // === GPTunnel CreativeLab (media — IMAGE/VIDEO/AUDIO/MUSIC/3D) ===
  /**
   * Ключ GPTunnel для media API. Может совпадать с ключом chat или быть
   * отдельным (в личном кабинете они выдаются независимо).
   */
  GPTUNNEL_MEDIA_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Base URL media API GPTunnel CreativeLab. */
  GPTUNNEL_MEDIA_BASE_URL: z
    .preprocess(emptyToUndefined, httpUrl.optional())
    .default('https://gptunnel.ru/api/v2/media'),
  /**
   * TTL кэша моделей media-провайдера (мс). Список моделей ~200KB,
   * ходить в upstream на каждый GET /media/models — расточительно.
   * 15 минут — компромисс между свежестью и нагрузкой (RULES 1.18).
   */
  GPTUNNEL_MEDIA_CACHE_TTL_MS: z
    .preprocess(emptyToUndefined, z.coerce.number().int().min(10_000).optional())
    .default(900_000),
  /**
   * Лимит ожидания media-задачи генерации (мс), R7.2 (DESIGN v0.9 § 3.2).
   *
   * Видео генерируется минутами, поэтому дефолт — 10 минут: прежние 5 минут
   * (`POLL_TIMEOUT_MS` в `MediaNodeExecutor`) обрывали задачу, которая на
   * стороне upstream продолжала выполняться и списывать деньги. Значение
   * должен быть больше `WORKFLOW_RUNS_LOCK_DURATION_MS`, иначе BullMQ
   * переотдаст job, пока узел ещё ждёт задачу (KI-023).
   */
  CREATIVELAB_MEDIA_TIMEOUT_MS: z
    .preprocess(emptyToUndefined, z.coerce.number().int().min(10_000).optional())
    .default(600_000),

  // === DeepSeek (OpenAI-совместимый) ===
  /** Ключ DeepSeek. Без него провайдер не регистрируется. */
  DEEPSEEK_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Base URL DeepSeek. */
  DEEPSEEK_BASE_URL: z
    .preprocess(emptyToUndefined, httpUrl.optional())
    .default('https://api.deepseek.com/v1'),

  // === Yandex AI Studio (OpenAI-совместимый) ===
  /** Ключ Yandex AI Studio. Без него провайдер не регистрируется. */
  YANDEX_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Base URL Yandex AI Studio. */
  YANDEX_BASE_URL: z
    .preprocess(emptyToUndefined, httpUrl.optional())
    .default('https://llm.api.cloud.yandex.net/v1'),
  /**
   * id каталога Yandex Cloud (KI-159).
   *
   * Нужен, чтобы собрать URI коротких id моделей из `YANDEX_MODELS`
   * (`yandexgpt-lite` → `gpt://<folder_id>/yandexgpt-lite/latest`). Без него
   * работают только модели, заданные полным URI.
   */
  YANDEX_FOLDER_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  /**
   * Каталог моделей Yandex AI Studio (KI-174).
   *
   * Формат как у `LMSTUDIO_MODELS`/`GPTUNNEL_MODELS`:
   * `<id>[:<модальность>[+<модальность>...]]` через запятую. `<id>` — либо
   * короткое имя (`yandexgpt-lite`), либо полный URI
   * (`gpt://<folder>/<model>/<version>`) — например
   * `gpt://b1g.../yandexgpt-lite/latest:text,gpt://b1g.../qwen3.6-35b-a3b/latest:text+vision`.
   *
   * Если не задан, используется дефолтный список YandexGPT (нужен
   * `YANDEX_FOLDER_ID`). Валидация значений — при парсинге в фабрике.
   */
  YANDEX_MODELS: z.preprocess(emptyToUndefined, z.string().optional()),

  // === LM Studio (локальный сервер, ключ не нужен) ===
  /** Base URL локального LM Studio. */
  LMSTUDIO_BASE_URL: z
    .preprocess(emptyToUndefined, httpUrl.optional())
    .default('http://localhost:1234/v1'),
  /**
   * Список моделей LM Studio через запятую (например,
   * `qwen2.5-7b-instruct,llama-3.3-70b`). LM Studio отдаёт список через
   * `GET /v1/models`, но для простоты задаём его в окружении. Пустое значение
   * (дефолт) означает «провайдер не включён».
   */
  LMSTUDIO_MODELS: z
    .preprocess(emptyToUndefined, z.string().optional())
    .default(''),
  // === Auth (R6.1a, KI-106) ===
  /**
   * Секрет подписи JWT (HS256). Минимум 32 символа: короткий секрет заметно
   * снижает стойкость. В проде — из секрет-хранилища, не из репозитория.
   */
  JWT_SECRET: z.string().min(32),
  /** Срок жизни access-токена (формат `ms`: `24h`, `7d`). */
  JWT_EXPIRES_IN: z
    .preprocess(emptyToUndefined, z.string().optional())
    .default('24h'),
  /**
   * Срок жизни refresh-токена (R6.1b). Формат `<N><s|m|h|d>` — парсится
   * `parseDurationToMs` без зависимости от пакета `ms`.
   */
  JWT_REFRESH_EXPIRES_IN: z
    .preprocess(emptyToUndefined, z.string().optional())
    .default('7d'),
  /**
   * Флаг `Secure` у refresh-cookie (R6.1b). Если не задан — считается
   * `NODE_ENV === 'production'`: в dev/CI cookie ходит по http.
   */
  COOKIE_SECURE: z.preprocess(
    emptyToUndefined,
    z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  ),
  /**
   * Отключает проверку токена (dev/CI): запросы выполняются от системного
   * пользователя миграции 0004. В проде обязано быть `false`.
   */
  AUTH_DISABLED: z.preprocess(
    emptyToUndefined,
    z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  ),
  // Настройки воркера очереди (KI-065) и lease-порог (KI-032).
  ...WorkerEnvSchema.shape,
  // Бюджет запуска: лимиты стоимости и режим (R7.1, KI-048).
  ...CostBudgetEnvSchema.shape,
  // Прямые image-провайдеры: Replicate / FAL / OpenAI Images (R7.3, KI-363).
  ...MediaDirectEnvSchema.shape,
  // WASM-песочница QuickJS для condition `mode: 'sandbox'` (R7.5, KI-364).
  ...SandboxEnvSchema.shape,
  // Лимиты agent-узла: итерации и токены на шаг (R7.4b, DESIGN § 3.4).
  ...AgentEnvSchema.shape,
  // Наблюдаемость: OTel-трейсы (R7.7, KI-365).
  ...ObservabilityEnvSchema.shape,
  // Хранилище media-результатов: local/S3/TTL (R7.8, KI-362).
  ...MediaStorageEnvSchema.shape,
  // Лимиты одновременных вызовов на провайдера LLM (R7.7, KI-067).
  ...ProviderConcurrencyEnvSchema.shape,
  // Аварийный выключатель vector/memory-узлов (v0.10 S0, KI-455).
  ...VectorEnvSchema.shape,
})
  /**
   * Fail-fast: отказ старта при `AUTH_DISABLED=true` в production.
   *
   * Иначе случайная env-переменная отключает всю авторизацию, и все запросы
   * идут от системного пользователя (KI-213). Проверка стоит на итоговой
   * схеме, поэтому видит `NODE_ENV` и `AUTH_DISABLED` одновременно
   * (`WorkerEnvSchema` влита через `.shape` и своей проверки не имеет).
   */
.superRefine((env, ctx) => {
  // KI-221: prod-подобные окружения (staging, preprod) требуют тех же
  // ограничений безопасности, что и production.
  const isProdLike =
    env.NODE_ENV === 'production' ||
    env.NODE_ENV === 'staging' ||
    env.NODE_ENV === 'preprod';

  if (isProdLike && env.AUTH_DISABLED === true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'AUTH_DISABLED=true недопустим в production (security)',
      path: ['AUTH_DISABLED'],
    });
  }
  // KI-220: запрет на понижение secure-флага refresh-cookie в prod.
  if (isProdLike && env.COOKIE_SECURE === false) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'COOKIE_SECURE=false недопустим в production (security)',
      path: ['COOKIE_SECURE'],
    });
  }
});

/** Валидированная конфигурация окружения (с применёнными значениями по умолчанию). */
export type Env = z.infer<typeof EnvSchema>;

/**
 * Валидирует окружение при старте приложения.
 *
 * Используется как `validate` в `ConfigModule.forRoot()`: получает уже
 * прочитанные значения (`process.env` + `.env`) и возвращает их вместе с
 * распарсенными значениями по умолчанию. Исходные ключи сохраняются, потому
 * что схема описывает известный набор переменных, а не закрытый список:
 * посторонние ключи окружения не отбрасываются.
 *
 * @param config - сырые переменные окружения
 * @returns окружение с применёнными default-значениями схемы
 * @throws Error если какая-либо переменная отсутствует или не соответствует схеме
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const result = EnvSchema.safeParse(config);

  if (!result.success) {
    throw new Error(
      `Некорректная конфигурация окружения (.env):\n${z.prettifyError(result.error)}`,
    );
  }

  return { ...config, ...result.data };
}
