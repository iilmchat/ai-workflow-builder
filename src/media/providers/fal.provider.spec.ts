import { ConfigService } from '@nestjs/config';
import { MediaProviderException } from '../media-provider.interface.js';
import { FalProvider } from './fal.provider.js';

/**
 * Юнит-тесты прямого провайдера FAL (R7.3, DESIGN v0.9 § 3.3).
 *
 * Проверяется сборка запроса (`POST {FAL_BASE_URL}/{modelId}`, заголовок
 * `Authorization: Key <FAL_KEY>`), обе формы ответа — синхронный `fal.run` и
 * очередь `queue.fal.run` — и `applyToolAsync` (KI-371) с переименованием роли
 * входа (`image_url` / `video_url`).
 */

/** Базовый URL синхронного FAL в тесте. */
const BASE_URL = 'https://fal.test';
/** Базовый URL очереди в тесте. */
const QUEUE_URL = 'https://queue.fal.test';
/** Ключ в тесте (не секрет: значение задаётся здесь же). */
const KEY = 'fal_test_key';
/** Курс USD→RUB в тесте. */
const USD_RUB_RATE = 10;
/** Ключ идемпотентности в тесте. */
const IDEMPOTENCY_KEY = 'run-1:node-1';
/** Ссылка на входное изображение. */
const INPUT_URL = 'https://cdn.example.com/photo.png';

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

/** Конфигурация синхронного FAL. */
const configured: Record<string, string | number> = {
  FAL_KEY: KEY,
  FAL_BASE_URL: BASE_URL,
  MEDIA_USD_RUB_RATE: USD_RUB_RATE,
};

/** Запись о запросе, ушедшем в upstream. */
interface UpstreamCall {
  /** Метод запроса. */
  method: string;
  /** Полный URL. */
  url: string;
  /** Разобранное тело (для GET — `null`). */
  body: Record<string, unknown> | null;
  /** Заголовок авторизации. */
  authorization: string | null;
}

/** Ответ заглушки: JSON-тело, статус и заголовки. */
interface StubResponse {
  /** Тело (сериализуется в JSON). */
  body: unknown;
  /** HTTP-статус. */
  status?: number;
  /** Дополнительные заголовки. */
  headers?: Record<string, string>;
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

