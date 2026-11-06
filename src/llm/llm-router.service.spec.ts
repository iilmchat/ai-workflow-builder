import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  LlmProviderException,
  type ILlmProvider,
  type LlmGenerateOptions,
  type LlmGenerateResult,
  type ModelInfo,
} from './llm-provider.interface.js';
import { LlmHealthService } from './llm-health.service.js';
import { LlmRegistryService } from './llm-registry.service.js';
import { LlmRouterService } from './llm-router.service.js';

/** Ответ провайдера-заглушки. */
function answer(text: string, model: string): LlmGenerateResult {
  return { text, usage: { inputTokens: 1, outputTokens: 2, model } };
}

/** Мок `generateAsync` с сохранением аргументов вызова. */
type GenerateMock = ReturnType<
  typeof vi.fn<
    (prompt: string, options: LlmGenerateOptions) => Promise<LlmGenerateResult>
  >
>;

/** Мок `isAvailableAsync`. */
type AvailabilityMock = ReturnType<typeof vi.fn<() => Promise<boolean>>>;

/** Провайдер-заглушка с доступными для проверки моками. */
interface StubProvider extends ILlmProvider {
  generateAsync: GenerateMock;
  isAvailableAsync: AvailabilityMock;
}

/** Опции создания провайдера-заглушки. */
interface StubProviderOptions {
  /** Имя провайдера. */
  name: string;
  /** id объявленных моделей. */
  models: string[];
  /** Дополнительные возможности, общие для всех моделей провайдера. */
  modelOverrides?: Partial<ModelInfo>;
  /** Локальный ли провайдер. */
  isLocal?: boolean;
  /** Ответ `generateAsync`; по умолчанию — текст `<name> answer`. */
  generateAsync?: (prompt: string, options: LlmGenerateOptions) => Promise<LlmGenerateResult>;
  /** Ответ `isAvailableAsync`; по умолчанию — `true`. */
  isAvailableAsync?: () => Promise<boolean>;
}

/**
 * Собирает провайдера-заглушку с обязательными членами `ILlmProvider`.
 *
 * @param options - имя, модели, флаги и поведения
 * @returns провайдер для тестов
 */
function stubProvider(options: StubProviderOptions): StubProvider {
  return {
    name: options.name,
    models: options.models.map((id) => ({
      id,
      label: id,
      inputModalities: ['text'],
      outputModalities: ['text'],
      ...options.modelOverrides,
    })),
    isConfigured: true,
    ...(options.isLocal === true ? { isLocal: true } : {}),
    generateAsync: vi.fn(
      options.generateAsync ??
        ((_prompt: string, providerOptions: LlmGenerateOptions) =>
          Promise.resolve(answer(`${options.name} answer`, providerOptions.model))),
    ),
    isAvailableAsync: vi.fn(options.isAvailableAsync ?? (() => Promise.resolve(true))),
    embedAsync: vi.fn(),
  };
}

/** Настройки тестового окружения роутера. */
interface RouterSetup {
  /** Локальный провайдер (LM Studio). */
  local?: ILlmProvider;
  /** Облачный провайдер. */
  cloud?: ILlmProvider;
  /** Дополнительные облачные провайдеры (ниже приоритетом). */
  extraClouds?: ILlmProvider[];
  /** Значение `LLM_ROUTER_ENABLED`. */
  enabled?: boolean;
  /** Значение `LLM_ROUTER_FALLBACK_MODEL`. */
  fallbackModel?: string;
  /** Есть ли healthcheck и что он отвечает. */
  health?: { available: boolean } | null;
}

/**
 * Собирает роутер с настоящим реестром провайдеров и (опционально)
 * healthcheck'ом.
 *
 * Реестр не подменяется: v1.3 S1 добавила сверку возможностей, и тесты должны
 * проверять её вместе с реальными `getCapabilities`/`findCompatibleRoute`, а не
 * с фейковым объектом, который можно случайно рассинхронизировать с сервисом.
 *
 * @param setup - локальный/облачный провайдеры и флаги
 * @returns роутер и мок healthcheck'а
 */
