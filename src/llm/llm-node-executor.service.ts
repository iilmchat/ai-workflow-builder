import { Injectable, Logger } from '@nestjs/common';
import type { NodeDto } from '../engine/dto/index.js';
import { calculateCostUsdForProvider } from './model-pricing.js';
import { LlmProviderException } from './llm-provider.interface.js';
import { LlmService } from './llm.service.js';

/** Модель по умолчанию, если узел не задал свою. */
export const DEFAULT_LLM_MODEL = 'claude-sonnet-4-20250514';

/** Метрики выполнения LLM-узла (для записи в `node_runs`, KI-038). */
export interface LlmNodeMetrics {
  /** Токенов на входе (`null`, если провайдер не отдал usage). */
  inputTokens: number | null;
  /** Токенов на выходе (`null`, если провайдер не отдал usage). */
  outputTokens: number | null;
  /** Оценка стоимости в USD (`null`, если модель отсутствует в прайс-листе). */
  costUsd: number | null;
  /** Модель, фактически использованная провайдером. */
  model: string;
}

/** Результат выполнения LLM-узла: выходы + метрики. */
export interface LlmNodeExecutionResult {
  /** Выходы узла (`{ text }`). */
  outputs: Record<string, unknown>;
  /** Метрики вызова провайдера. */
  metrics: LlmNodeMetrics;
}

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
   * @returns выходы `{ text }` и метрики вызова (токены, стоимость, модель)
   * @throws LlmProviderException если prompt пуст, модель не найдена или вызов упал
   */
  async executeAsync(
    node: NodeDto,
    inputs: Record<string, unknown>,
  ): Promise<LlmNodeExecutionResult> {
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

    // RULES 5.9: в лог идут только модель, длина промпта и токены — не текст.
    this.logger.log(`LLM-узел ${node.id}: model=${model}, promptLen=${prompt.length}`);

    const result = await this.llm.generateAsync(prompt, model, system ? { system } : {});
    const usage = result.usage;
    const usedModel = usage?.model ?? model;
    const metrics: LlmNodeMetrics = {
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      // KI-148: у локальных провайдеров (LM Studio) стоимость — 0, а не null,
      // иначе панель показывала бы токены без цены.
      costUsd: calculateCostUsdForProvider(
        { isLocal: result.isLocal },
        usedModel,
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
      ),
      model: usedModel,
    };

    this.logger.log(
      `LLM-узел ${node.id}: tokens=${metrics.inputTokens ?? '?'}/` +
        `${metrics.outputTokens ?? '?'}, costUsd=${metrics.costUsd ?? '?'}`,
    );

    return { outputs: { text: result.text }, metrics };
  }
}
