import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  LlmProviderException,
  type ILlmProvider,
  type ModelModality,
} from './llm-provider.interface.js';

/** Токен DI со списком сконфигурированных провайдеров (см. `LlmModule`). */
export const LLM_PROVIDERS = 'LLM_PROVIDERS';

/** Модель с указанием провайдера (для UI). */
export interface LlmModelInfo {
  /** Идентификатор провайдера. */
  provider: string;
  /** id модели, который принимает провайдер. */
  id: string;
  /** Человекочитаемое имя модели. */
  label: string;
  /** Модальности входа (для фильтра и группировки в UI). */
  inputModalities: readonly ModelModality[];
  /** Модальности выхода (для фильтра и бейджей в UI). */
  outputModalities: readonly ModelModality[];
  /**
   * Модель поддерживает reasoning (R6.3.1, KI-193).
   *
   * Поле есть только у reasoning-моделей: UI (R6.3.2) показывает переключатель
   * режима лишь тогда, когда провайдер это умеет.
   */
  supportsReasoning?: boolean;
  /** Дефолтный лимит токенов ответа модели (KI-183), если он ей задан. */
  defaultMaxTokens?: number;
}

/**
 * Реестр LLM-провайдеров: сопоставляет id модели с провайдером.
 *
 * Провайдеры приходят одним массивом через {@link LLM_PROVIDERS} (v0.5.0):
 * состав собирает {@link LlmProviderFactory} из окружения, поэтому добавление
 * нового OpenAI-совместимого провайдера не требует правок реестра.
 */
@Injectable()
export class LlmRegistryService {
  private readonly logger = new Logger(LlmRegistryService.name);

  /** Все провайдеры в порядке приоритета (для листинга моделей). */
  private readonly providers: ReadonlyArray<ILlmProvider>;
  /** id модели → провайдер, который её обслуживает. */
  private readonly byModelId = new Map<string, ILlmProvider>();

  /**
   * Регистрирует модели всех провайдеров.
   *
   * При конфликте id (две модели с одинаковым id у разных провайдеров)
   * **побеждает первый** провайдер в массиве, а конфликт пишется в лог
   * предупреждением. Порядок задаёт `LlmProviderFactory`: Anthropic, OpenAI,
   * RouterAI, DeepSeek, Yandex, LM Studio. Так «нативный» провайдер не
   * перекрывается прокси, и маршрутизация остаётся предсказуемой: один и тот
   * же id всегда уходит в один и тот же провайдер.
   *
   * @param providers - сконфигурированные провайдеры в порядке приоритета
   */
  constructor(@Inject(LLM_PROVIDERS) providers: ILlmProvider[]) {
    this.providers = providers;

    for (const provider of this.providers) {
      for (const model of provider.models) {
        const existing = this.byModelId.get(model.id);

        if (existing) {
          this.logger.warn(
            `Модель ${model.id} объявлена у провайдеров ${existing.name} и ${provider.name}; используется ${existing.name}`,
          );
          continue;
        }

        this.byModelId.set(model.id, provider);
      }
    }
  }

  /**
   * Находит провайдера по id модели.
   *
   * Метод намеренно **не** учитывает {@link ILlmProvider.isConfigured} (KI-039):
   * `resolveByModel` отвечает только на вопрос «кто обслуживает эту модель», а
   * не «можно ли сейчас вызвать провайдера». Неконфигурированный провайдер
   * резолвится штатно, и ошибка всплывает на `generateAsync` с понятным текстом
   * («`ANTHROPIC_API_KEY не задан`»), а не подменяется на «модель не
   * поддерживается» — иначе пользователь с UI получил бы неверную диагностику.
   *
   * @param modelId - id модели (например, `claude-sonnet-4-20250514`)
   * @returns провайдер, обслуживающий модель
   * @throws LlmProviderException если модель не поддерживается ни одним провайдером
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
   * Возвращает список моделей провайдеров, готовых к вызовам.
   *
   * Неконфигурированные провайдеры (без API-ключа) отфильтровываются (KI-039):
   * UI не должен предлагать модели, вызов которых гарантированно упадёт.
   * С v0.5.0 фильтр избыточен — фабрика уже не создаёт провайдеров без ключа, —
   * но оставлен для надёжности, если реестр соберут вручную.
   *
   * @returns модели с указанием провайдера (для UI выбора модели); пустой
   *   массив, если ни один провайдер не сконфигурирован
   */
  listModels(): LlmModelInfo[] {
    return this.providers
      .filter((provider) => provider.isConfigured)
      .flatMap((provider) =>
        provider.models.map((model) => ({
          provider: provider.name,
          id: model.id,
          label: model.label,
          // Модальности пробрасываются в UI (v0.6.0a): по ним селект
          // группирует модели, а карточка узла рисует бейджи.
          inputModalities: model.inputModalities,
          outputModalities: model.outputModalities,
          // R6.3.1: признаки reasoning и дефолтный лимит нужны UI (R6.3.2).
          // Обычным моделям поля не добавляем, чтобы не менять их снимок.
          ...(model.supportsReasoning === true
            ? { supportsReasoning: true }
            : {}),
          ...(model.defaultMaxTokens === undefined
            ? {}
            : { defaultMaxTokens: model.defaultMaxTokens }),
        })),
      );
  }

  /**
   * Возвращает первого провайдера, умеющего embeddings (R7.4a).
   *
   * Порядок — приоритет {@link LLM_PROVIDERS}: Anthropic стоит первым, но
   * `supportsEmbeddings === false`, поэтому пропускается; следующим идёт
   * OpenAI-совместимый провайдер (OpenAI, RouterAI, …). Метод намеренно
   * асинхронный (RULES 1.4): вызывающий код (исполнитель узла) работает в
   * async-контексте, а в будущем выбор может потребовать I/O (каталог моделей).
   *
   * @returns сконфигурированный провайдер с `supportsEmbeddings === true`
   * @throws LlmProviderException если ни один провайдер не умеет embeddings
   */
  async resolveEmbeddingProviderAsync(): Promise<ILlmProvider> {
    const provider = this.providers.find(
      (candidate) => candidate.isConfigured && candidate.supportsEmbeddings === true,
    );

    if (!provider) {
      throw new LlmProviderException(
        'registry',
        'нет сконфигурированного провайдера с поддержкой embeddings',
      );
    }

    return provider;
  }
}
