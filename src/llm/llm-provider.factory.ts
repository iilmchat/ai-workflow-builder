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

/**
 * Дефолтный адрес GPTunnel.
 *
 * Дублирует дефолт env-схемы по той же причине, что и у LM Studio.
 */
const GPTUNNEL_DEFAULT_BASE_URL = 'https://gptunnel.ru/v1';

/** Модальности по умолчанию для моделей из env-списка (запись без суффикса). */
const ENV_LIST_DEFAULT_INPUT: readonly ModelModality[] = ['text'];
/**
 * Выходная модальность для моделей, объявленных через env-список.
 *
 * И GPTunnel, и LM Studio в этом релизе используются как chat-провайдеры, а
 * картинки/аудио в списке не выражаются: формат описывает только вход.
 * Когда появится media-провайдер (v0.6.0b.2), выход тоже нужно будет
 * параметризовать.
 */
const ENV_LIST_OUTPUT: readonly ModelModality[] = ['text'];

/** Настройки разбора env-списка моделей. */
interface EnvModelListOptions {
  /** Имя переменной окружения — попадает в предупреждения. */
  envKey: string;
  /** Суффикс подписи модели, например ` (local)`. */
  labelSuffix: string;
}

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
 * Фабрика LLM-провайдеров (v0.5.0; GPTunnel — v0.6.0b.1).
 *
 * Заменяет прежний хардкод `AnthropicProvider + OpenAiProvider` в
 * {@link LlmModule}: состав провайдеров собирается из окружения, поэтому
 * OpenAI, RouterAI, GPTunnel (и DeepSeek, Yandex, LM Studio) могут работать
 * одновременно, каждый со своим ключом и baseURL.
 *
 * Провайдеры создаются **только если сконфигурированы**: без ключа запись в
 * список не попадает, и `GET /llm/models` не показывает заведомо нерабочие
 * модели. Исключения: LM Studio (ключ не нужен, но включается лишь при
 * непустом `LMSTUDIO_MODELS`) и GPTunnel (нужны и ключ, и непустой
 * `GPTUNNEL_MODELS` — он играет роль каталога моделей).
 *
 * Порядок провайдеров в массиве — приоритет при конфликте id моделей
 * (см. {@link LlmRegistryService}): первым идёт Anthropic, затем OpenAI,
 * RouterAI, GPTunnel, DeepSeek, Yandex, LM Studio.
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

    const gptunnel = this.createGptunnelProvider();

    if (gptunnel) {
      providers.push(gptunnel);
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
   * Создаёт провайдера GPTunnel.
   *
   * GPTunnel отдаёт ~200 моделей, но без метаданных о vision — только `id` и
   * `title`. Поэтому список для UI задаётся в `GPTUNNEL_MODELS` тем же
   * форматом, что и `LMSTUDIO_MODELS`, а роль «каталога» играет env.
   *
   * Нужны **и** ключ, **и** непустой список: без ключа вызовы упадут, без
   * списка провайдеру нечего показывать в UI.
   *
   * @returns провайдер либо `null`, если ключ или список моделей пусты
   */
  private createGptunnelProvider(): OpenAiCompatibleProvider | null {
    const apiKey = this.config.get<string>('GPTUNNEL_API_KEY');

    if (!apiKey) {
      return null;
    }

    const models = this.parseModelIds(
      this.config.get<string>('GPTUNNEL_MODELS') ?? '',
      { envKey: 'GPTUNNEL_MODELS', labelSuffix: '' },
    );

    if (models.length === 0) {
      return null;
    }

    return new OpenAiCompatibleProvider({
      name: 'gptunnel',
      apiKey,
      baseURL:
        this.config.get<string>('GPTUNNEL_BASE_URL') ?? GPTUNNEL_DEFAULT_BASE_URL,
      models,
      envKey: 'GPTUNNEL_API_KEY',
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
      { envKey: 'LMSTUDIO_MODELS', labelSuffix: ' (local)' },
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
   * Разбирает список моделей из переменной окружения.
   *
   * Формат: `<id>[:<модальность>[+<модальность>...]]` через запятую, например
   * `qwen2.5-coder-7b-instruct:text,qwen/qwen2.5-vl-7b:text+vision`.
   * Без суффикса модель считается текстовой. Парсер общий для GPTunnel и
   * LM Studio: у них одинаковый формат env-списка.
   *
   * Невалидная модальность не роняет старт: модель пропускается, а в лог
   * уходит предупреждение — стартовать с опечаткой в env полезнее, чем не
   * стартовать вовсе.
   *
   * @param raw - сырое значение переменной со списком моделей
   * @param options - имя переменной (для логов) и суффикс подписи модели
   * @returns модели с модальностями; пустой массив, если валидных записей нет
   */
  private parseModelIds(
    raw: string,
    options: EnvModelListOptions,
  ): ModelInfo[] {
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
        this.logger.warn(
          `${options.envKey}: пропущена запись без id: "${trimmed}"`,
        );
        continue;
      }

      const inputModalities = this.parseModalities(id, modalitiesRaw, options);

      if (!inputModalities) {
        continue;
      }

      models.push({
        id,
        label: `${id}${options.labelSuffix}`,
        inputModalities,
        outputModalities: ENV_LIST_OUTPUT,
      });
    }

    return models;
  }

  /**
   * Разбирает список модальностей через `+`.
   *
   * @param modelId - id модели (для сообщения в логе)
   * @param raw - строка модальностей; пустая — дефолт `['text']`
   * @param options - имя переменной (для логов) и суффикс подписи модели
   * @returns модальности либо `null`, если встречена неизвестная
   */
  private parseModalities(
    modelId: string,
    raw: string,
    options: EnvModelListOptions,
  ): readonly ModelModality[] | null {
    if (raw.length === 0) {
      return ENV_LIST_DEFAULT_INPUT;
    }

    const parsed: ModelModality[] = [];

    for (const part of raw.split('+')) {
      const candidate = part.trim();
      const modality = MODEL_MODALITIES.find((item) => item === candidate);

      if (!modality) {
        this.logger.warn(
          `${options.envKey}: у модели ${modelId} неизвестная модальность "${candidate}", модель пропущена`,
        );
        return null;
      }

      if (!parsed.includes(modality)) {
        parsed.push(modality);
      }
    }

    return parsed.length > 0 ? parsed : ENV_LIST_DEFAULT_INPUT;
  }
}
