import { Injectable } from '@nestjs/common';
import type {
  LlmGenerateOptions,
  LlmGenerateResult,
} from './llm-provider.interface.js';
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
 */
@Injectable()
export class LlmService {
  /**
   * @param router - роутер вызовов (локальный GPU → облако)
   */
  constructor(private readonly router: LlmRouterService) {}

  /**
   * Вызывает LLM по id модели.
   *
   * @param prompt - пользовательский промпт
   * @param model - id модели (из `node.data.model`); при включённом роутере
   *   может быть заменена локальной моделью LM Studio
   * @param options - дополнительные параметры (`system`, лимиты, свой signal)
   * @returns текст ответа и метрики вызова (KI-038) с фактическим флагом
   *   `isLocal`
   * @throws LlmProviderException если модель не поддерживается или вызов упал
   */
  async generateAsync(
    prompt: string,
    model: string,
    options: Omit<LlmGenerateOptions, 'model'> = {},
  ): Promise<LlmGenerateResult> {
    return this.router.generateAsync(prompt, { ...options, model });
  }
}
