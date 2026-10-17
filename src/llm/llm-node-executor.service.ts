import { Injectable, Logger } from '@nestjs/common';
import type { NodeDto } from '../engine/dto/index.js';
import { CostBudgetService } from '../runs/cost-budget.service.js';
import { calculateCacheSavingsUsd, calculateCostUsdForProvider } from './model-pricing.js';
import { LlmProviderException, type ReasoningEffort } from './llm-provider.interface.js';
import { LlmService } from './llm.service.js';

/** Модель по умолчанию, если узел не задал свою. */
export const DEFAULT_LLM_MODEL = 'claude-sonnet-4-20250514';

/**
 * Читает system prompt узла (KI-192).
 *
 * Приоритет: `data.systemPrompt` (поле, которое пишет UI в R6.3.2) →
 * `data.system` (совместимость с графами, сохранёнными раньше).
 *
 * @param node - узел графа
 * @returns system prompt либо `undefined`
 */
function readSystemPrompt(node: NodeDto): string | undefined {
  for (const value of [node.data.systemPrompt, node.data.system]) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

/**
 * Читает режим reasoning узла (KI-193).
 *
 * @param value - `data.reasoningEffort` (форма не гарантирована: граф из БД)
 * @returns валидный режим либо `undefined` — «поле не передавать»
 */
function readReasoningEffort(value: unknown): ReasoningEffort | undefined {
  return value === 'off' || value === 'medium' || value === 'high'
    ? value
    : undefined;
}

/**
 * Читает override лимита токенов узла (KI-183).
 *
 * @param value - `data.maxTokensOverride`
 * @returns положительное целое либо `undefined` — «взять дефолт модели»
 */
function readMaxTokensOverride(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

/**
 * Достаёт prompt LLM-узла (KI-180).
 *
 * Приоритет источников: связь (`inputs.prompt`) → промпт, введённый в узле
 * (`data.prompt`) → `data.value` (workflow, сохранённые до появления поля).
 *
 * @param node - узел графа
 * @param inputs - нормализованные входы узла
 * @returns промпт либо пустую строку
 */
function readPrompt(node: NodeDto, inputs: Record<string, unknown>): string {
  const sources = [inputs.prompt, node.data.prompt, node.data.value];

  for (const source of sources) {
    if (typeof source === 'string' && source.length > 0) {
      return source;
    }
  }

  return '';
}

/** Метрики выполнения LLM-узла (для записи в `node_runs`, KI-038). */
export interface LlmNodeMetrics {
  /** Токенов на входе (`null`, если провайдер не отдал usage). */
  inputTokens: number | null;
  /** Токенов на выходе (`null`, если провайдер не отдал usage). */
  outputTokens: number | null;
  /** Оценка стоимости в USD (`null`, если модель отсутствует в прайс-листе). */
  costUsd: number | null;
  /** Кэш-токены чтения (R7.7, KI-055); `null` — кэш не применялся. */
  cacheReadTokens: number | null;
  /** Кэш-токены записи (R7.7, KI-150); `null` — провайдер их не отдал. */
  cacheCreationTokens: number | null;
  /**
   * Экономия на чтении из кэша, USD (R7.7, KI-055).
   *
   * `null` — экономию посчитать нельзя (модели нет в прайсе или цена кэша у
   * неё не задана). Само поле не хранится в БД: в снимке оно пересчитывается
   * по прайсу (`runs-stream.service.ts`), а в событии приходит готовым.
   */
  cacheSavingsUsd: number | null;
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

  /**
   * @param llm - сервис выбора провайдера и вызова модели
   * @param costBudget - предохранитель по стоимости запуска (R7.1, KI-048)
   */
  constructor(
    private readonly llm: LlmService,
    private readonly costBudget: CostBudgetService,
  ) {}

  /**
   * Выполняет LLM-узел: собирает prompt из входов и вызывает модель.
   *
   * @param node - узел графа (`data.model`, `data.system`)
   * @param inputs - нормализованные входы узла (после KI-034 ключ — `prompt`)
   * @param runId - uuid запуска: нужен предохранителю по стоимости (KI-048).
   *   Необязателен — тесты и прямой вызов исполнителя работают без бюджета.
   * @returns выходы `{ text }` и метрики вызова (токены, стоимость, модель)
   * @throws LlmProviderException если prompt пуст, модель не найдена или вызов упал
   * @throws BudgetExceededException если бюджет запуска исчерпан (KI-048)
   */
  async executeAsync(
    node: NodeDto,
    inputs: Record<string, unknown>,
    runId?: string,
  ): Promise<LlmNodeExecutionResult> {
    // KI-180: prompt приходит по связи (`inputs.prompt`) либо вводится прямо
    // в узле (`data.prompt`). `data.value` — совместимость с workflow,
    // сохранёнными до появления поля в узле.
    const prompt = readPrompt(node, inputs);

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
    const system = readSystemPrompt(node);
    // KI-192/KI-193/KI-183: параметры модели читаются из `data.*`, не из
    // `inputs` — это настройки узла, а не данные графа.
    const reasoningEffort = readReasoningEffort(node.data.reasoningEffort);
    const maxTokensOverride = readMaxTokensOverride(node.data.maxTokensOverride);

    // RULES 5.9: в лог идут только модель, длины и режимы — не тексты промптов.
    this.logger.log(
      `LLM-узел ${node.id}: model=${model}, promptLen=${prompt.length}, systemLen=${system?.length ?? 0}, reasoning=${reasoningEffort ?? 'off'}, maxTokens=${maxTokensOverride ?? 'default'}`,
    );

    // R7.1 (KI-048): бюджет запуска проверяется до платного вызова. Оценка не
    // передаётся: до ответа провайдера стоимость LLM-вызова неизвестна (она
    // зависит от числа токенов), но уже потраченное проверяется всегда.
    if (runId !== undefined) {
      await this.costBudget.assertWithinBudgetAsync(runId);
    }

    const result = await this.llm.generateAsync(prompt, model, {
      ...(system === undefined ? {} : { system }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      ...(maxTokensOverride === undefined ? {} : { maxTokens: maxTokensOverride }),
    });
    const usage = result.usage;
    const usedModel = usage?.model ?? model;
    // R7.7 (KI-055/KI-150): кэш-токены идут отдельными полями — они дешевле
    // обычных входных, и стоимость считается по отдельным тарифам.
    const cacheReadTokens = usage?.cacheReadTokens ?? null;
    const cacheCreationTokens = usage?.cacheCreationTokens ?? null;
    const metrics: LlmNodeMetrics = {
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      cacheReadTokens,
      cacheCreationTokens,
      // KI-148: у локальных провайдеров (LM Studio) стоимость — 0, а не null,
      // иначе панель показывала бы токены без цены.
      costUsd: calculateCostUsdForProvider(
        { isLocal: result.isLocal },
        usedModel,
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
        {
          cacheReadTokens,
          cacheCreationTokens,
          cacheTokensIncludedInInput: usage?.cacheTokensIncludedInInput,
        },
      ),
      cacheSavingsUsd: calculateCacheSavingsUsd(usedModel, cacheReadTokens),
      model: usedModel,
    };

    this.logger.log(
      `LLM-узел ${node.id}: tokens=${metrics.inputTokens ?? '?'}/` +
        `${metrics.outputTokens ?? '?'}, costUsd=${metrics.costUsd ?? '?'}` +
        (cacheReadTokens === null ? '' : `, cacheRead=${cacheReadTokens}`),
    );

    return { outputs: { text: result.text }, metrics };
  }
}
