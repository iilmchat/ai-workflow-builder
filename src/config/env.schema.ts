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
});

/** Валидированные настройки воркера очереди workflow-runs и lease-порога. */
export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

/**
 * Zod-схема переменных окружения, обязательных для запуска приложения.
 *
 * Проверяется ровно один раз при инициализации `ConfigModule` (fail-fast):
 * приложение не поднимается с неполной или некорректной конфигурацией
 * (RULES 4.5, 1.17).
 */
export const EnvSchema = z.object({
  /** Режим работы приложения. */
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Порт HTTP-сервера. */
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
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
  // Настройки воркера очереди (KI-065) и lease-порог (KI-032).
  ...WorkerEnvSchema.shape,
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
