import { Injectable, Logger } from '@nestjs/common';
import type { NodeDto } from '../engine/dto/index.js';
import { LlmProviderException } from './llm-provider.interface.js';
import { LlmService } from './llm.service.js';

/** Модель по умолчанию, если узел не задал свою. */
export const DEFAULT_LLM_MODEL = 'claude-sonnet-4-20250514';

/**
 * Исполнитель узла типа `llm`.
 *
 * Отдельный DI-сервис (а не чистая функция в `node-executors.ts`): узел ходит
 * во внешний API, ему нужен `LlmService`. `node-executors` остаются реестром
 * чистых преобразований.
 */
@Injectable()
export class LlmNodeExecutor {
  private readonly logger = new Logger(LlmNodeExecutor.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Выполняет LLM-узел: собирает prompt из входов и вызывает модель.
   *
   * @param node - узел графа (`data.model`, `data.system`)
   * @param inputs - нормализованные входы узла (после KI-034 ключ — `prompt`)
   * @returns `{ text }` — ответ модели
   * @throws LlmProviderException если prompt пуст, модель не найдена или вызов упал
   */
  async executeAsync(
    node: NodeDto,
    inputs: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const prompt = typeof inputs.prompt === 'string' ? inputs.prompt : '';

    if (!prompt) {
      throw new LlmProviderException(
        'llm',
        `Пустой prompt на входе LLM-узла ${node.id}`,
      );
    }

    const model =
      typeof node.data.model === 'string' && node.data.model.length > 0
        ? node.data.model
        : DEFAULT_LLM_MODEL;
    const system = typeof node.data.system === 'string' ? node.data.system : undefined;

    // RULES 5.9: в лог идут только модель и длина промпта, не текст промпта.
    this.logger.log(`LLM-узел ${node.id}: model=${model}, promptLen=${prompt.length}`);

    const text = await this.llm.generateAsync(prompt, model, system ? { system } : {});

    return { text };
  }
}
