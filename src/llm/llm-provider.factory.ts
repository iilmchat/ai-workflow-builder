import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ILlmProvider } from './llm-provider.interface.js';
import { AnthropicProvider } from './providers/anthropic.provider.js';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider.js';

/** Заглушка ключа для LM Studio: локальный сервер ключ не проверяет. */
const LMSTUDIO_PLACEHOLDER_KEY = 'not-needed';

/**
 * Дефолтный адрес LM Studio.
 *
 * Дублирует дефолт env-схемы: фабрика должна работать и когда её собрали на
 * «сыром» `ConfigService` без прошедшего `validateEnv` (например, в тестах).
 */
const LMSTUDIO_DEFAULT_BASE_URL = 'http://localhost:1234/v1';

/** Модели OpenAI (v0.5.0: список фиксирован в коде). */
const OPENAI_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
];

/** Модели, доступные через RouterAI (OpenAI-совместимый прокси). */
const ROUTERAI_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (RouterAI)' },
  { id: 'anthropic/claude-opus-4', label: 'Claude Opus 4 (RouterAI)' },
  { id: 'openai/gpt-4o', label: 'GPT-4o (RouterAI)' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (RouterAI)' },
];

/** Модели DeepSeek. */
const DEEPSEEK_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'deepseek-chat', label: 'DeepSeek V3 (chat)' },
  { id: 'deepseek-reasoner', label: 'DeepSeek R1 (reasoner)' },
];

/** Модели Yandex AI Studio. */
const YANDEX_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'qwen3.6-35b-a3b/latest', label: 'Qwen3.6-35B (Yandex)' },
];

/**
 * Фабрика LLM-провайдеров (v0.5.0).
 *
 * Заменяет прежний хардкод `AnthropicProvider + OpenAiProvider` в
 * {@link LlmModule}: состав провайдеров собирается из окружения, поэтому
 * OpenAI и RouterAI (и DeepSeek, Yandex, LM Studio) могут работать
 * одновременно, каждый со своим ключом и baseURL.
 *
 * Провайдеры создаются **только если сконфигурированы**: без ключа запись в
 * список не попадает, и `GET /llm/models` не показывает заведомо нерабочие
 * модели. Единственное исключение — LM Studio: ему ключ не нужен, но он
 * включается лишь при непустом `LMSTUDIO_MODELS`.
 *
 * Порядок провайдеров в массиве — приоритет при конфликте id моделей
 * (см. {@link LlmRegistryService}): первым идёт Anthropic, затем OpenAI,
 * RouterAI, DeepSeek, Yandex, LM Studio.
 */
@Injectable()
export class LlmProviderFactory {
  private readonly logger = new Logger(LlmProviderFactory.name);

  /**
   * @param config - доступ к переменным окружения (RULES 4.6)
   */
  constructor(private readonly config: ConfigService) {}

  /**
   * Собирает список провайдеров из окружения.
   *
   * Схема окружения уже проверена `validateEnv` при старте (RULES 4.5),
   * поэтому здесь значения читаются без повторной валидации.
   *
   * @returns провайдеры в порядке приоритета; пустой массив, если не
   *   сконфигурирован ни один
   */
  createProviders(): ILlmProvider[] {
    const providers: ILlmProvider[] = [];

    const anthropicKey = this.config.get<string>('ANTHROPIC_API_KEY');

    if (anthropicKey) {
      providers.push(new AnthropicProvider(this.config));
    }

    const openai = this.createOpenAiProvider();

    if (openai) {
      providers.push(openai);
    }

    const routerai = this.createRouterAiProvider();

    if (routerai) {
      providers.push(routerai);
    }

    const deepseek = this.createDeepSeekProvider();

    if (deepseek) {
      providers.push(deepseek);
    }

    const yandex = this.createYandexProvider();

    if (yandex) {
      providers.push(yandex);
    }

    const lmstudio = this.createLmStudioProvider();

    if (lmstudio) {
      providers.push(lmstudio);
    }

    this.logger.log(
      `LLM-провайдеры: ${providers.length > 0 ? providers.map((provider) => provider.name).join(', ') : 'нет сконфигурированных'}`,
    );

    return providers;
  }

