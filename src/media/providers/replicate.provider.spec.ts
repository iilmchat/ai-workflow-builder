import { ConfigService } from '@nestjs/config';
import { MediaProviderException } from '../media-provider.interface.js';
import { ReplicateProvider } from './replicate.provider.js';

/**
 * Юнит-тесты прямого провайдера Replicate (R7.3, DESIGN v0.9 § 3.3).
 *
 * Upstream замокан `fetch`-заглушкой: проверяется **сборка запроса** (URL,
 * заголовок авторизации, `version`, `input`, `wait`) и **разбор ответа**
 * (`status`, `output`, retryable-классы ошибок). Реальные вызовы Replicate
 * требуют ключа, которого в CI нет (см. `openai-images.integration.spec.ts` —
 * там интеграционный smoke под `skipIf`).
 */

/** Базовый URL в тесте (подменяется через ConfigService). */
const BASE_URL = 'https://replicate.test/v1';
/** Токен в тесте (не секрет: значение задаётся здесь же). */
const TOKEN = 'r8_test_token';
/** Курс USD→RUB в тесте: 10 — чтобы цена в рублях отличалась от долларов. */
const USD_RUB_RATE = 10;
/** Ключ идемпотентности в тесте. */
const IDEMPOTENCY_KEY = 'run-1:node-1';

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

