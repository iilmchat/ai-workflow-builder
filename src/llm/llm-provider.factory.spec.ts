import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LlmProviderFactory,
  resolveRouterAiEmbeddingModel,
} from './llm-provider.factory.js';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider.js';

const { openAiConstructorMock, embedMock } = vi.hoisted(() => ({
  openAiConstructorMock: vi.fn(),
  embedMock: vi.fn(),
}));

// Конструкторы провайдеров создают клиенты SDK. В юнит-тестах сеть не нужна,
// поэтому оба SDK подменены заглушками (RULES: никаких сетевых вызовов).
// Опции конструктора OpenAI запоминаем, чтобы проверить выбор baseURL, а
// `embeddings.create` — чтобы проверить KI-406 (RouterAI-префикс).
vi.mock('openai', () => ({
  default: class MockOpenAI {
    readonly chat = { completions: { create: vi.fn() } };
    readonly embeddings = { create: embedMock };

    constructor(options: unknown) {
      openAiConstructorMock(options);
    }
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    readonly messages = { create: vi.fn() };

    constructor() {
      // См. выше.
    }
  },
}));

/**
 * Создаёт заглушку `ConfigService` с заданными значениями.
 *
 * @param values - карта «имя переменной → значение»
 * @returns заглушка ConfigService
 */
function configStub(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/**
 * Собирает фабрику на заданном окружении и возвращает созданных провайдеров.
 *
 * @param values - переменные окружения
 * @returns провайдеры в порядке приоритета
 */
async function createProviders(values: Record<string, string | undefined>) {
  return new LlmProviderFactory(configStub(values)).createProvidersAsync();
}

/**
 * Возвращает OpenAI-совместимого провайдера с нужным именем.
 *
 * @param values - переменные окружения
 * @param name - идентификатор провайдера
 * @returns провайдер или `undefined`
 */
async function byName(
  values: Record<string, string | undefined>,
  name: string,
): Promise<OpenAiCompatibleProvider | undefined> {
  const provider = (await createProviders(values)).find((item) => item.name === name);

  return provider instanceof OpenAiCompatibleProvider ? provider : undefined;
}

/**
 * Подменяет GET /models у LM Studio: фабрика запрашивает каталог при старте
 * (KI-088), а в юнит-тестах сеть недопустима. По умолчанию сервер «недоступен».
 *
 * @param ids - id моделей, которые вернёт сервер; пустой массив — «нет ответа»
 */
function stubLmStudioApi(ids: string[] | null): void {
  if (ids === null) {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));

    return;
  }

  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ data: ids.map((id) => ({ id })) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    ),
  );
}

