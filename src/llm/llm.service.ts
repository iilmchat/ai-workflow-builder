import { Injectable } from '@nestjs/common';
import type {
  LlmGenerateOptions,
  LlmGenerateResult,
} from './llm-provider.interface.js';
import { LlmRegistryService } from './llm-registry.service.js';

/** Таймаут вызова LLM по умолчанию (RULES 4.19). */
const LLM_TIMEOUT_MS = 60_000;

/**
 * Прикладной сервис вызова LLM: находит провайдера по модели и делегирует вызов.
 *
 * Единственная точка входа для исполнителей узлов — они не знают, какой
 * провайдер обслуживает модель. Таймаут ставится здесь, чтобы ни один вызов
 * не мог висеть бесконечно (RULES 4.19).
 */
@Injectable()
export class LlmService {
  constructor(private readonly registry: LlmRegistryService) {}

  /**
   * Вызывает LLM по id модели.
   *
   * @param prompt - пользовательский промпт
   * @param model - id модели (из `node.data.model`)
   * @param options - дополнительные параметры (`system`, лимиты, свой signal)
   * @returns текст ответа и метрики вызова (KI-038)
   * @throws LlmProviderException если модель не поддерживается или вызов упал
   */
  async generateAsync(
    prompt: string,
    model: string,
    options: Omit<LlmGenerateOptions, 'model'> = {},
  ): Promise<LlmGenerateResult> {
    const provider = this.registry.resolveByModel(model);

    return provider.generateAsync(prompt, {
      // Таймаут по умолчанию; явный options.signal имеет приоритет.
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      ...options,
      // model задаётся аргументом и снаружи не переопределяется.
      model,
    });
  }
}