      calls.push({
        method: init?.method ?? 'GET',
        url: target,
        body,
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

      return Promise.resolve(
        new Response(JSON.stringify(route.body), {
          status: route.status ?? 200,
          headers: { 'Content-Type': 'application/json', ...route.headers },
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
): FalProvider {
  return new FalProvider(configStub(values));
}

/** Синхронный ответ FAL: файлы сразу в ответе. */
const syncResponse = {
  images: [{ url: 'https://fal.media/out-1.png', width: 1024, height: 1024 }],
  seed: 42,
};

/** Ответ очереди FAL на постановку задачи. */
const queueAccepted = {
  request_id: 'req-1',
  status: 'IN_QUEUE',
  status_url: `${QUEUE_URL}/requests/req-1/status`,
  response_url: `${QUEUE_URL}/requests/req-1`,
};

describe('FalProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('без ключа не сконфигурирован и бросает при вызове', async () => {
    const provider = createProvider({ FAL_BASE_URL: BASE_URL });

    expect(provider.name).toBe('fal');
    expect(provider.isConfigured).toBe(false);
    await expect(provider.listModelsAsync()).rejects.toThrow('FAL_KEY не задан');
  });

  it('с ключом сконфигурирован', () => {
    expect(createProvider().isConfigured).toBe(true);
  });

  it('listModelsAsync: каталог с префиксом и ценой в рублях, кэш TTL', async () => {
    const calls = stubUpstream([{ body: {} }]);
    const provider = createProvider();

    const models = await provider.listModelsAsync('IMAGE');
    await provider.listModelsAsync('IMAGE');

    const ultra = models.find(
      (model) => model.id === 'fal:fal-ai/flux-pro/v1.1-ultra',
    );

    expect(ultra?.provider).toBe('fal');
    expect(ultra?.price).toBeCloseTo(0.6);
    // Каталог объявлен в коде: в сеть провайдер не ходит вовсе (RULES 1.18).
    expect(calls).toHaveLength(0);
  });

  it('listModelsAsync: фильтрует по типу (TOOL — модели-инструменты)', async () => {
    const provider = createProvider();

    const tools = await provider.listModelsAsync('TOOL');

    expect(tools.map((model) => model.id)).toEqual([
      'fal:fal-ai/imageutils/rembg',
      'fal:fal-ai/clarity-upscaler',
    ]);
  });

  it('createTaskAsync: POST {base}/{model} с заголовком Key и плоским телом', async () => {
    const calls = stubUpstream([{ body: syncResponse }]);
    const provider = createProvider();

    const task = await provider.createTaskAsync({
      model: 'fal:fal-ai/flux/schnell',
      prompt: 'кот в шляпе',
      params: { aspect_ratio: '16:9' },
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    const post = calls.find((call) => call.method === 'POST');

    expect(post?.url).toBe(`${BASE_URL}/fal-ai/flux/schnell`);
    // У FAL собственная схема авторизации: `Key <ключ>`, не Bearer.
    expect(post?.authorization).toBe(`Key ${KEY}`);
    expect(post?.body).toEqual({
      aspect_ratio: '16:9',
      prompt: 'кот в шляпе',
    });
    expect(task).toEqual({
      taskId: '',
      model: 'fal-ai/flux/schnell',
      status: 'done',
      resultUrls: ['https://fal.media/out-1.png'],
      costRub: null,
      error: null,
    });
  });

  it('createTaskAsync: 403 → ошибка без повтора', async () => {
    stubUpstream([
      { body: { detail: 'Exhausted balance' }, status: 403 },
    ]);
    const provider = createProvider();

    const error = await provider
      .createTaskAsync({
        model: 'fal-ai/flux/schnell',
        prompt: 'кот',
        params: {},
        idempotencyKey: IDEMPOTENCY_KEY,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MediaProviderException);
    expect((error as MediaProviderException).retryable).toBe(false);
    expect((error as Error).message).toContain('Exhausted balance');
  });

  it('createTaskAsync: 500 → retryable-ошибка', async () => {
    stubUpstream([{ body: { detail: 'internal' }, status: 500 }]);
    const provider = createProvider();

    const error = await provider
      .createTaskAsync({
        model: 'fal-ai/flux/schnell',
        prompt: 'кот',
        params: {},
        idempotencyKey: IDEMPOTENCY_KEY,
      })
      .catch((caught: unknown) => caught);

    expect((error as MediaProviderException).retryable).toBe(true);
  });

  it('createTaskAsync: идемпотентность — повтор не создаёт второй запрос', async () => {
    const calls = stubUpstream([
      { match: '/status', body: { status: 'COMPLETED' } },
      { match: '/requests/req-1', body: syncResponse },
      { body: queueAccepted },
    ]);
    const provider = createProvider({ ...configured, FAL_BASE_URL: QUEUE_URL });
    const input = {
      model: 'fal-ai/flux/schnell',
      prompt: 'кот',
      params: {},
      idempotencyKey: IDEMPOTENCY_KEY,
    };

    const first = await provider.createTaskAsync(input);
    const second = await provider.createTaskAsync(input);

    expect(first.status).toBe('queued');
    expect(first.taskId).toBe('req-1');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    // Второй вызов пошёл опрашивать статус и результат существующего запроса.
    expect(second.status).toBe('done');
    expect(second.resultUrls).toEqual(['https://fal.media/out-1.png']);
  });

  it('createTaskAsync: очередь — taskId из request_id и статус queued', async () => {
    stubUpstream([{ body: queueAccepted }]);
    const provider = createProvider({ ...configured, FAL_BASE_URL: QUEUE_URL });

    const task = await provider.createTaskAsync({
      model: 'fal:fal-ai/flux-pro/v1.1',
      prompt: 'кот',
      params: {},
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(task.taskId).toBe('req-1');
    expect(task.status).toBe('queued');
    expect(task.resultUrls).toEqual([]);
  });

  it('createTaskAsync: request_id из заголовка x-fal-request-id', async () => {
    stubUpstream([
      {
        body: { status: 'IN_QUEUE' },
        headers: { 'x-fal-request-id': 'req-header' },
      },
    ]);
    const provider = createProvider();

    const task = await provider.createTaskAsync({
      model: 'fal-ai/flux-pro/v1.1',
      prompt: 'кот',
      params: {},
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(task.taskId).toBe('req-header');
  });

  it('getTaskAsync: статус IN_PROGRESS → running, FAILED → failed с причиной', async () => {
    const provider = createProvider();

    stubUpstream([{ body: { status: 'IN_PROGRESS' } }]);
    await expect(provider.getTaskAsync('req-2')).resolves.toMatchObject({
      status: 'running',
      resultUrls: [],
    });

    provider.clearCache();
    stubUpstream([
      { body: { status: 'FAILED', error: { message: 'NSFW detected' } } },
    ]);
    await expect(provider.getTaskAsync('req-3')).resolves.toMatchObject({
      status: 'failed',
      error: 'NSFW detected',
    });
  });

  it('getTaskAsync: COMPLETED — результат и биллинг из ответа', async () => {
    const calls = stubUpstream([
      { match: '/status', body: { status: 'COMPLETED' } },
      {
        match: '/requests/req-4',
        body: { ...syncResponse, billing: { cost: 0.05 } },
      },
    ]);
    const provider = createProvider();

    const task = await provider.getTaskAsync('req-4');
    const result = calls.find((call) => call.url.endsWith('/requests/req-4'));

    expect(task.status).toBe('done');
    expect(task.resultUrls).toEqual(['https://fal.media/out-1.png']);
    // 0.05 USD × 10 — стоимость пересчитана в рубли (единая шкала бюджета).
    expect(task.costRub).toBeCloseTo(0.5);
    expect(result?.url).toBe(`${BASE_URL}/requests/req-4`);
  });

  it('getTaskAsync: 404 → ошибка без повтора', async () => {
    stubUpstream([{ body: { detail: 'Not found' }, status: 404 }]);
    const provider = createProvider();

    const error = await provider
      .getTaskAsync('missing')
      .catch((caught: unknown) => caught);

    expect((error as MediaProviderException).retryable).toBe(false);
  });

  it('applyToolAsync: image_url для upscale и video_url для lipsync (KI-371)', async () => {
    const provider = createProvider();
    const upscaleCalls = stubUpstream([{ body: syncResponse }]);

    await provider.applyToolAsync(INPUT_URL, 'upscale', {
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(upscaleCalls[0]?.url).toBe(`${BASE_URL}/fal-ai/clarity-upscaler`);
    expect(upscaleCalls[0]?.body).toEqual({ image_url: INPUT_URL });
    // Промпт апскейлеру не отправляется: у FAL промпта в схеме нет, лишнее
    // поле отклоняется как 422.
    expect(upscaleCalls[0]?.body?.prompt).toBeUndefined();

    const lipsyncCalls = stubUpstream([{ body: syncResponse }]);

    await provider.applyToolAsync('https://cdn.example.com/clip.mp4', 'lipsync', {
      model: 'fal-ai/sync-lipsync',
      audioUrl: 'https://cdn.example.com/voice.mp3',
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(lipsyncCalls[0]?.url).toBe(`${BASE_URL}/fal-ai/sync-lipsync`);
    expect(lipsyncCalls[0]?.body).toEqual({
      video_url: 'https://cdn.example.com/clip.mp4',
      audio_url: 'https://cdn.example.com/voice.mp3',
      prompt: 'sync the lips to the audio',
    });
  });

  it('applyToolAsync: без модели у операции без дефолта — ошибка до запроса', async () => {
    const calls = stubUpstream([{ body: syncResponse }]);
    const provider = createProvider();

    await expect(
      provider.applyToolAsync('https://cdn.example.com/clip.mp4', 'trim'),
    ).rejects.toThrow('не выбрана модель');

    expect(calls).toHaveLength(0);
  });

  it('applyToolAsync: не-http ссылка отвергается до запроса', async () => {
    const calls = stubUpstream([{ body: syncResponse }]);
    const provider = createProvider();

    await expect(
      provider.applyToolAsync('/local/photo.png', 'bg_removal'),
    ).rejects.toThrow('нужна публичная http(s)-ссылка');

    expect(calls).toHaveLength(0);
  });
});
