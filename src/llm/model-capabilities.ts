/**
 * Возможности модели и их сверка для роутера (v1.3 S1, KI-617).
 *
 * Роутер подменяет выбранную модель локальной (LM Studio) или fallback-моделью
 * из `LLM_ROUTER_FALLBACK_MODEL`. До v1.3 подмена не сверялась с паспортом
 * модели: vision-узел мог уйти в текстовую модель, agent-узел — в модель без
 * инструментов, а модель с маленьким контекстом — получить промпт, который
 * она не примет.
 *
 * Здесь живут чистые функции: нормализация паспорта ({@link
 * buildModelCapabilities}) и проверка совместимости
 * ({@link isCapabilityCompatible}). Разбор требований из опций вызова и выбор
 * маршрута остаются в `LlmRouterService`: это уже бизнес-логика роутинга.
 */
import type {
  ILlmProvider,
  ModelInfo,
  ModelModality,
} from './llm-provider.interface.js';

/**
 * Нормализованный паспорт модели: поля-возможности заполнены для любой модели.
 *
 * `ModelInfo` держит `supportsReasoning`/`supportsTools`/`maxTokens`
 * опциональными, чтобы не ломать сторонние (env-каталоги, тесты) объявления.
 * Для сверки нужны определённые значения, поэтому нормализация выполняется
 * здесь один раз, а не в каждом сравнении.
 */
export interface LlmModelCapabilities {
  /** id модели, как её знает провайдер. */
  readonly id: string;
  /** Имя провайдера-владельца модели. */
  readonly provider: string;
  /** Модальности входа (минимум `['text']`). */
  readonly inputModalities: readonly ModelModality[];
  /** Поддерживает ли модель reasoning. */
  readonly supportsReasoning: boolean;
  /** Поддерживает ли модель tool-calling. */
  readonly supportsTools: boolean;
  /** Максимальный контекст (вход + выход), токенов; `0` — неизвестен. */
  readonly maxTokens: number;
}

/**
 * Требования к модели при подмене.
 *
 * Строятся роутером из паспорта исходной модели и опций вызова:
 * - модальности исходной модели обязаны поддерживаться кандидатом;
 * - reasoning нужен, если исходная модель reasoning-ная либо вызов просит
 *   `reasoningEffort`;
 * - tool-calling нужен, только если вызывающий код явно пометил вызов
 *   (`requiresTools: true`, агент);
 * - контекст кандидата не должен быть меньше исходного, если оба известны.
 */
export interface LlmCapabilityRequirements {
  /** Модальности входа, которые обязан поддерживать кандидат. */
  readonly inputModalities: readonly ModelModality[];
  /** Нужен ли модели reasoning. */
  readonly requiresReasoning: boolean;
  /** Нужен ли модели tool-calling. */
  readonly requiresTools: boolean;
  /** Минимальный контекст (токенов); `0` — без ограничения. */
  readonly minTokens: number;
}

/** Совместимый маршрут: провайдер и его модель. */
export interface LlmCompatibleRoute {
  /** Провайдер, объявивший модель. */
  readonly provider: ILlmProvider;
  /** Модель провайдера. */
  readonly model: ModelInfo;
}

/**
 * Нормализует паспорт модели, заполняя отсутствующие возможности.
 *
 * Правила:
 * - `supportsReasoning` отсутствует → `false` (провайдер не отправляет
 *   `reasoning_effort` — см. `LlmGenerateOptions.reasoningEffort`);
 * - `supportsTools` отсутствует → `true`, если модель принимает текст: в
 *   текущей реализации инструменты агента передаются промптом, поэтому любая
 *   текстовая модель способна вести tool-цикл. Явный `false` — для моделей,
 *   где tool-calling заведомо не поддержан (например, `deepseek-reasoner`);
 * - `maxTokens` отсутствует → `0` («неизвестен»); сверка контекста тогда
 *   пропускается, а не падает.
 *
 * @param providerName - имя провайдера-владельца
 * @param model - объявление модели
 * @returns нормализованный паспорт
 */
export function buildModelCapabilities(
  providerName: string,
  model: ModelInfo,
): LlmModelCapabilities {
  return {
    id: model.id,
    provider: providerName,
    inputModalities: model.inputModalities,
    supportsReasoning: model.supportsReasoning === true,
    supportsTools:
      model.supportsTools ?? model.inputModalities.includes('text'),
    maxTokens: model.maxTokens ?? 0,
  };
}

/**
 * Проверяет, удовлетворяет ли модель требованиям подмены.
 *
 * Контекст сравнивается только когда он известен у обеих сторон
 * (`required.minTokens > 0` и `candidate.maxTokens > 0`): неизвестное значение
 * не является доказательством несовместимости.
 *
 * @param candidate - паспорт кандидата
 * @param requirements - требования к подмене
 * @returns `true`, если модель можно использовать вместо исходной
 */
export function isCapabilityCompatible(
  candidate: LlmModelCapabilities,
  requirements: LlmCapabilityRequirements,
): boolean {
  return describeCapabilityGaps(candidate, requirements).length === 0;
}

/**
 * Перечисляет, чего кандидату не хватает для требований.
 *
 * Используется и проверкой ({@link isCapabilityCompatible}), и текстами
 * WARN/ошибок: оператор должен видеть, почему модель не подошла, а не только
 * «fallback не удался».
 *
 * @param candidate - паспорт кандидата
 * @param requirements - требования к подмене
 * @returns список причин; пустой массив — модель подходит
 */
export function describeCapabilityGaps(
  candidate: LlmModelCapabilities,
  requirements: LlmCapabilityRequirements,
): string[] {
  const gaps: string[] = [];
  const missingModalities = requirements.inputModalities.filter(
    (modality) => !candidate.inputModalities.includes(modality),
  );

  if (missingModalities.length > 0) {
    gaps.push(`нет модальности ${missingModalities.join(', ')}`);
  }

  if (requirements.requiresReasoning && !candidate.supportsReasoning) {
    gaps.push('нет reasoning');
  }

  if (requirements.requiresTools && !candidate.supportsTools) {
    gaps.push('нет tool-calling');
  }

  if (
    requirements.minTokens > 0 &&
    candidate.maxTokens > 0 &&
    candidate.maxTokens < requirements.minTokens
  ) {
    gaps.push(
      `контекст ${candidate.maxTokens} < ${requirements.minTokens} токенов`,
    );
  }

  return gaps;
}
