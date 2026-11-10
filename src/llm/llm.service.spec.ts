import { Test } from '@nestjs/testing';
import {
  LlmProviderException,
  type LlmGenerateOptions,
  type LlmGenerateResult,
} from './llm-provider.interface.js';
import { LlmResponseCacheService } from './llm-response-cache.service.js';
import { LlmRouterService } from './llm-router.service.js';
import { LlmService } from './llm.service.js';

describe('LlmService', () => {
  let service: LlmService;
  let routerGenerateAsync: ReturnType<
    typeof vi.fn<(prompt: string, options: LlmGenerateOptions) => Promise<LlmGenerateResult>>
  >;

  beforeEach(async () => {
    routerGenerateAsync = vi.fn(
      (_prompt: string, _options: LlmGenerateOptions) =>
        Promise.resolve({
          text: 'ответ роутера',
          usage: { inputTokens: 3, outputTokens: 2, model: 'fake-model' },
          isLocal: false,
        }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        LlmService,
        {
          provide: LlmRouterService,
          useValue: { generateAsync: routerGenerateAsync },
        },
      ],
    }).compile();

    service = moduleRef.get(LlmService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('делегирует вызов роутеру и пробрасывает результат наверх (KI-038)', async () => {
    await expect(service.generateAsync('привет', 'fake-model')).resolves.toEqual({
      text: 'ответ роутера',
      usage: { inputTokens: 3, outputTokens: 2, model: 'fake-model' },
      isLocal: false,
    });

    expect(routerGenerateAsync).toHaveBeenCalledTimes(1);

    const [prompt, options] = routerGenerateAsync.mock.calls[0];

    expect(prompt).toBe('привет');
    expect(options.model).toBe('fake-model');
  });

  it('передаёт модель в options, даже если её попытались переопределить (v1.2 S1)', async () => {
    // Тип `Omit<LlmGenerateOptions, 'model'>` защищает на этапе компиляции, но
    // runtime-объект из JS-кода может содержать лишнее поле: model из
    // аргумента должен победить.
    await service.generateAsync('привет', 'fake-model', {
      ...({ model: 'подмена' } as Record<string, unknown>),
    } as Omit<LlmGenerateOptions, 'model'>);

    expect(routerGenerateAsync.mock.calls[0][1].model).toBe('fake-model');
  });

  it('пробрасывает usage: null, если провайдер не отдал метрики (KI-038)', async () => {
    routerGenerateAsync.mockResolvedValue({ text: 'без метрик', usage: null });

    await expect(service.generateAsync('привет', 'fake-model')).resolves.toEqual({
      text: 'без метрик',
      usage: null,
    });
  });

  it('сохраняет isLocal от роутера (KI-148, v1.2 S1)', async () => {
    routerGenerateAsync.mockResolvedValue({
      text: 'локальный ответ',
      usage: { inputTokens: 3, outputTokens: 2, model: 'qwen2.5-7b-instruct' },
      isLocal: true,
    });

    await expect(service.generateAsync('привет', 'gpt-4o-mini')).resolves.toEqual({
      text: 'локальный ответ',
      usage: { inputTokens: 3, outputTokens: 2, model: 'qwen2.5-7b-instruct' },
      isLocal: true,
    });
  });

  it('пробрасывает LlmProviderException от роутера, не гася стек', async () => {
    const failure = new LlmProviderException('fake', 'провайдер упал');

    routerGenerateAsync.mockRejectedValue(failure);

    await expect(service.generateAsync('привет', 'fake-model')).rejects.toBe(failure);
  });

  it('передаёт system и signal из options', async () => {
    const controller = new AbortController();

    await service.generateAsync('привет', 'fake-model', {
      system: 'ты кот',
      signal: controller.signal,
    });

    const [, options] = routerGenerateAsync.mock.calls[0];

    expect(options.system).toBe('ты кот');
    expect(options.signal).toBe(controller.signal);
  });

  describe('response cache (S8, FinOps)', () => {
    /** Собирает LlmService с подставным кэшем. */
    function serviceWithCache(cache: {
      isEnabled: () => boolean;
      buildKey: ReturnType<typeof vi.fn>;
      getAsync: ReturnType<typeof vi.fn>;
      setAsync: ReturnType<typeof vi.fn>;
    }): LlmService {
      return new LlmService(
        { generateAsync: routerGenerateAsync } as unknown as LlmRouterService,
        cache as unknown as LlmResponseCacheService,
      );
    }

    it('при попадании возвращает сохранённый ответ с cached: true и не зовёт роутер', async () => {
      const cache = {
        isEnabled: () => true,
        buildKey: vi.fn(() => 'cache-key'),
        getAsync: vi.fn(() => Promise.resolve({ text: 'из кэша', usage: null })),
        setAsync: vi.fn(() => Promise.resolve()),
      };

      const result = await serviceWithCache(cache).generateAsync(
        'привет',
        'fake-model',
        { orgId: 'org-1' },
      );

      expect(result).toEqual({ text: 'из кэша', usage: null, cached: true });
      expect(cache.getAsync).toHaveBeenCalledWith('cache-key');
      expect(routerGenerateAsync).not.toHaveBeenCalled();
      expect(cache.setAsync).not.toHaveBeenCalled();
    });

    it('при промахе вызывает провайдера и сохраняет ответ', async () => {
      const cache = {
        isEnabled: () => true,
        buildKey: vi.fn(() => 'cache-key'),
        getAsync: vi.fn(() => Promise.resolve(null)),
        setAsync: vi.fn(() => Promise.resolve()),
      };

      const result = await serviceWithCache(cache).generateAsync(
        'привет',
        'fake-model',
        { orgId: 'org-1' },
      );

      expect(routerGenerateAsync).toHaveBeenCalledTimes(1);
      expect(cache.setAsync).toHaveBeenCalledWith('cache-key', result);
      expect(result).not.toHaveProperty('cached');
    });

    it('при LLM_CACHE_ENABLED=false не обращается к кэшу', async () => {
      const cache = {
        isEnabled: () => false,
        buildKey: vi.fn(),
        getAsync: vi.fn(),
        setAsync: vi.fn(),
      };

      await serviceWithCache(cache).generateAsync('привет', 'fake-model', {
        orgId: 'org-1',
      });

      expect(cache.getAsync).not.toHaveBeenCalled();
      expect(cache.setAsync).not.toHaveBeenCalled();
      expect(routerGenerateAsync).toHaveBeenCalledTimes(1);
    });

    it('без orgId кэш не используется (tenant-изоляция)', async () => {
      const cache = {
        isEnabled: () => true,
        buildKey: vi.fn(),
        getAsync: vi.fn(),
        setAsync: vi.fn(),
      };

      await serviceWithCache(cache).generateAsync('привет', 'fake-model');

      expect(cache.getAsync).not.toHaveBeenCalled();
      expect(routerGenerateAsync).toHaveBeenCalledTimes(1);
    });
  });
});
