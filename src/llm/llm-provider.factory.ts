import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MODEL_MODALITIES,
  type ILlmProvider,
  type ModelInfo,
  type ModelModality,
} from './llm-provider.interface.js';
import { REASONING_MAX_TOKENS } from './llm-constants.js';
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
 * Таймаут запроса каталога моделей у LM Studio (KI-088, RULES 4.19).
 *
 * Сервер локальный: если он не запущен, старт не должен ждать дольше этого.
 */
const LMSTUDIO_DISCOVERY_TIMEOUT_MS = 3_000;

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

/**
 * Модели Yandex AI Studio по умолчанию (KI-174).
 *
 * Используются, когда `YANDEX_MODELS` не задан, но известен `YANDEX_FOLDER_ID`.
 * Короткие имена: полный URI собирает {@link LlmProviderFactory.createYandexProvider}.
 *
 * Перечень сверен с документацией Yandex Cloud: доступны `yandexgpt-lite`
 * (Lite) и `yandexgpt` (Pro); версия `/latest` — по умолчанию. Модели каталога
 * с vision (например `qwen3.6-35b-a3b`) задаются через `YANDEX_MODELS` — в
 * публичной документации YandexGPT их нет.
 *
 * @see https://cloud.yandex.ru/docs/foundation-models/concepts/yandexgpt/models
 */
const YANDEX_DEFAULT_MODEL_IDS: readonly string[] = ['yandexgpt-lite', 'yandexgpt'];

/**
 * Версия модели Yandex, подставляемая в URI.
 *
 * `/latest` — версия по умолчанию по документации.
 */
const YANDEX_MODEL_VERSION = 'latest';

/** Префикс URI модели Yandex: `gpt://<folder>/<model>/<version>`. */
const YANDEX_URI_PREFIX = 'gpt://';

/** Суффикс подписи моделей Yandex в селекте. */
const YANDEX_LABEL_SUFFIX = ' (Yandex)';