describe('LlmProviderFactory', () => {
  beforeEach(() => {
    // По умолчанию LM Studio «не запущен»: фабрика не должна ждать сеть.
    stubLmStudioApi(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });
  it('возвращает пустой список, если не задан ни один ключ', async () => {
    await expect(createProviders({})).resolves.toEqual([]);
  });

  it('включает только Anthropic, когда задан только его ключ', async () => {
    const providers = await createProviders({ ANTHROPIC_API_KEY: 'sk-ant-test' });

    expect(providers.map((provider) => provider.name)).toEqual(['anthropic']);
  });

  it('объявляет у Anthropic модели с text+vision на входе (v0.6.0a)', async () => {
    const [anthropic] = await createProviders({ ANTHROPIC_API_KEY: 'sk-ant-test' });

    expect(anthropic.models).toEqual([
      {
        id: 'claude-opus-4-20250514',
        label: 'Claude Opus 4',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
      {
        id: 'claude-sonnet-4-20250514',
        label: 'Claude Sonnet 4',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
    ]);
  });

  it('создаёт OpenAI-провайдера с ключом и дефолтным baseURL', async () => {
    const openai = await byName({ OPENAI_API_KEY: 'sk-test' }, 'openai');

    expect(openai?.name).toBe('openai');
    expect(openai?.models).toEqual([
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
    ]);
    expect(openai?.isConfigured).toBe(true);
  });

  it('работает с OpenAI и RouterAI одновременно (v0.5.0)', async () => {
    const providers = await createProviders({
      OPENAI_API_KEY: 'sk-test',
      ROUTERAI_API_KEY: 'sk-router',
    });

    expect(providers.map((provider) => provider.name)).toEqual(['openai', 'routerai']);

    const routerai = await byName({ ROUTERAI_API_KEY: 'sk-router' }, 'routerai');

    expect(routerai?.models.map((model) => model.id)).toContain(
      'anthropic/claude-sonnet-4',
    );
  });

  describe('KI-406: embedding-модель RouterAI', () => {
    beforeEach(() => {
      embedMock.mockResolvedValue({ data: [{ index: 0, embedding: [1, 2] }] });
    });

    it('bare-имя получает префикс openai/ (RouterAI отвергает без него 400)', async () => {
      const routerai = await byName({ ROUTERAI_API_KEY: 'sk-router' }, 'routerai');

      await routerai?.embedAsync(['текст']);

      // Дефолт узла — `text-embedding-3-small`, но upstream ждёт openai/.
      expect(embedMock.mock.calls[0][0].model).toBe(
        'openai/text-embedding-3-small',
      );
    });

    it('явный провайдерский префикс не дублируется', async () => {
      const routerai = await byName({ ROUTERAI_API_KEY: 'sk-router' }, 'routerai');

      await routerai?.embedAsync(['текст'], {
        model: 'openai/text-embedding-3-large',
      });

      expect(embedMock.mock.calls[0][0].model).toBe(
        'openai/text-embedding-3-large',
      );
    });

    it('OpenAI не получает RouterAI-префикс', async () => {
      const openai = await byName({ OPENAI_API_KEY: 'sk-test' }, 'openai');

      await openai?.embedAsync(['текст']);

      expect(embedMock.mock.calls[0][0].model).toBe('text-embedding-3-small');
    });

    it('resolveRouterAiEmbeddingModel: bare/префикс/пробелы', () => {
      expect(resolveRouterAiEmbeddingModel('text-embedding-3-small')).toBe(
        'openai/text-embedding-3-small',
      );
      expect(resolveRouterAiEmbeddingModel('openai/text-embedding-3-small')).toBe(
        'openai/text-embedding-3-small',
      );
      // Пробелы из `node.data` не должны превращаться в `openai/  ...`.
      expect(resolveRouterAiEmbeddingModel('  text-embedding-3-small  ')).toBe(
        'openai/text-embedding-3-small',
      );
      // Пустое значение остаётся пустым: префиксовать нечего. Такой id не
      // должен доходить сюда — схемы узлов требуют непустую модель, — но
      // превращать мусор в `openai/` тоже нельзя.
      expect(resolveRouterAiEmbeddingModel('   ')).toBe('');
    });
  });

  it('включает LM Studio без ключа, если задан список моделей', async () => {
    const lmstudio = await byName(
      { LMSTUDIO_MODELS: 'qwen2.5-7b-instruct, llama-3.3-70b' },
      'lmstudio',
    );

    expect(lmstudio?.isConfigured).toBe(true);
    // KI-148: LM Studio крутится локально, стоимость вызова считается нулевой.
    expect(lmstudio?.isLocal).toBe(true);
    // Без суффикса модальностей модель считается текстовой (v0.6.0a).
    expect(lmstudio?.models).toEqual([
      {
        id: 'qwen2.5-7b-instruct',
        label: 'qwen2.5-7b-instruct (local)',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
      {
        id: 'llama-3.3-70b',
        label: 'llama-3.3-70b (local)',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
    ]);
  });

  it('KI-148: облачные провайдеры не помечены локальными', async () => {
    // Только LM Studio бесплатен: у остальных стоимость считается по прайсу.
    const openai = await byName({ OPENAI_API_KEY: 'sk-openai' }, 'openai');
    const deepseek = await byName({ DEEPSEEK_API_KEY: 'sk-deepseek' }, 'deepseek');
    const anthropic = await byName({ ANTHROPIC_API_KEY: 'sk-ant-test' }, 'anthropic');

    expect(openai?.isLocal).toBe(false);
    expect(deepseek?.isLocal).toBe(false);
    // Anthropic флаг вовсе не задаёт — «не локальный» по умолчанию.
    expect(anthropic?.isLocal).toBeUndefined();
  });

  it('разбирает модальности LM Studio из суффикса (v0.6.0a)', async () => {
    const lmstudio = await byName(
      {
        LMSTUDIO_MODELS:
          'qwen2.5-coder-7b-instruct:text,qwen/qwen2.5-vl-7b:text+vision',
      },
      'lmstudio',
    );

    expect(lmstudio?.models).toEqual([
      {
        id: 'qwen2.5-coder-7b-instruct',
        label: 'qwen2.5-coder-7b-instruct (local)',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
      {
        id: 'qwen/qwen2.5-vl-7b',
        label: 'qwen/qwen2.5-vl-7b (local)',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
    ]);
  });

  it('KI-088: без LMSTUDIO_MODELS каталог берётся из GET /models', async () => {
    stubLmStudioApi(['qwen/qwen2.5-coder-7b-instruct', 'qwen/qwen3-8b']);

    const lmstudio = await byName({}, 'lmstudio');

    // Все найденные модели — текстовые по умолчанию.
    expect(lmstudio?.models).toEqual([
      {
        id: 'qwen/qwen2.5-coder-7b-instruct',
        label: 'qwen/qwen2.5-coder-7b-instruct (local)',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
      {
        id: 'qwen/qwen3-8b',
        label: 'qwen/qwen3-8b (local)',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
    ]);
  });

  it('KI-088: env-модальности сохраняются, найденные модели добавляются', async () => {
    stubLmStudioApi(['qwen/qwen2.5-vl-7b', 'qwen/qwen3-8b']);

    const lmstudio = await byName(
      { LMSTUDIO_MODELS: 'qwen/qwen2.5-vl-7b:text+vision' },
      'lmstudio',
    );

    // env-запись идёт первой и со своими модальностями, остальное — из API.
    expect(lmstudio?.models).toEqual([
      {
        id: 'qwen/qwen2.5-vl-7b',
        label: 'qwen/qwen2.5-vl-7b (local)',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
      {
        id: 'qwen/qwen3-8b',
        label: 'qwen/qwen3-8b (local)',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
    ]);
  });

  it('KI-088: модель из env, которой нет в API, остаётся с предупреждением', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    stubLmStudioApi(['qwen/qwen3-8b']);

    const lmstudio = await byName(
      { LMSTUDIO_MODELS: 'my-custom-model:text' },
      'lmstudio',
    );

    expect(lmstudio?.models.map((model) => model.id)).toEqual([
      'my-custom-model',
      'qwen/qwen3-8b',
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('my-custom-model'),
    );
  });

  it('KI-088: недоступный LM Studio не мешает старту — работает env', async () => {
    stubLmStudioApi(null);

    const lmstudio = await byName(
      { LMSTUDIO_MODELS: 'qwen2.5-coder-7b-instruct:text' },
      'lmstudio',
    );

    expect(lmstudio?.models.map((model) => model.id)).toEqual([
      'qwen2.5-coder-7b-instruct',
    ]);
  });

  it('пропускает модель LM Studio с неизвестной модальностью (v0.6.0a)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const lmstudio = await byName(
      { LMSTUDIO_MODELS: 'good-model:text,broken-model:foo' },
      'lmstudio',
    );

    // Невалидная запись пропускается, валидная остаётся: опечатка в env
    // не должна оставлять пользователя без провайдера целиком.
    expect(lmstudio?.models.map((model) => model.id)).toEqual(['good-model']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('broken-model неизвестная модальность "foo"'),
    );

    warn.mockRestore();
  });

  it('не включает LM Studio без списка моделей', async () => {
    await expect(createProviders({ LMSTUDIO_MODELS: '' })).resolves.toEqual([]);
    await expect(createProviders({ LMSTUDIO_MODELS: '  ,  ' })).resolves.toEqual([]);
  });

  it('собирает всех провайдеров в порядке приоритета', async () => {
    const providers = await createProviders({
      ANTHROPIC_API_KEY: 'sk-ant',
      OPENAI_API_KEY: 'sk-openai',
      ROUTERAI_API_KEY: 'sk-router',
      DEEPSEEK_API_KEY: 'sk-deepseek',
      YANDEX_API_KEY: 'sk-yandex',
      YANDEX_FOLDER_ID: 'b1g-folder',
      LMSTUDIO_MODELS: 'qwen2.5-7b-instruct',
    });

    expect(providers.map((provider) => provider.name)).toEqual([
      'anthropic',
      'openai',
      'routerai',
      'deepseek',
      'yandex',
      'lmstudio',
    ]);
  });

  it('берёт baseURL провайдера из его переменной окружения', async () => {
    await byName(
      {
        DEEPSEEK_API_KEY: 'sk-deepseek',
        DEEPSEEK_BASE_URL: 'http://localhost:9999/v1',
      },
      'deepseek',
    );

    expect(openAiConstructorMock).toHaveBeenCalledWith({
      apiKey: 'sk-deepseek',
      baseURL: 'http://localhost:9999/v1',
    });
  });

  it('подставляет дефолтный baseURL, если переменная не задана', async () => {
    await byName({ ROUTERAI_API_KEY: 'sk-router' }, 'routerai');

    expect(openAiConstructorMock).toHaveBeenCalledWith({
      apiKey: 'sk-router',
      baseURL: 'https://routerai.ru/api/v1',
    });
  });

  it('KI-174: YANDEX_MODELS задаёт каталог, короткие id достраиваются в URI', async () => {
    const yandex = await byName(
      {
        YANDEX_API_KEY: 'sk-yandex',
        YANDEX_FOLDER_ID: 'b1g-folder',
        YANDEX_MODELS: 'yandexgpt-lite:text,yandexgpt-32k',
      },
      'yandex',
    );

    expect(yandex?.models).toEqual([
      {
        id: 'gpt://b1g-folder/yandexgpt-lite/latest',
        label: 'yandexgpt-lite (Yandex)',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
      {
        // Без суффикса модальностей — текстовая (как у LM Studio/GPTunnel).
        id: 'gpt://b1g-folder/yandexgpt-32k/latest',
        label: 'yandexgpt-32k (Yandex)',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
    ]);
  });

  it('KI-174: полный URI проходит как есть, префикс не дублируется', async () => {
    const yandex = await byName(
      {
        YANDEX_API_KEY: 'sk-yandex',
        YANDEX_FOLDER_ID: 'b1g-folder',
        YANDEX_MODELS:
          'gpt://b1gufspraeh2i5nin6nt/qwen3.6-35b-a3b/latest:text+vision',
      },
      'yandex',
    );

    // Ключевой случай: ':' внутри 'gpt://' не должен съесть модальности.
    expect(yandex?.models).toEqual([
      {
        id: 'gpt://b1gufspraeh2i5nin6nt/qwen3.6-35b-a3b/latest',
        label: 'gpt://b1gufspraeh2i5nin6nt/qwen3.6-35b-a3b/latest (Yandex)',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
    ]);
  });

  it('KI-174: без YANDEX_FOLDER_ID короткие id пропускаются, URI работают', async () => {
    const yandex = await byName(
      {
        YANDEX_API_KEY: 'sk-yandex',
        YANDEX_MODELS:
          'yandexgpt-lite,gpt://b1g-folder/yandexgpt/latest:text',
      },
      'yandex',
    );

    expect(yandex?.models.map((model) => model.id)).toEqual([
      'gpt://b1g-folder/yandexgpt/latest',
    ]);
  });

  it('KI-174: имя с версией получает префикс, но не вторую версию', async () => {
    const yandex = await byName(
      {
        YANDEX_API_KEY: 'sk-yandex',
        YANDEX_FOLDER_ID: 'b1g-folder',
        YANDEX_MODELS: 'yandexgpt-lite/latest:text,yandexgpt-32k/rc',
      },
      'yandex',
    );

    // 'yandexgpt-lite/latest' — уже имя+версия: '/latest' не дублируется.
    expect(yandex?.models.map((model) => model.id)).toEqual([
      'gpt://b1g-folder/yandexgpt-lite/latest',
      'gpt://b1g-folder/yandexgpt-32k/rc',
    ]);
  });

  it('KI-174: пустой YANDEX_MODELS без folder_id — провайдера нет', async () => {
    const yandex = await byName(
      { YANDEX_API_KEY: 'sk-yandex', YANDEX_MODELS: '   ' },
      'yandex',
    );

    expect(yandex).toBeUndefined();
  });

  it('включает Yandex с ключом и folder_id (KI-159)', async () => {
    const yandex = await byName(
      { YANDEX_API_KEY: 'sk-yandex', YANDEX_FOLDER_ID: 'b1g-folder' },
      'yandex',
    );

    // KI-174: без YANDEX_MODELS используется дефолт (yandexgpt-lite + yandexgpt),
    // а id хранится уже как полный URI, который уходит и в upstream, и в UI.
    expect(yandex?.models).toEqual([
      {
        id: 'gpt://b1g-folder/yandexgpt-lite/latest',
        label: 'yandexgpt-lite (Yandex)',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
      {
        id: 'gpt://b1g-folder/yandexgpt/latest',
        label: 'yandexgpt (Yandex)',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
    ]);
  });

  it('KI-159: без YANDEX_FOLDER_ID провайдер не включается (graceful degradation)', async () => {
    // Без folder_id URI модели собрать нечем — лучше не показывать провайдера,
    // чем падать с 400 во время Run.
    const yandex = await byName({ YANDEX_API_KEY: 'sk-yandex' }, 'yandex');

    expect(yandex).toBeUndefined();
  });

  it('включает GPTunnel с ключом и списком моделей (v0.6.0b.1)', async () => {
    const gptunnel = await byName(
      {
        GPTUNNEL_API_KEY: 'sk-gptunnel',
        GPTUNNEL_MODELS:
          'claude-5.5-sonnet:text+vision,gpt-5.6-luna:text,deepseek-v4-flash',
      },
      'gptunnel',
    );

    expect(gptunnel?.isConfigured).toBe(true);
    // Подпись без суффикса: провайдер и так виден в UI отдельной группой.
    expect(gptunnel?.models).toEqual([
      {
        id: 'claude-5.5-sonnet',
        label: 'claude-5.5-sonnet',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
      {
        id: 'gpt-5.6-luna',
        label: 'gpt-5.6-luna',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
      {
        id: 'deepseek-v4-flash',
        label: 'deepseek-v4-flash',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
    ]);
  });

  it('не включает GPTunnel без списка моделей (v0.6.0b.1)', async () => {
    await expect(createProviders({ GPTUNNEL_API_KEY: 'sk-gptunnel' })).resolves.toEqual([]);
    await expect(
      createProviders({ GPTUNNEL_API_KEY: 'sk-gptunnel', GPTUNNEL_MODELS: '  ,  ' }),
    ).resolves.toEqual([]);
  });

  it('не включает GPTunnel без ключа, даже если список задан (v0.6.0b.1)', async () => {
    await expect(createProviders({ GPTUNNEL_MODELS: 'gpt-5.6-luna:text' })).resolves.toEqual([]);
  });

  it('берёт baseURL GPTunnel из окружения (v0.6.0b.1)', async () => {
    await byName(
      {
        GPTUNNEL_API_KEY: 'sk-gptunnel',
        GPTUNNEL_MODELS: 'gpt-5.6-luna',
        GPTUNNEL_BASE_URL: 'http://localhost:7777/v1',
      },
      'gptunnel',
    );

    expect(openAiConstructorMock).toHaveBeenCalledWith({
      apiKey: 'sk-gptunnel',
      baseURL: 'http://localhost:7777/v1',
    });
  });

  it('пропускает модель GPTunnel с неизвестной модальностью (v0.6.0b.1)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const gptunnel = await byName(
      {
        GPTUNNEL_API_KEY: 'sk-gptunnel',
        GPTUNNEL_MODELS: 'gpt-5.6-luna:text,broken-model:foo',
      },
      'gptunnel',
    );

    expect(gptunnel?.models.map((model) => model.id)).toEqual(['gpt-5.6-luna']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('GPTUNNEL_MODELS: у модели broken-model неизвестная модальность "foo"'),
    );

    warn.mockRestore();
  });

  it('работает с GPTunnel и RouterAI одновременно (v0.6.0b.1)', async () => {
    const providers = await createProviders({
      ROUTERAI_API_KEY: 'sk-router',
      GPTUNNEL_API_KEY: 'sk-gptunnel',
      GPTUNNEL_MODELS: 'gpt-5.6-luna:text',
    });

    expect(providers.map((provider) => provider.name)).toEqual([
      'routerai',
      'gptunnel',
    ]);
  });

  it('ставит GPTunnel в приоритете после RouterAI (v0.6.0b.1)', async () => {
    const providers = await createProviders({
      ANTHROPIC_API_KEY: 'sk-ant',
      OPENAI_API_KEY: 'sk-openai',
      ROUTERAI_API_KEY: 'sk-router',
      GPTUNNEL_API_KEY: 'sk-gptunnel',
      GPTUNNEL_MODELS: 'gpt-5.6-luna:text',
      DEEPSEEK_API_KEY: 'sk-deepseek',
      YANDEX_API_KEY: 'sk-yandex',
      YANDEX_FOLDER_ID: 'b1g-folder',
      LMSTUDIO_MODELS: 'qwen2.5-coder-7b-instruct:text',
    });

    expect(providers.map((provider) => provider.name)).toEqual([
      'anthropic',
      'openai',
      'routerai',
      'gptunnel',
      'deepseek',
      'yandex',
      'lmstudio',
    ]);
  });
});