/** Конфигурация с ключом, base URL и курсом. */
const configured: Record<string, string | number> = {
  REPLICATE_API_TOKEN: TOKEN,
  REPLICATE_BASE_URL: BASE_URL,
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

/** Ответ заглушки: JSON-тело и статус. */
interface StubResponse {
  /** Тело (сериализуется в JSON; `null` — пустое тело). */
  body: unknown;
  /** HTTP-статус. */
  status?: number;
  /** Дополнительные заголовки. */
  headers?: Record<string, string>;
}

/**
 * Подменяет глобальный `fetch` маршрутизатором по подстроке URL.
 *
 * @param routes - пары «подстрока URL → ответ»; проверяются по порядку.
 *   Последний элемент массива без `match` играет роль ответа по умолчанию.
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
        new Response(route.body === null ? null : JSON.stringify(route.body), {
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
): ReplicateProvider {
  return new ReplicateProvider(configStub(values));
}

/** Предсказание Replicate (ответ `POST /predictions`). */
const predictionPayload = {
  id: 'pred-1',
  model: 'black-forest-labs/flux-schnell',
  status: 'succeeded',
  output: ['https://replicate.delivery/out-1.png'],
};

describe('ReplicateProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('без токена не сконфигурирован и бросает при вызове', async () => {
    const provider = createProvider({ REPLICATE_BASE_URL: BASE_URL });

    expect(provider.name).toBe('replicate');
    expect(provider.isConfigured).toBe(false);
    await expect(
      provider.createTaskAsync({
        model: 'black-forest-labs/flux-schnell',
        prompt: 'кот',
        params: {},
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).rejects.toThrow('REPLICATE_API_TOKEN не задан');
  });

  it('с токеном сконфигурирован', () => {
    expect(createProvider().isConfigured).toBe(true);
  });

  it('listModelsAsync: каталог с префиксом провайдера и ценой в рублях', async () => {
    stubUpstream([{ body: { results: [] } }]);
    const provider = createProvider();

    const models = await provider.listModelsAsync('IMAGE');

    const flux = models.find(
      (model) => model.id === 'replicate:black-forest-labs/flux-schnell',
    );

    expect(flux).toBeDefined();
    expect(flux?.provider).toBe('replicate');
    expect(flux?.type).toBe('IMAGE');
    // 0.003 USD × 10 (курс в тесте) — цена пересчитана в рубли (KI-048).
    expect(flux?.price).toBeCloseTo(0.03);
    expect(flux?.params.map((param) => param.key)).toContain('aspect_ratio');
  });

  it('listModelsAsync: проверяет доступность только один раз (TTL-кэш)', async () => {
    const calls = stubUpstream([{ body: { results: [] } }]);
    const provider = createProvider();

    await provider.listModelsAsync('IMAGE');
    await provider.listModelsAsync('IMAGE');

    expect(calls.filter((call) => call.url.endsWith('/models'))).toHaveLength(1);
  });

  it('listModelsAsync: неконфигурированный провайдер бросает, а не отдаёт пустой список', async () => {
    const provider = createProvider({ REPLICATE_BASE_URL: BASE_URL });

    await expect(provider.listModelsAsync()).rejects.toThrow(
      'REPLICATE_API_TOKEN не задан',
    );
  });

  it('listModelsAsync: 503 от upstream — retryable-ошибка', async () => {
    stubUpstream([
      { match: '/models', body: { detail: 'upstream down' }, status: 503 },
    ]);
    const provider = createProvider();

    const error = await provider.listModelsAsync().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MediaProviderException);
    expect((error as MediaProviderException).retryable).toBe(true);
    expect((error as Error).message).toContain('upstream down');
  });

  it('createTaskAsync: POST /predictions с Bearer-токеном и input из промпта', async () => {
    const calls = stubUpstream([{ match: '/predictions', body: predictionPayload }]);
    const provider = createProvider();

    const task = await provider.createTaskAsync({
      model: 'replicate:black-forest-labs/flux-schnell',
      prompt: 'кот в шляпе',
      params: { aspect_ratio: '16:9' },
      idempotencyKey: IDEMPOTENCY_KEY,
      wait: true,
    });

    const post = calls.find((call) => call.method === 'POST');

    expect(post?.url).toBe(`${BASE_URL}/predictions`);
    expect(post?.authorization).toBe(`Bearer ${TOKEN}`);
    // Префикс провайдера снят: в Replicate уходит `owner/name`.
    expect(post?.body).toEqual({
      input: { aspect_ratio: '16:9', prompt: 'кот в шляпе' },
      wait: 60,
    });
    expect(task).toEqual({
      taskId: 'pred-1',
      model: 'black-forest-labs/flux-schnell',
      status: 'done',
      resultUrls: ['https://replicate.delivery/out-1.png'],
      costRub: null,
      error: null,
    });
  });

  it('createTaskAsync: версия модели уходит в поле version', async () => {
    const calls = stubUpstream([{ match: '/predictions', body: predictionPayload }]);
    const provider = createProvider();

    await provider.createTaskAsync({
      model: 'black-forest-labs/flux-schnell:abc123',
      prompt: 'кот',
      params: {},
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(calls[0]?.body).toEqual({
      input: { prompt: 'кот' },
      version: 'abc123',
    });
  });

  it('createTaskAsync: входные файлы по ролям уходят в input (KI-196)', async () => {
    const calls = stubUpstream([{ match: '/predictions', body: predictionPayload }]);
    const provider = createProvider();

    await provider.createTaskAsync({
      model: 'nightmareai/real-esrgan',
      params: {},
      inputs: { image: ['https://cdn.example.com/photo.png'] },
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(calls[0]?.body).toEqual({
      input: { image: 'https://cdn.example.com/photo.png' },
    });
  });

  it('createTaskAsync: идемпотентность — повтор не создаёт второе предсказание', async () => {
    const calls = stubUpstream([
      { match: '/predictions', body: predictionPayload },
      { body: predictionPayload },
    ]);
    const provider = createProvider();
    const input = {
      model: 'black-forest-labs/flux-schnell',
      prompt: 'кот',
      params: {},
      idempotencyKey: IDEMPOTENCY_KEY,
    };

    const first = await provider.createTaskAsync(input);
    const second = await provider.createTaskAsync(input);

    // POST был ровно один: второй вызов ушёл на GET /predictions/pred-1.
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('createTaskAsync: 402 — повтор бессмыслен (баланс исчерпан)', async () => {
    stubUpstream([
      {
        match: '/predictions',
        body: { detail: 'Insufficient credit' },
        status: 402,
      },
    ]);
    const provider = createProvider();

    const error = await provider
      .createTaskAsync({
        model: 'black-forest-labs/flux-schnell',
        prompt: 'кот',
        params: {},
        idempotencyKey: IDEMPOTENCY_KEY,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MediaProviderException);
    expect((error as MediaProviderException).retryable).toBe(false);
    expect((error as Error).message).toContain('Insufficient credit');
  });

  it('createTaskAsync: 429 — retryable-ошибка', async () => {
    stubUpstream([
      { match: '/predictions', body: { detail: 'rate limited' }, status: 429 },
    ]);
    const provider = createProvider();

    const error = await provider
      .createTaskAsync({
        model: 'black-forest-labs/flux-schnell',
        prompt: 'кот',
        params: {},
        idempotencyKey: IDEMPOTENCY_KEY,
      })
      .catch((caught: unknown) => caught);

    expect((error as MediaProviderException).retryable).toBe(true);
  });

  it('createTaskAsync: 401 — ключ не принят, повтор бессмыслен', async () => {
    stubUpstream([
      { match: '/predictions', body: { detail: 'Invalid token' }, status: 401 },
    ]);
    const provider = createProvider();

    const error = await provider
      .createTaskAsync({
        model: 'black-forest-labs/flux-schnell',
        prompt: 'кот',
        params: {},
        idempotencyKey: IDEMPOTENCY_KEY,
      })
      .catch((caught: unknown) => caught);

    expect((error as MediaProviderException).retryable).toBe(false);
  });

  it('createTaskAsync: ответ не JSON → понятная ошибка', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('<html>портал</html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
        ),
      ),
    );
    const provider = createProvider();

    await expect(
      provider.createTaskAsync({
        model: 'black-forest-labs/flux-schnell',
        prompt: 'кот',
        params: {},
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).rejects.toThrow('не в формате JSON');
  });

  it('getTaskAsync: GET /predictions/:id возвращает статус, output и ошибку', async () => {
    const calls = stubUpstream([
      {
        match: '/predictions/pred-9',
        body: {
          id: 'pred-9',
          model: 'black-forest-labs/flux-dev',
          status: 'failed',
          error: 'NSFW content detected',
        },
      },
    ]);
    const provider = createProvider();

    const task = await provider.getTaskAsync('pred-9');

    expect(calls[0]?.url).toBe(`${BASE_URL}/predictions/pred-9`);
    expect(task.status).toBe('failed');
    expect(task.error).toBe('NSFW content detected');
    expect(task.resultUrls).toEqual([]);
  });

  it('getTaskAsync: маппит статусы starting/processing/canceled', async () => {
    const provider = createProvider();
    const statuses: Array<[string, string]> = [
      ['starting', 'queued'],
      ['processing', 'running'],
      ['canceled', 'failed'],
    ];

    for (const [upstream, expected] of statuses) {
      stubUpstream([
        { body: { id: 'pred-1', model: 'm', status: upstream } },
      ]);

      const task = await provider.getTaskAsync('pred-1');

      expect(task.status).toBe(expected);
    }
  });

  it('getTaskAsync: output строкой и объектом { url } тоже читается', async () => {
    const provider = createProvider();

    stubUpstream([
      {
        body: {
          id: 'pred-1',
          model: 'm',
          status: 'succeeded',
          output: 'https://replicate.delivery/one.png',
        },
      },
    ]);
    await expect(provider.getTaskAsync('pred-1')).resolves.toMatchObject({
      resultUrls: ['https://replicate.delivery/one.png'],
    });

    provider.clearCache();
    stubUpstream([
      {
        body: {
          id: 'pred-1',
          model: 'm',
          status: 'succeeded',
          output: { url: 'https://replicate.delivery/two.png' },
        },
      },
    ]);
    await expect(provider.getTaskAsync('pred-1')).resolves.toMatchObject({
      resultUrls: ['https://replicate.delivery/two.png'],
    });
  });

  it('getTaskAsync: 404 → ошибка без повтора', async () => {
    stubUpstream([
      { match: '/predictions/', body: { detail: 'Not found' }, status: 404 },
    ]);
    const provider = createProvider();

    const error = await provider
      .getTaskAsync('missing')
      .catch((caught: unknown) => caught);

    expect((error as MediaProviderException).retryable).toBe(false);
    expect((error as Error).message).toContain('Not found');
  });

  it('applyToolAsync: replicate.run-эквивалент — POST с image в input (KI-371)', async () => {
    const calls = stubUpstream([{ match: '/predictions', body: predictionPayload }]);
    const provider = createProvider();

    await provider.applyToolAsync(
      'https://cdn.example.com/photo.png',
      'upscale',
      { idempotencyKey: IDEMPOTENCY_KEY },
    );

    const post = calls.find((call) => call.method === 'POST');

    expect(post?.url).toBe(`${BASE_URL}/predictions`);
    expect(post?.body).toEqual({
      input: {
        image: 'https://cdn.example.com/photo.png',
        prompt: 'upscale this image, keep the details',
      },
      wait: 60,
    });
  });

  it('applyToolAsync: audioUrl уходит в input.audio (lipsync)', async () => {
    const calls = stubUpstream([{ match: '/predictions', body: predictionPayload }]);
    const provider = createProvider();

    await provider.applyToolAsync(
      'https://cdn.example.com/clip.mp4',
      'lipsync',
      {
        model: 'lucataco/sadtalker',
        audioUrl: 'https://cdn.example.com/voice.mp3',
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    );

    expect(calls[0]?.body).toEqual({
      input: {
        image: 'https://cdn.example.com/clip.mp4',
        audio: 'https://cdn.example.com/voice.mp3',
        prompt: 'sync the lips to the audio',
      },
      wait: 60,
    });
  });

  it('applyToolAsync: без модели у операции без дефолта — ошибка до платного запроса', async () => {
    const calls = stubUpstream([{ body: predictionPayload }]);
    const provider = createProvider();

    await expect(
      provider.applyToolAsync('https://cdn.example.com/photo.png', 'lipsync'),
    ).rejects.toThrow('не выбрана модель');

    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('applyToolAsync: не-http ссылка отвергается до запроса', async () => {
    const calls = stubUpstream([{ body: predictionPayload }]);
    const provider = createProvider();

    await expect(
      provider.applyToolAsync('data:image/png;base64,AAAA', 'upscale', {
        model: 'nightmareai/real-esrgan',
      }),
    ).rejects.toThrow('нужна публичная http(s)-ссылка');

    expect(calls).toHaveLength(0);
  });
});