  /**
   * Создаёт провайдера OpenAI.
   *
   * `OPENAI_BASE_URL` поддерживается для обратной совместимости с R5.0:
   * если он задан, провайдер `openai` фактически работает через прокси.
   *
   * @returns провайдер либо `null`, если ключ не задан
   */
  private createOpenAiProvider(): OpenAiCompatibleProvider | null {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      return null;
    }

    return new OpenAiCompatibleProvider({
      name: 'openai',
      apiKey,
      baseURL:
        this.config.get<string>('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1',
      models: OPENAI_MODELS,
      envKey: 'OPENAI_API_KEY',
    });
  }

  /**
   * Создаёт провайдера RouterAI.
   *
   * @returns провайдер либо `null`, если ключ не задан
   */
  private createRouterAiProvider(): OpenAiCompatibleProvider | null {
    const apiKey = this.config.get<string>('ROUTERAI_API_KEY');

    if (!apiKey) {
      return null;
    }

    return new OpenAiCompatibleProvider({
      name: 'routerai',
      apiKey,
      baseURL:
        this.config.get<string>('ROUTERAI_BASE_URL') ?? 'https://routerai.ru/api/v1',
      models: ROUTERAI_MODELS,
      envKey: 'ROUTERAI_API_KEY',
    });
  }

  /**
   * Создаёт провайдера DeepSeek.
   *
   * @returns провайдер либо `null`, если ключ не задан
   */
  private createDeepSeekProvider(): OpenAiCompatibleProvider | null {
    const apiKey = this.config.get<string>('DEEPSEEK_API_KEY');

    if (!apiKey) {
      return null;
    }

    return new OpenAiCompatibleProvider({
      name: 'deepseek',
      apiKey,
      baseURL:
        this.config.get<string>('DEEPSEEK_BASE_URL') ??
        'https://api.deepseek.com/v1',
      models: DEEPSEEK_MODELS,
      envKey: 'DEEPSEEK_API_KEY',
    });
  }

  /**
   * Создаёт провайдера Yandex AI Studio.
   *
   * @returns провайдер либо `null`, если ключ не задан
   */
  private createYandexProvider(): OpenAiCompatibleProvider | null {
    const apiKey = this.config.get<string>('YANDEX_API_KEY');

    if (!apiKey) {
      return null;
    }

    return new OpenAiCompatibleProvider({
      name: 'yandex',
      apiKey,
      baseURL:
        this.config.get<string>('YANDEX_BASE_URL') ??
        'https://llm.api.cloud.yandex.net/v1',
      models: YANDEX_MODELS,
      envKey: 'YANDEX_API_KEY',
    });
  }

  /**
   * Создаёт провайдера локального LM Studio.
   *
   * Ключ не нужен, поэтому единственное условие — непустой список моделей
   * `LMSTUDIO_MODELS`: без него провайдер не знает, что предлагать в UI.
   *
   * @returns провайдер либо `null`, если список моделей пуст
   */
  private createLmStudioProvider(): OpenAiCompatibleProvider | null {
    const baseURL =
      this.config.get<string>('LMSTUDIO_BASE_URL') ?? LMSTUDIO_DEFAULT_BASE_URL;
    const models = this.parseModelIds(
      this.config.get<string>('LMSTUDIO_MODELS') ?? '',
    );

    if (models.length === 0) {
      return null;
    }

    return new OpenAiCompatibleProvider({
      name: 'lmstudio',
      apiKey: LMSTUDIO_PLACEHOLDER_KEY,
      baseURL,
      models,
    });
  }

  /**
   * Разбирает список id моделей из строки через запятую.
   *
   * @param raw - сырое значение `LMSTUDIO_MODELS`
   * @returns модели с человекочитаемыми подписями; пустой массив, если
   *   значений нет
   */
  private parseModelIds(raw: string): Array<{ id: string; label: string }> {
    return raw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .map((id) => ({ id, label: `${id} (local)` }));
  }
}