async function createRouter(setup: RouterSetup): Promise<{
  router: LlmRouterService;
  health: { isAvailableAsync: ReturnType<typeof vi.fn> } | null;
}> {
  const providers = [setup.local, setup.cloud, ...(setup.extraClouds ?? [])].filter(
    (provider): provider is ILlmProvider => provider !== undefined,
  );
  const registry = new LlmRegistryService(providers);
  const health =
    setup.health === null
      ? null
      : {
          isAvailableAsync: vi.fn(() =>
            Promise.resolve(setup.health?.available ?? true),
          ),
        };
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'LLM_ROUTER_ENABLED') {
        return String(setup.enabled ?? false);
      }

      if (key === 'LLM_ROUTER_FALLBACK_MODEL') {
        return setup.fallbackModel ?? 'gpt-4o-mini';
      }

      return undefined;
    }),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      LlmRouterService,
      { provide: LlmRegistryService, useValue: registry },
      ...(health === null
        ? []
        : [{ provide: LlmHealthService, useValue: health }]),
      { provide: ConfigService, useValue: config },
    ],
  }).compile();

  return { router: moduleRef.get(LlmRouterService), health };
}

describe('LlmRouterService (v1.2 S1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('LLM_ROUTER_ENABLED=false: вызывает провайдера по модели, локальный не трогает', async () => {
    const local = stubProvider({ name: 'lmstudio', models: ['qwen-local'], isLocal: true });
    const cloud = stubProvider({ name: 'openai', models: ['gpt-4o-mini'] });
    const { router, health } = await createRouter({ local, cloud, enabled: false });

    const result = await router.generateAsync('привет', { model: 'gpt-4o-mini' });

    expect(result).toEqual({
      ...answer('openai answer', 'gpt-4o-mini'),
      isLocal: false,
    });
    expect(local.generateAsync).not.toHaveBeenCalled();
    expect(local.isAvailableAsync).not.toHaveBeenCalled();
    // Роутер выключен — healthcheck даже не спрашиваем.
    expect(health?.isAvailableAsync).not.toHaveBeenCalled();
  });

  it('LLM_ROUTER_ENABLED=false: локальная модель остаётся локальной (isLocal=true)', async () => {
    const local = stubProvider({ name: 'lmstudio', models: ['qwen-local'], isLocal: true });
    const { router } = await createRouter({ local, enabled: false });

    const result = await router.generateAsync('привет', { model: 'qwen-local' });

    expect(result.isLocal).toBe(true);
  });

  it('GPU доступен: вызов идёт в LM Studio, облако не вызывается', async () => {
    const local = stubProvider({
      name: 'lmstudio',
      models: ['qwen-local'],
      isLocal: true,
      generateAsync: () => Promise.resolve(answer('локальный ответ', 'qwen-local')),
    });
    const cloud = stubProvider({ name: 'openai', models: ['gpt-4o-mini'] });
    const { router, health } = await createRouter({
      local,
      cloud,
      enabled: true,
      health: { available: true },
    });

    const result = await router.generateAsync('привет', { model: 'gpt-4o-mini' });

    expect(result).toEqual({
      ...answer('локальный ответ', 'qwen-local'),
      isLocal: true,
    });
    expect(local.generateAsync).toHaveBeenCalledTimes(1);
    // Выбранная в графе облачная модель локально не объявлена — уходит первая
    // локальная. С v1.3 S1 (KI-617) такая подмена допустима только при
    // совпадении возможностей: здесь обе модели текстовые.
    expect(local.generateAsync.mock.calls[0][1].model).toBe('qwen-local');
    expect(cloud.generateAsync).not.toHaveBeenCalled();
    expect(health?.isAvailableAsync).toHaveBeenCalledTimes(1);
  });

  it('GPU доступен и модель объявлена локально: модель не подменяется', async () => {
    const local = stubProvider({
      name: 'lmstudio',
      models: ['qwen-local', 'qwen-big'],
      isLocal: true,
    });
    const { router } = await createRouter({ local, enabled: true });

    await router.generateAsync('привет', { model: 'qwen-big' });

    expect(local.generateAsync.mock.calls[0][1].model).toBe('qwen-big');
  });

  it('GPU недоступен (health): сразу облачный fallback', async () => {
    const local = stubProvider({ name: 'lmstudio', models: ['qwen-local'], isLocal: true });
    const cloud = stubProvider({ name: 'openai', models: ['gpt-4o-mini'] });
    const { router } = await createRouter({
      local,
      cloud,
      enabled: true,
      health: { available: false },
    });

    const result = await router.generateAsync('привет', { model: 'qwen-local' });

    expect(result).toEqual({
      ...answer('openai answer', 'gpt-4o-mini'),
      isLocal: false,
    });
    expect(local.generateAsync).not.toHaveBeenCalled();
    expect(cloud.generateAsync.mock.calls[0][1].model).toBe('gpt-4o-mini');
  });

  it('ошибка LM Studio: WARN и fallback в облако', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const local = stubProvider({
      name: 'lmstudio',
      models: ['qwen-local'],
      isLocal: true,
      generateAsync: () => Promise.reject(new LlmProviderException('lmstudio', 'сервер лёг')),
    });
    const cloud = stubProvider({ name: 'openai', models: ['gpt-4o-mini'] });
    const { router } = await createRouter({ local, cloud, enabled: true });

    const result = await router.generateAsync('привет', { model: 'gpt-4o-mini' });

    expect(result.text).toBe('openai answer');
    expect(result.isLocal).toBe(false);
    expect(cloud.generateAsync).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('LM Studio: вызов модели "qwen-local" не удался'),
    );
    // RULES 5.9: промпт в WARN не попадает.
    expect(warn.mock.calls.flat().join(' ')).not.toContain('привет');
  });

  it('локального провайдера нет: вызов идёт в облако', async () => {
    const cloud = stubProvider({ name: 'openai', models: ['gpt-4o-mini'] });
    const { router } = await createRouter({ cloud, enabled: true });

    const result = await router.generateAsync('привет', { model: 'gpt-4o-mini' });

    expect(result.text).toBe('openai answer');
    expect(result.isLocal).toBe(false);
  });

  it('нет облачного провайдера: LlmProviderException, а не тихий успех', async () => {
    const local = stubProvider({ name: 'lmstudio', models: ['qwen-local'], isLocal: true });
    const { router } = await createRouter({
      local,
      enabled: true,
      health: { available: false },
    });

    await expect(
      router.generateAsync('привет', { model: 'qwen-local' }),
    ).rejects.toThrow(LlmProviderException);
  });

  it('fallback-модель не объявлена: берётся первая модель облака + WARN', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const cloud = stubProvider({ name: 'anthropic', models: ['claude-sonnet-4'] });
    const { router } = await createRouter({
      cloud,
      enabled: true,
      fallbackModel: 'gpt-4o-mini',
    });

    const result = await router.generateAsync('привет', { model: 'qwen-local' });

    expect(result.text).toBe('anthropic answer');
    expect(cloud.generateAsync.mock.calls[0][1].model).toBe('claude-sonnet-4');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('несовместима'),
    );
  });

  it('таймаут создаётся на каждую попытку, а не один на маршрут', async () => {
    const local = stubProvider({
      name: 'lmstudio',
      models: ['qwen-local'],
      isLocal: true,
      generateAsync: () => Promise.reject(new LlmProviderException('lmstudio', 'timeout')),
    });
    const cloud = stubProvider({ name: 'openai', models: ['gpt-4o-mini'] });
    const { router } = await createRouter({ local, cloud, enabled: true });

    await router.generateAsync('привет', { model: 'gpt-4o-mini' });

    const localSignal = local.generateAsync.mock.calls[0][1].signal;
    const cloudSignal = cloud.generateAsync.mock.calls[0][1].signal;

    expect(localSignal).toBeInstanceOf(AbortSignal);
    expect(cloudSignal).toBeInstanceOf(AbortSignal);
    // Разные signal'ы: истёкший таймаут локальной попытки не отменяет fallback.
    expect(cloudSignal).not.toBe(localSignal);
    expect(cloudSignal?.aborted).toBe(false);
  });

  it('отмена пользователя не приводит к fallback', async () => {
    const controller = new AbortController();
    const local = stubProvider({
      name: 'lmstudio',
      models: ['qwen-local'],
      isLocal: true,
      generateAsync: () => {
        controller.abort();

        return Promise.reject(new LlmProviderException('lmstudio', 'aborted'));
      },
    });
    const cloud = stubProvider({ name: 'openai', models: ['gpt-4o-mini'] });
    const { router } = await createRouter({ local, cloud, enabled: true });

    await expect(
      router.generateAsync('привет', {
        model: 'gpt-4o-mini',
        signal: controller.signal,
      }),
    ).rejects.toThrow(LlmProviderException);

    expect(cloud.generateAsync).not.toHaveBeenCalled();
  });

  it('при LLM_ROUTER_ENABLED=false провайдер получает таймаут (RULES 4.19)', async () => {
    const cloud = stubProvider({ name: 'openai', models: ['gpt-4o-mini'] });
    const { router } = await createRouter({ cloud, enabled: false });

    await router.generateAsync('привет', { model: 'gpt-4o-mini' });

    expect(cloud.generateAsync.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  describe('сверка возможностей при подмене (v1.3 S1, KI-617)', () => {
    /** Паспорт vision-модели с большим контекстом. */
    const VISION: Partial<ModelInfo> = {
      inputModalities: ['text', 'vision'],
      supportsTools: true,
      maxTokens: 128_000,
    };

    it('vision-модель не уходит в текстовую локальную: используется исходная облачная', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const local = stubProvider({
        name: 'lmstudio',
        models: ['qwen-text'],
        isLocal: true,
      });
      const cloud = stubProvider({
        name: 'openai',
        models: ['gpt-4o'],
        modelOverrides: VISION,
      });
      const { router } = await createRouter({ local, cloud, enabled: true });

      const result = await router.generateAsync('привет', { model: 'gpt-4o' });

      expect(result.isLocal).toBe(false);
      expect(local.generateAsync).not.toHaveBeenCalled();
      // KI-617: исходная модель пользователя не теряется — fallback идёт в неё.
      expect(cloud.generateAsync.mock.calls[0][1].model).toBe('gpt-4o');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('нет модели, совместимой'),
      );
    });

    it('vision-модель и совместимая локальная: вызов идёт локально с подменой модели', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const local = stubProvider({
        name: 'lmstudio',
        models: ['qwen-vision'],
        isLocal: true,
        modelOverrides: VISION,
        generateAsync: () => Promise.resolve(answer('локальный ответ', 'qwen-vision')),
      });
      const cloud = stubProvider({
        name: 'openai',
        models: ['gpt-4o'],
        modelOverrides: VISION,
      });
      const { router } = await createRouter({ local, cloud, enabled: true });

      const result = await router.generateAsync('привет', { model: 'gpt-4o' });

      expect(result.isLocal).toBe(true);
      expect(result.text).toBe('локальный ответ');
      expect(local.generateAsync.mock.calls[0][1].model).toBe('qwen-vision');
      expect(cloud.generateAsync).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('не объявлена — использую "qwen-vision"'),
      );
    });

    it('fallback-модель несовместима: берётся первая совместимая облачная + WARN', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const local = stubProvider({
        name: 'lmstudio',
        models: ['qwen-vision'],
        isLocal: true,
        modelOverrides: VISION,
        generateAsync: () =>
          Promise.reject(new LlmProviderException('lmstudio', 'сервер лёг')),
      });
      const cloudText = stubProvider({ name: 'deepseek', models: ['deepseek-chat'] });
      const cloudVision = stubProvider({
        name: 'openai',
        models: ['gpt-4o'],
        modelOverrides: VISION,
      });
      const { router } = await createRouter({
        local,
        cloud: cloudText,
        extraClouds: [cloudVision],
        enabled: true,
        fallbackModel: 'deepseek-chat',
      });

      const result = await router.generateAsync('привет', { model: 'qwen-vision' });

      expect(result.isLocal).toBe(false);
      expect(cloudText.generateAsync).not.toHaveBeenCalled();
      expect(cloudVision.generateAsync.mock.calls[0][1].model).toBe('gpt-4o');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('несовместима'));
      expect(warn.mock.calls.flat().join(' ')).toContain('нет модальности vision');
    });

    it('совместимой облачной модели нет: LlmProviderException с понятным текстом', async () => {
      const local = stubProvider({
        name: 'lmstudio',
        models: ['qwen-vision'],
        isLocal: true,
        modelOverrides: VISION,
        generateAsync: () =>
          Promise.reject(new LlmProviderException('lmstudio', 'сервер лёг')),
      });
      const cloud = stubProvider({ name: 'deepseek', models: ['deepseek-chat'] });
      const { router } = await createRouter({
        local,
        cloud,
        enabled: true,
        fallbackModel: 'deepseek-chat',
      });

      await expect(
        router.generateAsync('привет', { model: 'qwen-vision' }),
      ).rejects.toThrow(/нет облачной модели, совместимой/);
      expect(cloud.generateAsync).not.toHaveBeenCalled();
    });

    it('reasoning исходной модели: локальная без reasoning пропускается', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const local = stubProvider({
        name: 'lmstudio',
        models: ['qwen-text'],
        isLocal: true,
      });
      const cloud = stubProvider({
        name: 'openai',
        models: ['reasoning-model'],
        modelOverrides: { supportsReasoning: true },
      });
      const { router } = await createRouter({ local, cloud, enabled: true });

      const result = await router.generateAsync('привет', {
        model: 'reasoning-model',
      });

      expect(result.isLocal).toBe(false);
      expect(local.generateAsync).not.toHaveBeenCalled();
      expect(cloud.generateAsync.mock.calls[0][1].model).toBe('reasoning-model');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('нет модели, совместимой'),
      );
    });

    it('requiresTools: модель без tool-calling не выбирается, берётся подходящая', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const local = stubProvider({
        name: 'lmstudio',
        models: ['qwen-no-tools'],
        isLocal: true,
        modelOverrides: { supportsTools: false },
      });
      const cloudNoTools = stubProvider({
        name: 'deepseek',
        models: ['deepseek-reasoner'],
        modelOverrides: { supportsTools: false },
      });
      const cloudTools = stubProvider({
        name: 'openai',
        models: ['gpt-4o'],
        modelOverrides: { supportsTools: true },
      });
      const { router } = await createRouter({
        local,
        cloud: cloudNoTools,
        extraClouds: [cloudTools],
        enabled: true,
        fallbackModel: 'deepseek-reasoner',
      });

      await router.generateAsync('привет', {
        model: 'deepseek-reasoner',
        requiresTools: true,
      });

      expect(local.generateAsync).not.toHaveBeenCalled();
      expect(cloudNoTools.generateAsync).not.toHaveBeenCalled();
      expect(cloudTools.generateAsync.mock.calls[0][1].model).toBe('gpt-4o');
      expect(warn.mock.calls.flat().join(' ')).toContain('нет tool-calling');
    });

    it('контекст кандидата меньше исходного: локальная модель пропускается', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const local = stubProvider({
        name: 'lmstudio',
        models: ['small-local'],
        isLocal: true,
        modelOverrides: { maxTokens: 8_192 },
      });
      const cloud = stubProvider({
        name: 'openai',
        models: ['gpt-4o'],
        modelOverrides: { maxTokens: 128_000 },
      });
      const { router } = await createRouter({ local, cloud, enabled: true });

      const result = await router.generateAsync('привет', { model: 'gpt-4o' });

      expect(result.isLocal).toBe(false);
      expect(local.generateAsync).not.toHaveBeenCalled();
      expect(warn.mock.calls.flat().join(' ')).toContain('контекст');
    });
  });

  describe('isEnabled (v1.2.0 S3, KI-618)', () => {
    it('true, если LLM_ROUTER_ENABLED=true', async () => {
      const { router } = await createRouter({ enabled: true });

      expect(router.isEnabled()).toBe(true);
    });

    it('false, если LLM_ROUTER_ENABLED=false', async () => {
      const { router } = await createRouter({ enabled: false });

      expect(router.isEnabled()).toBe(false);
    });

    it('false, если переменная не задана (дефолт — роутер выключен)', async () => {
      // `readBooleanFlag` при отсутствии значения отдаёт fallback=false, а не
      // `true` (RULES 4.35: 'false' не должен становиться true).
      const { router } = await createRouter({});

      expect(router.isEnabled()).toBe(false);
    });
  });
});
