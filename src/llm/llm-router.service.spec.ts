import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  LlmProviderException,
  type ILlmProvider,
  type LlmGenerateOptions,
  type LlmGenerateResult,
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
  /** Значение `LLM_ROUTER_ENABLED`. */
  enabled?: boolean;
  /** Значение `LLM_ROUTER_FALLBACK_MODEL`. */
  fallbackModel?: string;
  /** Есть ли healthcheck и что он отвечает. */
  health?: { available: boolean } | null;
}

/**
 * Собирает роутер с фейковым реестром и (опционально) healthcheck'ом.
 *
 * @param setup - локальный/облачный провайдеры и флаги
 * @returns роутер и шпионы зависимостей
 */
async function createRouter(setup: RouterSetup): Promise<{
  router: LlmRouterService;
  registry: {
    resolveByModel: ReturnType<typeof vi.fn>;
    hasModel: ReturnType<typeof vi.fn>;
    findLocalProvider: ReturnType<typeof vi.fn>;
    findCloudProvider: ReturnType<typeof vi.fn>;
  };
  health: { isAvailableAsync: ReturnType<typeof vi.fn> } | null;
}> {
  const providers = [setup.local, setup.cloud].filter(
    (provider): provider is ILlmProvider => provider !== undefined,
  );
  const registry = {
    resolveByModel: vi.fn((modelId: string) => {
      const provider = providers.find((candidate) =>
        candidate.models.some((model) => model.id === modelId),
      );

      if (provider === undefined) {
        throw new LlmProviderException('registry', `Модель не поддерживается: ${modelId}`);
      }

      return provider;
    }),
    hasModel: vi.fn((modelId: string) =>
      providers.some((candidate) =>
        candidate.models.some((model) => model.id === modelId),
      ),
    ),
    findLocalProvider: vi.fn(() => setup.local),
    findCloudProvider: vi.fn(() => setup.cloud),
  };
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

  return { router: moduleRef.get(LlmRouterService), registry, health };
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
    // Выбранная в графе облачная модель локально не объявлена — уходит
    // первая локальная (KI-617).
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
      expect.stringContaining('не поддерживается'),
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
