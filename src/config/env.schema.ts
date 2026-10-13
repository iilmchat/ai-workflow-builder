import { z } from 'zod';

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
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Ключ OpenAI (R3). Опционален по той же причине, что и Anthropic. */
  OPENAI_API_KEY: z.string().optional(),
  /**
   * Base URL для OpenAI-совместимого API (RouterAI, DeepSeek, Yandex
   * и т.п.). Если не задан — используется дефолт SDK
   * (https://api.openai.com/v1).
   */
  OPENAI_BASE_URL: z.url().optional(),
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
 * что схема описывает обязательный минимум, а не закрытый список переменных
 * (например, ключи LLM-провайдеров появятся в R3).
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
