import { ConfigService } from '@nestjs/config';
import { MediaProviderException } from '../media-provider.interface.js';
import { OpenAiImagesProvider } from './openai-images.provider.js';

/**
 * Юнит-тесты прямого провайдера OpenAI Images (R7.3, DESIGN v0.9 § 3.3).
 *
 * Проверяется fallback ключа (`OPENAI_IMAGES_API_KEY` → `OPENAI_API_KEY`),
 * сборка запроса к `/v1/images/generations`, разбор `b64_json` в `data:`-URI,
 * обработка ошибок (`retryable`-классы) и `applyToolAsync` через
 * `multipart/form-data` в `/v1/images/edits` (KI-380).
 *
 * Реальный вызов `gpt-image-1` — в `openai-images.integration.spec.ts` (под
 * `skipIf` по ключу).
 */

/** Базовый URL в тесте. */
const BASE_URL = 'https://openai.test/v1';
/** Ключ в тесте (не секрет: значение задаётся здесь же). */
const KEY = 'test-key-images';
/** Ключ идемпотентности в тесте. */
const IDEMPOTENCY_KEY = 'run-1:node-1';
/** Минимальное «изображение» в base64 (не валидный PNG — важна форма ответа). */
const B64 = 'iVBORw0KGgoAAAANSUhEUg==';
/** Ссылка на входное изображение для `applyToolAsync`. */
const INPUT_URL = 'https://cdn.example.com/photo.png';
/** «Байты» скачанного изображения (важна форма multipart-части). */
const IMAGE_BYTES = 'fake-png-bytes';

/**
 * Создаёт заглушку `ConfigService`.
 *
 * @param values - карта «имя переменной → значение»
 * @returns заглушка ConfigService
 */
function configStub(
  values: Record<string, string | number | undefined>,
): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/** Конфигурация с отдельным ключом OpenAI Images. */
const configured: Record<string, string | number> = {
  OPENAI_IMAGES_API_KEY: KEY,
  OPENAI_IMAGES_BASE_URL: BASE_URL,
  MEDIA_USD_RUB_RATE: 10,
};

/** Запись о запросе, ушедшем в upstream. */
interface UpstreamCall {
  /** Метод запроса. */
  method: string;
  /** Полный URL. */
  url: string;
  /** Разобранное JSON-тело (для GET и multipart — `null`). */
  body: Record<string, unknown> | null;
  /** FormData, если тело было multipart. */
  formData: FormData | null;
  /** Заголовок авторизации. */
  authorization: string | null;
}

/** Ответ заглушки. */
interface StubResponse {
  /** Тело, сериализуемое в JSON. */
  body?: unknown;
  /** Сырое тело (например, «байты» скачанного изображения). */
  rawBody?: string;
  /** MIME ответа (по умолчанию `application/json`). */
  contentType?: string;
  /** Дополнительные заголовки ответа. */
  headers?: Record<string, string>;
  /** HTTP-статус. */
  status?: number;
}

/**
 * Подменяет глобальный `fetch` маршрутизатором по подстроке URL.
 *
 * @param routes - пары «подстрока URL → ответ»; элемент без `match` — ответ по
 *   умолчанию
 * @returns список ушедших запросов (в порядке вызовов)
 */
function stubUpstream(
  routes: ReadonlyArray<{ match?: string } & StubResponse>,
): UpstreamCall[] {
  const calls: UpstreamCall[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const headers = new Headers(init?.headers);
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : null;
      const formData =
        typeof FormData !== 'undefined' && init?.body instanceof FormData
          ? init.body
          : null;

      calls.push({
        method: init?.method ?? 'GET',
        url: target,
        body,
        formData,
        authorization: headers.get('authorization'),
      });

      const route =
        routes.find(
          (candidate) =>
            candidate.match !== undefined && target.includes(candidate.match),
        ) ?? routes.find((candidate) => candidate.match === undefined);

      if (!route) {
        return Promise.reject(new Error(`Нет заглушки для ${target}`));
      }

      const responseHeaders = new Headers({
        'Content-Type': route.contentType ?? 'application/json',
      });

      for (const [name, value] of Object.entries(route.headers ?? {})) {
        responseHeaders.set(name, value);
      }

      return Promise.resolve(
        new Response(route.rawBody ?? JSON.stringify(route.body), {
          status: route.status ?? 200,
          headers: responseHeaders,
        }),
      );
    }),
  );

  return calls;
}

/**
 * Создаёт провайдер с заданной конфигурацией.
 *
 * @param values - значения env для ConfigService
 * @returns экземпляр провайдера
 */
function createProvider(
  values: Record<string, string | number | undefined> = configured,
): OpenAiImagesProvider {
  return new OpenAiImagesProvider(configStub(values));
}

