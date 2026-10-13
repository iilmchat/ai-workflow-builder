import { z } from 'zod';

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
