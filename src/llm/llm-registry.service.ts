import { Injectable } from '@nestjs/common';
import { LlmProviderException, type ILlmProvider } from './llm-provider.interface.js';
import { AnthropicProvider } from './providers/anthropic.provider.js';
import { OpenAiProvider } from './providers/openai.provider.js';

/** Модель с указанием провайдера (для UI). */
export interface LlmModelInfo {
  /** Идентификатор провайдера. */
  provider: string;
  /** id модели, который принимает провайдер. */
  id: string;
  /** Человекочитаемое имя модели. */
  label: string;
}

/**
 * Реестр LLM-провайдеров: сопоставляет id модели с провайдером.
 *
 * Провайдеры инжектятся по конструктору (RULES 1.3), поэтому регистрация новой
 * модели сводится к добавлению её в `models` провайдера.
 */
@Injectable()
export class LlmRegistryService {
  /** Все провайдеры в порядке приоритета (для листинга моделей). */
  private readonly providers: ReadonlyArray<ILlmProvider>;
  /** id модели → провайдер, который её обслуживает. */
  private readonly byModelId = new Map<string, ILlmProvider>();

  /**
   * @param anthropic - провайдер Anthropic
   * @param openai - провайдер OpenAI
   */
  constructor(anthropic: AnthropicProvider, openai: OpenAiProvider) {
    this.providers = [anthropic, openai];

    for (const provider of this.providers) {
      for (const model of provider.models) {
        this.byModelId.set(model.id, provider);
      }
    }
  }

  /**
   * Находит провайдера по id модели.
   *
   * @param modelId - id модели (например, `claude-sonnet-4-20250514`)
   * @returns провайдер, обслуживающий модель
   * @throws LlmProviderException если модель не поддерживается
   */
  resolveByModel(modelId: string): ILlmProvider {
    const provider = this.byModelId.get(modelId);

    if (!provider) {
      throw new LlmProviderException(
        'registry',
        `Модель не поддерживается: ${modelId}`,
      );
    }

    return provider;
  }

  /**
   * Возвращает список моделей всех провайдеров.
   *
   * @returns модели с указанием провайдера (для UI выбора модели)
   */
  listModels(): LlmModelInfo[] {
    return this.providers.flatMap((provider) =>
      provider.models.map((model) => ({
        provider: provider.name,
        id: model.id,
        label: model.label,
      })),
    );
  }
}
