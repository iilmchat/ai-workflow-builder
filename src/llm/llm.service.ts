import { Injectable, Logger, Optional } from '@nestjs/common';
import type {
  LlmGenerateOptions,
  LlmGenerateResult,
} from './llm-provider.interface.js';
import { LlmResponseCacheService } from './llm-response-cache.service.js';
import { LlmRouterService } from './llm-router.service.js';

/**
 * Прикладной сервис вызова LLM: тонкая обёртка над {@link LlmRouterService}.
 *
 * Единственная точка входа для исполнителей узлов и агента — они не знают,
 * какой провайдер обслуживает модель. С v1.2 S1 сервис не резолвит провайдера
 * сам: выбор маршрута (локальный LM Studio → облачный fallback), таймаут
 * (RULES 4.19), span `llm.call` (KI-365), семафоры провайдеров (KI-067) и флаг
 * `isLocal` (KI-148) живут в роутере.
 *
 * **R7.7 (KI-067):** ограничение одновременных вызовов на провайдера теперь
 * применяется роутером к фактически использованному провайдеру — при fallback
 * это облако, а не локальный сервер.
 *
 * **R7.7 (KI-365):** span `llm.call` создаётся в роутере и охватывает обе
 * попытки (локальную и облачную).
 *
 * **v1.6.0 S8 (FinOps):** если `LLM_CACHE_ENABLED=true` и вызов пришёл с
 * `orgId`, ответ ищется в Redis по ключу
 * `sha256(orgId + modelId + system + prompt + options)`. Попадание возвращает
 * сохранённый результат с `cached: true` и не вызывает провайдера; промах
 * сохраняет ответ с TTL. Без `orgId` кэш не используется: ключ без tenant'а
 * смешал бы ответы разных организаций.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  /**
   * @param router - роутер вызовов (локальный GPU → облако)
   * @param cache - Redis-кэш ответов; `@Optional()` — в юнит-тестах его может
   *   не быть, тогда сервис работает как до S8
   */
  constructor(
    private readonly router: LlmRouterService,
    @Optional() private readonly cache?: LlmResponseCacheService,
  ) {}

  /**
   * Вызывает LLM по id модели.
   *
   * @param prompt - пользовательский промпт
   * @param model - id модели (из `node.data.model`); при включённом роутере
   *   может быть заменена локальной моделью LM Studio
   * @param options - дополнительные параметры (`system`, лимиты, свой signal,
   *   `orgId` для tenant-кэша)
   * @returns текст ответа и метрики вызова (KI-038) с фактическим флагом
   *   `isLocal`; `cached: true` — ответ из Redis-кэша (S8)
   * @throws LlmProviderException если модель не поддерживается или вызов упал
   */
  async generateAsync(
    prompt: string,
    model: string,
    options: Omit<LlmGenerateOptions, 'model'> = {},
  ): Promise<LlmGenerateResult> {
    const orgId =
      typeof options.orgId === 'string' && options.orgId.length > 0
        ? options.orgId
        : undefined;

    // Кэш выключен или вызов без tenant'а — прежний путь без Redis.
    if (this.cache === undefined || !this.cache.isEnabled() || orgId === undefined) {
      return this.router.generateAsync(prompt, { ...options, model });
    }

    const key = this.cache.buildKey({ orgId, modelId: model, prompt, options });
    const cached = await this.cache.getAsync(key);

    if (cached !== null) {
      // RULES 5.9: в лог — только модель и длина промпта, не текст.
      this.logger.debug(
        `LLM-кэш: попадание model=${model}, promptLen=${prompt.length}`,
      );

      return { ...cached, cached: true };
    }

    const result = await this.router.generateAsync(prompt, { ...options, model });

    await this.cache.setAsync(key, result);

    return result;
  }
}
