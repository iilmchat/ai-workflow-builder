import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MODEL_MODALITIES,
  type ILlmProvider,
  type ModelInfo,
  type ModelModality,
} from './llm-provider.interface.js';
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

/** Модальности по умолчанию для моделей LM Studio (без суффикса в env). */
const LMSTUDIO_DEFAULT_INPUT: readonly ModelModality[] = ['text'];
/** LM Studio — локальный инференс текста, картинки он не генерирует. */
const LMSTUDIO_OUTPUT: readonly ModelModality[] = ['text'];

/** Модели OpenAI (список фиксирован в коде). */
const OPENAI_MODELS: readonly ModelInfo[] = [
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    inputModalities: ['text', 'vision'],
    outputModalities: ['text'],
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    inputModalities: ['text', 'vision'],
    outputModalities: ['text'],
  },
];

/** Модели, доступные через RouterAI (OpenAI-совместимый прокси). */
const ROUTERAI_MODELS: readonly ModelInfo[] = [
  {
    id: 'anthropic/claude-sonnet-4',
    label: 'Claude Sonnet 4 (RouterAI)',
    inputModalities: ['text', 'vision'],
    outputModalities: ['text'],
  },
  {
    id: 'anthropic/claude-opus-4',
    label: 'Claude Opus 4 (RouterAI)',
    inputModalities: ['text', 'vision'],
    outputModalities: ['text'],
  },
  {
    id: 'openai/gpt-4o',
    label: 'GPT-4o (RouterAI)',
    inputModalities: ['text', 'vision'],
    outputModalities: ['text'],
  },
  {
    id: 'google/gemini-2.5-pro',
    label: 'Gemini 2.5 Pro (RouterAI)',
    inputModalities: ['text', 'vision'],
    outputModalities: ['text'],
  },
];

/** Модели DeepSeek (текстовые, vision у них нет). */
const DEEPSEEK_MODELS: readonly ModelInfo[] = [
  {
    id: 'deepseek-chat',
    label: 'DeepSeek V3 (chat)',
    inputModalities: ['text'],
    outputModalities: ['text'],
  },
  {
    id: 'deepseek-reasoner',
    label: 'DeepSeek R1 (reasoner)',
    inputModalities: ['text'],
    outputModalities: ['text'],
  },
];

/** Модели Yandex AI Studio. */
const YANDEX_MODELS: readonly ModelInfo[] = [
  {
    id: 'qwen3.6-35b-a3b/latest',
    label: 'Qwen3.6-35B (Yandex)',
    inputModalities: ['text', 'vision'],
    outputModalities: ['text'],
  },
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
   * Модальности у моделей берутся из того же значения (см.
   * {@link parseModelIds}).
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
   * Разбирает список моделей LM Studio из строки окружения.
   *
   * Формат: `<id>[:<модальность>[+<модальность>...]]` через запятую, например
   * `qwen2.5-coder-7b-instruct:text,qwen/qwen2.5-vl-7b:text+vision`.
   * Без суффикса модель считается текстовой. `outputModalities` всегда
   * `['text']`: локальный LM Studio картинки не генерирует.
   *
   * Невалидная модальность не роняет старт: модель пропускается, а в лог
   * уходит предупреждение — стартовать с опечаткой в env полезнее, чем не
   * стартовать вовсе.
   *
   * @param raw - сырое значение `LMSTUDIO_MODELS`
   * @returns модели с модальностями; пустой массив, если валидных записей нет
   */
  private parseModelIds(raw: string): ModelInfo[] {
    const models: ModelInfo[] = [];

    for (const entry of raw.split(',')) {
      const trimmed = entry.trim();

      if (trimmed.length === 0) {
        continue;
      }

      const separatorIndex = trimmed.indexOf(':');
      const id =
        separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex).trim();
      const modalitiesRaw =
        separatorIndex === -1 ? '' : trimmed.slice(separatorIndex + 1).trim();

      if (id.length === 0) {
        this.logger.warn(`LMSTUDIO_MODELS: пропущена запись без id: "${trimmed}"`);
        continue;
      }

      const inputModalities = this.parseModalities(id, modalitiesRaw);

      if (!inputModalities) {
        continue;
      }

      models.push({
        id,
        label: `${id} (local)`,
        inputModalities,
        outputModalities: LMSTUDIO_OUTPUT,
      });
    }

    return models;
  }

  /**
   * Разбирает список модальностей через `+`.
   *
   * @param modelId - id модели (для сообщения в логе)
   * @param raw - строка модальностей; пустая — дефолт `['text']`
   * @returns модальности либо `null`, если встречена неизвестная
   */
  private parseModalities(
    modelId: string,
    raw: string,
  ): readonly ModelModality[] | null {
    if (raw.length === 0) {
      return LMSTUDIO_DEFAULT_INPUT;
    }

    const parsed: ModelModality[] = [];

    for (const part of raw.split('+')) {
      const candidate = part.trim();
      const modality = MODEL_MODALITIES.find((item) => item === candidate);

      if (!modality) {
        this.logger.warn(
          `LMSTUDIO_MODELS: у модели ${modelId} неизвестная модальность "${candidate}", модель пропущена`,
        );
        return null;
      }

      if (!parsed.includes(modality)) {
        parsed.push(modality);
      }
    }

    return parsed.length > 0 ? parsed : LMSTUDIO_DEFAULT_INPUT;
  }
}
