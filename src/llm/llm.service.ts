import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  LlmGenerateOptions,
  LlmGenerateResult,
} from './llm-provider.interface.js';
import { LlmRegistryService } from './llm-registry.service.js';
import {
  createProviderSemaphoreRegistry,
  type ProviderSemaphoreRegistry,
} from './provider-semaphore.js';
import { withSpanAsync } from '../observability/tracing.js';

/** Таймаут вызова LLM по умолчанию (RULES 4.19). */
const LLM_TIMEOUT_MS = 60_000;

/**
 * Прикладной сервис вызова LLM: находит провайдера по модели и делегирует вызов.
 *
 * Единственная точка входа для исполнителей узлов — они не знают, какой
 * провайдер обслуживает модель. Таймаут ставится здесь, чтобы ни один вызов
 * не мог висеть бесконечно (RULES 4.19).
 *
 * **R7.7 (KI-067):** здесь же ограничивается число одновременных вызовов на
 * провайдера ({@link ProviderSemaphoreRegistry}) — очередь воркера общая, а
 * провайдерские лимиты разные.
 *
 * **R7.7 (KI-365):** каждый вызов оборачивается span'ом `llm.call` с
 * провайдером, моделью и временем ожидания слота.
 */
@Injectable()
export class LlmService {
  /** Лимиты одновременных вызовов по провайдерам. */
  private readonly semaphores: ProviderSemaphoreRegistry;

  /**
   * @param registry - реестр провайдеров (резолв по модели)
   * @param config - доступ к env (RULES 4.6); `@Optional()` — тесты создают
   *   сервис без `ConfigModule`, тогда лимитов нет (backward compat)
   */
  constructor(
    private readonly registry: LlmRegistryService,
    @Optional() config?: ConfigService,
  ) {
    this.semaphores = createProviderSemaphoreRegistry(
      config === undefined
        ? undefined
        : { get: (key: string) => config.get<unknown>(key) },
    );
  }

  /**
   * Вызывает LLM по id модели.
   *
   * Провайдер резолвится здесь, поэтому именно здесь к результату добавляется
   * флаг `isLocal`: исполнитель узла не знает провайдера, но должен посчитать
   * стоимость (`0` для локальных моделей, KI-148).
   *
   * @param prompt - пользовательский промпт
   * @param model - id модели (из `node.data.model`)
   * @param options - дополнительные параметры (`system`, лимиты, свой signal)
   * @returns текст ответа и метрики вызова (KI-038), с флагом `isLocal`
   * @throws LlmProviderException если модель не поддерживается или вызов упал
   */
  async generateAsync(
    prompt: string,
    model: string,
    options: Omit<LlmGenerateOptions, 'model'> = {},
  ): Promise<LlmGenerateResult> {
    const provider = this.registry.resolveByModel(model);

    // R7.7 (KI-365): span на весь вызов, включая ожидание слота семафора —
    // иначе «медленный» вызов из-за лимита провайдера выглядел бы быстрым.
    return withSpanAsync(
      'llm.call',
      {
        'llm.provider': provider.name,
        'llm.model': model,
        'llm.local': provider.isLocal ?? false,
      },
      async (span) => {
        const waitStartedAt = Date.now();
        const result = await this.semaphores.runAsync(provider.name, () =>
          provider.generateAsync(prompt, {
            // Таймаут по умолчанию; явный options.signal имеет приоритет.
            signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
            ...options,
            // model задаётся аргументом и снаружи не переопределяется.
            model,
          }),
        );
        const waitMs = Date.now() - waitStartedAt;

        span.setAttribute('llm.wait_ms', waitMs);
        span.setAttribute('llm.input_tokens', result.usage?.inputTokens ?? null);
        span.setAttribute('llm.output_tokens', result.usage?.outputTokens ?? null);
        span.setAttribute('llm.cache_read_tokens', result.usage?.cacheReadTokens ?? null);

        return { ...result, isLocal: provider.isLocal ?? false };
      },
    );
  }
}