/** Ответ `/v1/images/generations` с base64-содержимым. */
const imagesResponse = {
  created: 1_791_923_563,
  data: [{ b64_json: B64, revised_prompt: 'кот в шляпе, акварель' }],
};

describe('OpenAiImagesProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('без ключей не сконфигурирован и бросает при вызове', async () => {
    const provider = createProvider({ OPENAI_IMAGES_BASE_URL: BASE_URL });

    expect(provider.name).toBe('openai_images');
    expect(provider.isConfigured).toBe(false);
    await expect(
      provider.createTaskAsync({
        model: 'gpt-image-1',
        prompt: 'кот',
        params: {},
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).rejects.toThrow('OPENAI_IMAGES_API_KEY');
  });

  it('использует OPENAI_API_KEY как fallback (KI-363)', async () => {
    const provider = createProvider({
      OPENAI_API_KEY: 'test-chat-key',
      OPENAI_IMAGES_BASE_URL: BASE_URL,
    });

    expect(provider.isConfigured).toBe(true);

    const calls = stubUpstream([{ body: { results: [] } }]);
    await provider.listModelsAsync();

    expect(calls[0]?.authorization).toBe('Bearer test-chat-key');
  });

  it('приоритет у OPENAI_IMAGES_API_KEY, если заданы оба ключа', async () => {
    const provider = createProvider({
      ...configured,
      OPENAI_API_KEY: 'test-chat-key',
    });
    const calls = stubUpstream([{ body: { results: [] } }]);

    await provider.listModelsAsync();

    expect(calls[0]?.authorization).toBe(`Bearer ${KEY}`);
  });

  it('listModelsAsync: каталог с префиксом, size-параметром и кэшем', async () => {
    const calls = stubUpstream([{ body: { results: [] } }]);
    const provider = createProvider();

    const models = await provider.listModelsAsync('IMAGE');
    await provider.listModelsAsync('IMAGE');

    const gptImage = models.find(
      (model) => model.id === 'openai_images:gpt-image-1',
    );

    expect(gptImage?.provider).toBe('openai_images');
    expect(gptImage?.code).toBe('gpt-image-1');
    expect(gptImage?.params.map((param) => param.key)).toEqual([
      'size',
      'quality',
    ]);
    // Цена неизвестна (зависит от размера и качества) — 0, без выдуманной ставки.
    expect(gptImage?.price).toBe(0);
    expect(calls.filter((call) => call.url.endsWith('/models'))).toHaveLength(1);
  });

  it('listModelsAsync: 401 от upstream → ошибка без повтора', async () => {
    stubUpstream([
      { match: '/models', body: { error: { message: 'Invalid key' } }, status: 401 },
    ]);
    const provider = createProvider();

    const error = await provider.listModelsAsync().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MediaProviderException);
    expect((error as MediaProviderException).retryable).toBe(false);
    expect((error as Error).message).toContain('Invalid key');
  });

  it('createTaskAsync: POST /images/generations с b64_json и n=1', async () => {
    const calls = stubUpstream([{ body: imagesResponse }]);
    const provider = createProvider();

    const task = await provider.createTaskAsync({
      model: 'openai_images:gpt-image-1',
      prompt: 'кот в шляпе',
      params: { size: '1024x1024', quality: 'high' },
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    const post = calls.find((call) => call.method === 'POST');

    expect(post?.url).toBe(`${BASE_URL}/images/generations`);
    expect(post?.authorization).toBe(`Bearer ${KEY}`);
    // Префикс провайдера снят: в OpenAI уходит `gpt-image-1`.
    expect(post?.body).toEqual({
      size: '1024x1024',
      quality: 'high',
      model: 'gpt-image-1',
      prompt: 'кот в шляпе',
      n: 1,
      response_format: 'b64_json',
    });
    expect(task.status).toBe('done');
    expect(task.taskId).toBe('openai-images:gpt-image-1');
    expect(task.resultUrls).toEqual([`data:image/png;base64,${B64}`]);
    // Цены в ответе нет: `null`, а не выдуманная сумма (KI-048).
    expect(task.costRub).toBeNull();
  });

  it('createTaskAsync: output_format jpeg даёт MIME image/jpeg', async () => {
    stubUpstream([{ body: imagesResponse }]);
    const provider = createProvider();

    const task = await provider.createTaskAsync({
      model: 'gpt-image-1',
      prompt: 'кот',
      params: { output_format: 'jpeg' },
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(task.resultUrls[0]?.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('createTaskAsync: пустой промпт не уходит в upstream', async () => {
    const calls = stubUpstream([{ body: imagesResponse }]);
    const provider = createProvider();

    await expect(
      provider.createTaskAsync({
        model: 'gpt-image-1',
        prompt: '   ',
        params: {},
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).rejects.toThrow('требует промпт');

    expect(calls).toHaveLength(0);
  });

  it('createTaskAsync: 400 → ошибка без повтора, 429 → с повтором', async () => {
    const provider = createProvider();

    stubUpstream([
      {
        match: '/images/generations',
        body: { error: { message: 'Billing hard limit reached' } },
        status: 400,
      },
    ]);
    const bad = await provider
      .createTaskAsync({
        model: 'gpt-image-1',
        prompt: 'кот',
        params: {},
        idempotencyKey: IDEMPOTENCY_KEY,
      })
      .catch((caught: unknown) => caught);

    expect((bad as MediaProviderException).retryable).toBe(false);
    expect((bad as Error).message).toContain('Billing hard limit reached');

    stubUpstream([
      { match: '/images/generations', body: { error: 'slow down' }, status: 429 },
    ]);
    const retryable = await provider
      .createTaskAsync({
        model: 'gpt-image-1',
        prompt: 'кот',
        params: {},
        idempotencyKey: IDEMPOTENCY_KEY,
      })
      .catch((caught: unknown) => caught);

    expect((retryable as MediaProviderException).retryable).toBe(true);
  });

  it('createTaskAsync: ответ без изображений → ошибка, а не пустой результат', async () => {
    stubUpstream([{ body: { created: 1, data: [] } }]);
    const provider = createProvider();

    await expect(
      provider.createTaskAsync({
        model: 'gpt-image-1',
        prompt: 'кот',
        params: {},
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).rejects.toThrow('не вернул ни одного изображения');
  });

  it('createTaskAsync: идемпотентность — повтор не создаёт вторую генерацию', async () => {
    const calls = stubUpstream([{ body: imagesResponse }]);
    const provider = createProvider();
    const input = {
      model: 'gpt-image-1',
      prompt: 'кот',
      params: {},
      idempotencyKey: IDEMPOTENCY_KEY,
    };

    const first = await provider.createTaskAsync(input);
    const second = await provider.createTaskAsync(input);

    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('createTaskAsync: другой ключ идемпотентности — новый запрос', async () => {
    const calls = stubUpstream([{ body: imagesResponse }]);
    const provider = createProvider();

    await provider.createTaskAsync({
      model: 'gpt-image-1',
      prompt: 'кот',
      params: {},
      idempotencyKey: 'run-1:node-1',
    });
    await provider.createTaskAsync({
      model: 'gpt-image-1',
      prompt: 'кот',
      params: {},
      idempotencyKey: 'run-2:node-1',
    });

    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2);
  });

  it('getTaskAsync: опрос не поддерживается и сообщает об этом явно', async () => {
    const provider = createProvider();

    await expect(provider.getTaskAsync('openai-images:gpt-image-1')).rejects.toThrow(
      'опрос задач не поддерживается',
    );
  });

  it('applyToolAsync: скачивает файл и отправляет multipart в /images/edits (b64)', async () => {
    const calls = stubUpstream([
      {
        match: 'cdn.example.com/photo.png',
        rawBody: IMAGE_BYTES,
        contentType: 'image/png',
      },
      { match: '/images/edits', body: imagesResponse },
    ]);
    const provider = createProvider();

    const task = await provider.applyToolAsync(INPUT_URL, 'upscale', {
      model: 'openai_images:gpt-image-1',
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    const download = calls.find((call) => call.method === 'GET');
    const edit = calls.find((call) => call.method === 'POST');
    const image = edit?.formData?.get('image');

    expect(download?.url).toBe(INPUT_URL);
    expect(edit?.url).toBe(`${BASE_URL}/images/edits`);
    expect(edit?.authorization).toBe(`Bearer ${KEY}`);
    expect(edit?.formData).toBeInstanceOf(FormData);
    // Файл уходит именно содержимым, а не ссылкой.
    expect(image).toBeInstanceOf(Blob);
    await expect((image as Blob).text()).resolves.toBe(IMAGE_BYTES);
    expect(edit?.formData?.get('model')).toBe('gpt-image-1');
    expect(String(edit?.formData?.get('prompt'))).toContain('higher resolution');
    expect(edit?.formData?.get('n')).toBe('1');
    expect(task.status).toBe('done');
    expect(task.resultUrls).toEqual([`data:image/png;base64,${B64}`]);
  });

  it('applyToolAsync: bg_removal получает свой промпт и скалярные параметры', async () => {
    const calls = stubUpstream([
      {
        match: 'cdn.example.com/photo.png',
        rawBody: IMAGE_BYTES,
        contentType: 'image/png',
      },
      { match: '/images/edits', body: imagesResponse },
    ]);
    const provider = createProvider();

    await provider.applyToolAsync(INPUT_URL, 'bg_removal', {
      model: 'gpt-image-1',
      idempotencyKey: IDEMPOTENCY_KEY,
      size: '1024x1024',
      quality: 'low',
    });

    const edit = calls.find((call) => call.method === 'POST');
    const prompt = String(edit?.formData?.get('prompt'));

    expect(prompt).toContain('Remove the background');
    expect(edit?.formData?.get('size')).toBe('1024x1024');
    expect(edit?.formData?.get('quality')).toBe('low');
  });

  it('applyToolAsync: ответ с url разбирается так же, как b64_json', async () => {
    stubUpstream([
      {
        match: 'cdn.example.com/photo.png',
        rawBody: IMAGE_BYTES,
        contentType: 'image/png',
      },
      {
        match: '/images/edits',
        body: {
          created: 1,
          data: [{ url: 'https://cdn.example.com/edited.png' }],
        },
      },
    ]);
    const provider = createProvider();

    const task = await provider.applyToolAsync(INPUT_URL, 'upscale', {
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(task.resultUrls).toEqual(['https://cdn.example.com/edited.png']);
  });

  it('applyToolAsync: идемпотентность не повторяет скачивание и редактирование', async () => {
    const calls = stubUpstream([
      {
        match: 'cdn.example.com/photo.png',
        rawBody: IMAGE_BYTES,
        contentType: 'image/png',
      },
      { match: '/images/edits', body: imagesResponse },
    ]);
    const provider = createProvider();
    const params = {
      model: 'gpt-image-1',
      idempotencyKey: IDEMPOTENCY_KEY,
    };

    const first = await provider.applyToolAsync(INPUT_URL, 'upscale', params);
    const second = await provider.applyToolAsync(INPUT_URL, 'upscale', params);

    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('applyToolAsync: trim/lipsync/chromakey отвергаются до скачивания', async () => {
    const calls = stubUpstream([{ body: imagesResponse }]);
    const provider = createProvider();

    for (const tool of ['trim', 'lipsync', 'chromakey'] as const) {
      await expect(
        provider.applyToolAsync(INPUT_URL, tool, { idempotencyKey: IDEMPOTENCY_KEY }),
      ).rejects.toThrow('не поддерживается OpenAI Images');
    }

    expect(calls).toHaveLength(0);
  });

  it('applyToolAsync: dall-e-3 не поддерживает /images/edits — ошибка до сети', async () => {
    const calls = stubUpstream([{ body: imagesResponse }]);
    const provider = createProvider();

    await expect(
      provider.applyToolAsync(INPUT_URL, 'upscale', {
        model: 'dall-e-3',
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).rejects.toThrow('не поддерживает /images/edits');

    expect(calls).toHaveLength(0);
  });

  it('applyToolAsync: не-http ссылка отвергается до запроса', async () => {
    const calls = stubUpstream([{ body: imagesResponse }]);
    const provider = createProvider();

    await expect(
      provider.applyToolAsync('file:///tmp/photo.png', 'bg_removal'),
    ).rejects.toThrow('нужна публичная http(s)-ссылка');

    expect(calls).toHaveLength(0);
  });

  it('applyToolAsync: приватный IP отвергается до сетевого вызова (SSRF)', async () => {
    const calls = stubUpstream([{ body: imagesResponse }]);
    const provider = createProvider();

    await expect(
      provider.applyToolAsync('http://127.0.0.1/photo.png', 'upscale', {
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).rejects.toThrow('приватный адрес');

    expect(calls).toHaveLength(0);
  });

  it('applyToolAsync: 404 при скачивании — ошибка без POST в /images/edits', async () => {
    const calls = stubUpstream([
      {
        match: 'cdn.example.com/photo.png',
        body: { error: { message: 'not found' } },
        status: 404,
      },
      { match: '/images/edits', body: imagesResponse },
    ]);
    const provider = createProvider();

    const error = await provider
      .applyToolAsync(INPUT_URL, 'upscale', {
        idempotencyKey: IDEMPOTENCY_KEY,
      })
      .catch((caught: unknown) => caught);

    expect((error as MediaProviderException).retryable).toBe(false);
    expect((error as Error).message).toContain('not found');
    expect(calls.some((call) => call.url.includes('/images/edits'))).toBe(false);
  });

  it('applyToolAsync: слишком большой вход не скачивается полностью', async () => {
    const calls = stubUpstream([
      {
        match: 'cdn.example.com/photo.png',
        rawBody: 'x',
        contentType: 'image/png',
        headers: { 'Content-Length': String(30 * 1024 * 1024) },
      },
      { match: '/images/edits', body: imagesResponse },
    ]);
    const provider = createProvider();

    await expect(
      provider.applyToolAsync(INPUT_URL, 'upscale', {
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).rejects.toThrow('больше лимита');

    expect(calls.some((call) => call.url.includes('/images/edits'))).toBe(false);
  });
});
