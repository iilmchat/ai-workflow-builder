import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { REDIS_TOKEN } from '../redis/redis.module.js';
import type {
  LlmGenerateOptions,
  LlmGenerateResult,
  LlmUsage,
} from './llm-provider.interface.js';

/**
 * Параметры ключа кэша ответов LLM (v1.6.0 S8, FinOps).
 *
 * `orgId` — обязательная часть ключа: без неё две организации с одинаковым
 * промптом получили бы ответ друг друга. Кэш tenant-aware, а не глобальный.
 */
export interface LlmCacheKeyParams {
  /** Организация-арендатор, которой принадлежит вызов. */
  orgId: string;
  /** id модели (как его выбрал пользователь/узел). */
  modelId: string;
  /** Пользовательский промпт. */
  prompt: string;
  /** Опции вызова (system, лимиты, temperature, reasoning, ...). */
  options: Omit<LlmGenerateOptions, 'model'>;
}

/** Тело записи в Redis: только то, что нужно для повторной выдачи ответа. */
interface CachedLlmResponse {
  /** Текст ответа. */
  text: string;
  /** Метрики исходного вызова (`null`, если провайдер их не отдал). */
  usage: LlmUsage | null;
  /** Обслужен ли исходный вызов локальным провайдером. */
  isLocal?: boolean;
}

/**
 * Строгий разбор boolean из env (RULES 4.35).
 *
 * @param value - значение из `ConfigService` (boolean или `'true'`/`'false'`)
 * @param fallback - значение по умолчанию
 * @returns разобранный флаг
 */
function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return fallback;
}

/**
 * Читает положительный целочисленный TTL из env.
 *
 * @param value - значение из `ConfigService` (number или строка)
 * @param fallback - значение по умолчанию
 * @returns TTL в секундах
 */
function readTtlSeconds(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Стабильная сериализация опций вызова.
 *
 * `signal` — объект с внутренним состоянием, он не относится к содержанию
 * запроса. `orgId` уже входит в ключ отдельно. Остальные поля сортируются по
 * имени: `{a,b}` и `{b,a}` должны давать один ключ.
 *
 * @param options - опции вызова без `model`
 * @returns JSON с отсортированными ключами
 */
function stableOptionsJson(options: Omit<LlmGenerateOptions, 'model'>): string {
  const { signal: _signal, orgId: _orgId, ...rest } = options;
  const sorted = Object.keys(rest)
    .sort()
    .map((key) => [key, (rest as Record<string, unknown>)[key]] as const);

  return JSON.stringify(Object.fromEntries(sorted));
}

/**
 * Проверяет, что значение из Redis похоже на сохранённый ответ.
 *
 * Redis — внешнее хранилище: запись могла быть создана старой версией кода
 * или повреждена. Невалидное значение не должно попасть в UI как ответ LLM.
 *
 * @param value - разобранный JSON
 * @returns `true`, если структура безопасна для выдачи
 */
function isCachedLlmResponse(value: unknown): value is CachedLlmResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const body = value as Partial<CachedLlmResponse>;

  if (typeof body.text !== 'string') {
    return false;
  }

  if (body.usage !== null && typeof body.usage !== 'object') {
    return false;
  }

  return body.isLocal === undefined || typeof body.isLocal === 'boolean';
}

/**
 * Кэш ответов LLM в Redis (v1.6.0 S8, FinOps).
 *
 * Зачем: пользователь не должен платить дважды за одинаковый запрос
 * (например, повторный запуск workflow с тем же prompt). Ключ включает
 * организацию, модель, system/prompt и сериализованные опции, поэтому кэш
 * изолирован по арендаторам и не смешивает разные параметры генерации.
 *
 * Ошибки Redis не ломают вызов LLM: `getAsync` возвращает `null`, `setAsync`
 * логирует WARN и продолжает. Кэш — оптимизация, а не точка отказа.
 */
@Injectable()
export class LlmResponseCacheService {
  private readonly logger = new Logger(LlmResponseCacheService.name);
  private readonly enabled: boolean;
  private readonly ttlSecondsValue: number;

  /**
   * @param redis - клиент Redis (глобальный `REDIS_TOKEN`)
   * @param config - доступ к env; `@Optional()` — в тестах сервис собирают
   *   напрямую, тогда действуют дефолты (кэш выключен)
   */
  constructor(
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
    @Optional() config?: ConfigService,
  ) {
    this.enabled = readBoolean(config?.get<unknown>('LLM_CACHE_ENABLED'), false);
    this.ttlSecondsValue = readTtlSeconds(
      config?.get<unknown>('LLM_CACHE_TTL_SECONDS'),
      86_400,
    );
  }

  /**
   * Включён ли кэш (`LLM_CACHE_ENABLED`).
   *
   * @returns `true`, если ответы можно читать/писать
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * TTL записи в секундах (`LLM_CACHE_TTL_SECONDS`).
   *
   * @returns положительное целое
   */
  get ttlSeconds(): number {
    return this.ttlSecondsValue;
  }

  /**
   * Строит sha256-ключ ответа.
   *
   * Формула: `sha256(orgId + modelId + systemPrompt + prompt + optionsJson)`.
   * Части разделены `\0`, чтобы конкатенация не давала коллизий вида
   * `ab`+`c` = `a`+`bc`.
   *
   * @param params - организация, модель, промпт и опции
   * @returns hex-ключ Redis
   */
  buildKey(params: LlmCacheKeyParams): string {
    const payload = [
      params.orgId,
      params.modelId,
      params.options.system ?? '',
      params.prompt,
      stableOptionsJson(params.options),
    ].join('\0');

    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Читает ответ из кэша.
   *
   * @param key - ключ из {@link buildKey}
   * @returns сохранённый ответ либо `null` (промах/ошибка/битая запись)
   */
  async getAsync(key: string): Promise<CachedLlmResponse | null> {
    let raw: string | null;

    try {
      raw = await this.redis.get(key);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      // Redis недоступен — это не повод падать: идём в провайдера.
      this.logger.warn(`Кэш LLM: чтение не удалось (${message})`);

      return null;
    }

    if (raw === null) {
      return null;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      // Не JSON — запись повреждена/создана не нами. Удаляем, чтобы не
      // мешала следующему вызову, и идём в провайдера.
      await this.deleteQuietlyAsync(key);
      this.logger.warn('Кэш LLM: удалена запись неожиданного формата');

      return null;
    }

    if (!isCachedLlmResponse(parsed)) {
      await this.deleteQuietlyAsync(key);
      this.logger.warn('Кэш LLM: удалена запись неожиданного формата');

      return null;
    }

    return parsed;
  }

  /**
   * Удаляет запись, не роняя вызов при ошибке Redis.
   *
   * @param key - ключ Redis
   * @returns промис без значения
   */
  private async deleteQuietlyAsync(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Кэш LLM: удаление битой записи не удалось (${message})`);
    }
  }

  /**
   * Сохраняет успешный ответ в кэш с TTL.
   *
   * @param key - ключ из {@link buildKey}
   * @param result - ответ провайдера
   * @returns промис без значения
   */
  async setAsync(key: string, result: LlmGenerateResult): Promise<void> {
    const body: CachedLlmResponse = {
      text: result.text,
      usage: result.usage,
      ...(result.isLocal === undefined ? {} : { isLocal: result.isLocal }),
    };

    try {
      await this.redis.set(key, JSON.stringify(body), 'EX', this.ttlSecondsValue);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Кэш LLM: запись не удалась (${message})`);
    }
  }
}