/** Имя переменной с каталогом моделей Yandex (для предупреждений). */
const YANDEX_MODELS_ENV_KEY = 'YANDEX_MODELS';

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
   * Метод асинхронный (RULES 1.4) из-за LM Studio: его каталог запрашивается
   * у локального сервера (`GET /models`) с коротким таймаутом (KI-088).
   *
   * @returns провайдеры в порядке приоритета; пустой массив, если не
   *   сконфигурирован ни один
   */
  async createProvidersAsync(): Promise<ILlmProvider[]> {
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

    const lmstudio = await this.createLmStudioProvider();

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
   * Создаёт провайдера Yandex AI Studio (KI-159, KI-174).
   *
   * Каталог моделей берётся из `YANDEX_MODELS` (формат общий с
   * `LMSTUDIO_MODELS`), а короткие id превращаются в URI
   * `gpt://<folder_id>/<model>/latest`. Правила:
   *
   * - `YANDEX_MODELS` задан → используем его; короткие id требуют
   *   `YANDEX_FOLDER_ID`, без него они пропускаются с предупреждением,
   *   а полные URI работают всегда;
   * - `YANDEX_MODELS` не задан и `YANDEX_FOLDER_ID` есть → дефолтный список
   *   {@link YANDEX_DEFAULT_MODEL_IDS};
   * - ни того, ни другого → провайдер не создаётся (graceful degradation:
   *   лучше не показывать модели, чем падать с 400 во время Run).
   *
   * @returns провайдер либо `null`, если каталог собрать не удалось
   */
  private createYandexProvider(): OpenAiCompatibleProvider | null {
    const apiKey = this.config.get<string>('YANDEX_API_KEY');

    if (!apiKey) {
      return null;
    }

    const folderId = this.config.get<string>('YANDEX_FOLDER_ID');
    const rawModels = this.config.get<string>('YANDEX_MODELS');
    const models =
      rawModels && rawModels.trim().length > 0
        ? this.parseYandexModels(rawModels, folderId)
        : this.buildYandexModels(YANDEX_DEFAULT_MODEL_IDS, folderId);

    if (models.length === 0) {
      if (!folderId) {
        this.logger.warn(
          'YANDEX_FOLDER_ID не задан — провайдер yandex пропущен: без folder_id URI модели (gpt://<folder_id>/<model>/latest) собрать нельзя',
        );
      }

      return null;
    }

    return new OpenAiCompatibleProvider({
      name: 'yandex',
      apiKey,
      baseURL:
        this.config.get<string>('YANDEX_BASE_URL') ??
        'https://llm.api.cloud.yandex.net/v1',
      models,
      envKey: 'YANDEX_API_KEY',
      // Полные URI уходят как есть, короткие имена превращаются в URI.
      resolveModel: (model) => this.toYandexUri(model, folderId),
    });
  }

  /**
   * Разбирает `YANDEX_MODELS` (KI-174).
   *
   * Отличия от {@link parseModelIds}: id модели Yandex может быть полным URI
   * `gpt://…`, то есть содержать `:` внутри. Простой `indexOf(':')` разрезал
   * бы `gpt` и `//folder/model/latest:text`, поэтому граница «id : модальности»
   * ищется после последнего `/`.
   *
   * @param raw - сырое значение `YANDEX_MODELS`
   * @param folderId - id каталога для коротких id (может отсутствовать)
   * @returns модели с модальностями; пустой массив, если валидных записей нет
   */
  private parseYandexModels(
    raw: string,
    folderId: string | undefined,
  ): ModelInfo[] {
    const models: ModelInfo[] = [];

    for (const entry of raw.split(',')) {
      const trimmed = entry.trim();

      if (trimmed.length === 0) {
        continue;
      }

      const separatorIndex = trimmed.lastIndexOf(':');
      const looksLikeUri = trimmed.startsWith(YANDEX_URI_PREFIX);
      // У URI разделитель модальностей идёт после последнего '/', иначе
      // первый ':' попал бы в схему 'gpt://'.
      const hasModalities =
        separatorIndex > (looksLikeUri ? trimmed.lastIndexOf('/') : -1);
      const id = (
        hasModalities ? trimmed.slice(0, separatorIndex) : trimmed
      ).trim();
      const modalitiesRaw = hasModalities
        ? trimmed.slice(separatorIndex + 1).trim()
        : '';

      if (id.length === 0) {
        this.logger.warn(`${YANDEX_MODELS_ENV_KEY}: пропущена запись без id: "${trimmed}"`);
        continue;
      }

      if (this.isShortYandexId(id) && !folderId) {
        this.logger.warn(
          `${YANDEX_MODELS_ENV_KEY}: у модели "${id}" короткий id, но YANDEX_FOLDER_ID не задан — модель пропущена (задайте полный URI gpt://<folder>/<model>/<version>)`,
        );
        continue;
      }

      const inputModalities = this.parseModalities(id, modalitiesRaw, {
        envKey: YANDEX_MODELS_ENV_KEY,
        labelSuffix: YANDEX_LABEL_SUFFIX,
      });

      if (!inputModalities) {
        continue;
      }

      models.push({
        // Храним то, что пришло из env: полный URI уходит в upstream как есть.
        id: this.toYandexUri(id, folderId),
        label: `${id}${YANDEX_LABEL_SUFFIX}`,
        inputModalities,
        outputModalities: ENV_LIST_OUTPUT,
      });
    }

    return models;
  }

  /**
   * Собирает модели Yandex из коротких id (дефолтный каталог).
   *
   * @param ids - короткие имена моделей
   * @param folderId - id каталога
   * @returns модели либо пустой массив, если folder_id не задан
   */
  private buildYandexModels(
    ids: readonly string[],
    folderId: string | undefined,
  ): ModelInfo[] {
    if (!folderId) {
      return [];
    }

    return ids.map((id) => ({
      id: this.toYandexUri(id, folderId),
      label: `${id}${YANDEX_LABEL_SUFFIX}`,
      inputModalities: ENV_LIST_DEFAULT_INPUT,
      outputModalities: ENV_LIST_OUTPUT,
    }));
  }

  /**
   * Приводит id модели Yandex к URI.
   *
   * Поддерживаются три формы записи в `YANDEX_MODELS`:
   * - полный URI `gpt://…` — уходит как есть, префикс не дублируется;
   * - `yandexgpt-lite` — короткое имя, версия добавляется (`/latest`);
   * - `yandexgpt-lite/latest` — имя с версией, версия **не** добавляется
   *   второй раз.
   *
   * @param id - id модели из env
   * @param folderId - id каталога (нужен для форм без `gpt://`)
   * @returns URI `gpt://<folder>/<model>[/<version>]`; при отсутствии folder_id
   *   короткая форма возвращается как есть (вызывающий код её отфильтровывает)
   */
  private toYandexUri(id: string, folderId: string | undefined): string {
    if (id.startsWith(YANDEX_URI_PREFIX)) {
      return id;
    }

    if (!folderId) {
      return id;
    }

    // Версия уже указана, если в записи есть '/'.
    const hasVersion = id.includes('/');

    return `${YANDEX_URI_PREFIX}${folderId}/${id}${hasVersion ? '' : `/${YANDEX_MODEL_VERSION}`}`;
  }

  /**
   * Проверяет, что запись требует `YANDEX_FOLDER_ID`.
   *
   * @param id - id из env
   * @returns `true`, если это не полный URI (то есть нужен folder_id)
   */
  private isShortYandexId(id: string): boolean {
    return !id.startsWith(YANDEX_URI_PREFIX);
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
   * Создаёт провайдера локального LM Studio (KI-088).
   *
   * Каталог моделей собирается из двух источников:
   * - `LMSTUDIO_MODELS` — приоритет: пользователь сам задаёт модальности;
   * - `GET {LMSTUDIO_BASE_URL}/models` — реальный список сервера.
   *
   * Правила слияния: если env пуст, берутся все модели из API с модальностью
   * `text`; если env задан, его записи сохраняются как есть (включая
   * модальности), а модели, которых нет в API, остаются с предупреждением —
   * пользователь может знать лучше, а сервер мог быть просто не запущен.
   * Недоступный API не роняет старт: используется env как есть.
   *
   * @returns провайдер либо `null`, если моделей нет ни в env, ни в API
   */
  private async createLmStudioProvider(): Promise<OpenAiCompatibleProvider | null> {
    const baseURL =
      this.config.get<string>('LMSTUDIO_BASE_URL') ?? LMSTUDIO_DEFAULT_BASE_URL;
    const envModels = this.parseModelIds(
      this.config.get<string>('LMSTUDIO_MODELS') ?? '',
      { envKey: 'LMSTUDIO_MODELS', labelSuffix: ' (local)' },
    );
    const discovered = await this.fetchLmStudioModelIdsAsync(baseURL);
    const models = this.mergeLmStudioModels(envModels, discovered);

    if (models.length === 0) {
      return null;
    }

    return new OpenAiCompatibleProvider({
      name: 'lmstudio',
      apiKey: LMSTUDIO_PLACEHOLDER_KEY,
      baseURL,
      models,
      // LM Studio крутится на своём железе: стоимость вызова — 0, не null (KI-148).
      isLocal: true,
    });
  }

  /**
   * Сливает модели из env с найденными в LM Studio (KI-088).
   *
   * @param envModels - модели из `LMSTUDIO_MODELS` (приоритет)
   * @param discoveredIds - id моделей из `GET /models`
   * @returns итоговый каталог с суффиксом ` (local)` в подписи
   */
  private mergeLmStudioModels(
    envModels: readonly ModelInfo[],
    discoveredIds: readonly string[],
  ): ModelInfo[] {
    // env не задан — доверяем серверу, все модели считаем текстовыми.
    if (envModels.length === 0) {
      return discoveredIds.map((id) => ({
        id,
        label: `${id} (local)`,
        inputModalities: ENV_LIST_DEFAULT_INPUT,
        outputModalities: ENV_LIST_OUTPUT,
      }));
    }

    // API недоступен — работаем по env, как раньше.
    if (discoveredIds.length === 0) {
      return [...envModels];
    }

    for (const model of envModels) {
      if (!discoveredIds.includes(model.id)) {
        this.logger.warn(
          `LMSTUDIO_MODELS: модель "${model.id}" не найдена в LM Studio (GET /models) — оставлена как задана; проверьте id через ${baseUrlHint()}`,
        );
      }
    }

    // Модели из API, которых нет в env: добавляем с дефолтной модальностью,
    // чтобы сервер не выглядел пустым, если пользователь задал список вручную.
    const extra = discoveredIds
      .filter((id) => !envModels.some((model) => model.id === id))
      .map((id) => ({
        id,
        label: `${id} (local)`,
        inputModalities: ENV_LIST_DEFAULT_INPUT,
        outputModalities: ENV_LIST_OUTPUT,
      }));

    return [...envModels, ...extra];
  }

  /**
   * Запрашивает список моделей у LM Studio (KI-088).
   *
   * Сервер локальный, поэтому таймаут короткий: если он не запущен, старт
   * приложения не должен ждать. Любая ошибка (нет соединения, не-2xx, битый
   * JSON) трактуется одинаково — «список неизвестен».
   *
   * @param baseURL - базовый адрес LM Studio (обычно `…/v1`)
   * @returns id моделей; пустой массив, если сервер недоступен
   */
  private async fetchLmStudioModelIdsAsync(baseURL: string): Promise<string[]> {
    const signal = AbortSignal.timeout(LMSTUDIO_DISCOVERY_TIMEOUT_MS);

    try {
      const response = await fetch(`${baseURL.replace(/\/+$/, '')}/models`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      });

      if (!response.ok) {
        this.logger.warn(
          `LM Studio ответил ${response.status} на GET /models — используется только LMSTUDIO_MODELS`,
        );

        return [];
      }

      const payload: unknown = await response.json();

      return extractModelIds(payload);
    } catch (error: unknown) {
      // Штатная ситуация: LM Studio не запущен.
      this.logger.warn(
        `LM Studio недоступен (${baseURL}) — используется только LMSTUDIO_MODELS: ${toMessage(error)}`,
      );

      return [];
    }
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
    /** Суффикс env-записи, помечающий модель как reasoning (R6.3.1). */
    const REASONING_SUFFIX = ':reasoning';

    for (const entry of raw.split(',')) {
      const trimmed = entry.trim();

      if (trimmed.length === 0) {
        continue;
      }

      const separatorIndex = trimmed.indexOf(':');
      const id =
        separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex).trim();
      const tail =
        separatorIndex === -1 ? '' : trimmed.slice(separatorIndex + 1).trim();
      // R6.3.1 (KI-193): опциональный суффикс `:reasoning` идёт ПОСЛЕ
      // модальностей: `<id>:<modalities>[:reasoning]`. Без суффикса модель
      // считается обычной.
      const hasReasoning =
        tail === 'reasoning' || tail.endsWith(REASONING_SUFFIX);
      const modalitiesRaw = hasReasoning
        ? tail === 'reasoning'
          ? ''
          : tail.slice(0, -REASONING_SUFFIX.length)
        : tail;

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
        // KI-183: reasoning-модели тратят бюджет ответа на рассуждения, поэтому
        // им сразу задаём больший лимит (4096). Обычным полям лимит НЕ задаём:
        // провайдер возьмёт свой `DEFAULT_MAX_TOKENS` (1024) — так список
        // моделей для них остаётся прежним.
        ...(hasReasoning
          ? { supportsReasoning: true, defaultMaxTokens: REASONING_MAX_TOKENS }
          : {}),
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

/**
 * Приводит неизвестную ошибку к тексту для лога.
 *
 * @param error - значение из `catch`
 * @returns сообщение ошибки
 */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Подсказка, как посмотреть реальные id моделей LM Studio.
 *
 * @returns команда для терминала
 */
function baseUrlHint(): string {
  return 'GET /v1/models у LM Studio';
}

/**
 * Извлекает id моделей из ответа `GET /models` (KI-088).
 *
 * Ответ внешнего сервера, поэтому разбирается без предположений о форме:
 * ожидается OpenAI-совместимый `{ data: [{ id }] }`, всё остальное считается
 * «список неизвестен» — старт из-за этого не падает.
 *
 * @param payload - разобранный JSON ответа
 * @returns id моделей; пустой массив, если данных нет
 */
function extractModelIds(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
    return [];
  }

  const data = (payload as { data?: unknown }).data;

  if (!Array.isArray(data)) {
    return [];
  }

  const ids: string[] = [];

  for (const item of data) {
    if (typeof item === 'object' && item !== null && 'id' in item) {
      const id = (item as { id?: unknown }).id;

      if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }

  return ids;
}
