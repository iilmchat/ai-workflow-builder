import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Database } from '../db/db.module.js';
import { DRIZZLE } from '../db/db.module.js';
import type { NodeDto } from '../engine/dto/index.js';
import { CostBudgetService } from '../runs/cost-budget.service.js';
import { MediaNodeExecutor } from './media-node-executor.service.js';
import { MEDIA_PROVIDERS, MediaRegistryService } from './media-registry.service.js';
import { CreativeLabProvider } from './providers/creativelab.provider.js';

/**
 * Интеграционный тест R7.1 (KI-196): апскейл через **реальный**
 * `CreativeLabProvider` с замоканным upstream.
 *
 * Юнит-тесты исполнителя (`media-node-executor.tool.spec.ts`) проверяют
 * маршрутизацию, а здесь проверяется то, что нельзя проверить заглушкой, —
 * **сборка HTTP-запроса** к `POST /api/v2/media/tasks`: роли входных файлов
 * (`inputs`), промпт, параметры, ключ идемпотентности и заголовок авторизации.
 * Именно эта часть ломается незаметно: upstream отвечает `400 Invalid input`,
 * не объясняя, какого поля не хватило (KI-181/KI-196).
 *
 * Отдельно проверяется предохранитель по стоимости (KI-048): при исчерпанном
 * бюджете платный `POST /tasks` не уходит вовсе.
 */

/** Базовый URL media API в тесте. */
const BASE_URL = 'https://media.test/api/v2/media';
/** Ключ API в тесте (не секрет: значение задаётся здесь же). */
const API_KEY = 'test-media-key';
/** Идентификатор запуска. */
const RUN_ID = '11111111-1111-4111-8111-111111111111';
/** Ссылка на входное изображение. */
const INPUT_URL = 'https://cdn.example.com/photo.png';

/** Каталог upstream: модель-инструмент с обязательным слотом `image`. */
const MODELS_RESPONSE = {
  code: 0,
  models: [
    {
      id: 'upscale-model',
      code: 'upscale-model',
      type: 'IMAGE',
      price: 25,
      price_unit: 'per_generation',
      moderation: 'auto',
      prompt: 'required',
      params: [],
      inputs: [
        {
          key: 'image',
          kind: 'image',
          role: 'reference',
          required: true,
          count: { min: 1, max: 1 },
          formats: ['png', 'jpg'],
        },
      ],
    },
    {
      id: 'bgremover',
      code: 'bgremover',
      type: 'IMAGE',
      price: 10,
      price_unit: 'per_generation',
      moderation: 'auto',
      prompt: 'required',
      params: [],
      inputs: [
        {
          key: 'image',
          kind: 'image',
          role: 'reference',
          required: true,
          count: { min: 1, max: 1 },
        },
      ],
    },
    {
      id: 'kling-lipsync',
      code: 'kling-lipsync',
      type: 'VIDEO',
      price: 2.8,
      price_unit: 'per_generation',
      moderation: 'strict',
      prompt: 'none',
      params: [],
      inputs: [
        {
          key: 'video',
          kind: 'video',
          role: 'edit_source',
          required: true,
          count: { min: 1, max: 1 },
        },
        {
          key: 'audio',
          kind: 'audio',
          role: 'reference',
          required: true,
          count: { min: 1, max: 1 },
        },
      ],
    },
  ],
};

/** Ответ upstream на создание задачи (успешный, сразу `done`). */
const TASK_RESPONSE = {
  code: 0,
  id: 'task-42',
  model: 'upscale-model',
  status: 'done',
  price: 25,
  result: [{ url: 'https://cdn.example.com/upscaled.png' }],
};

/** Тело запроса, которое получил upstream (последний `POST /tasks`). */
interface UpstreamCall {
  /** Метод запроса. */
  method: string;
  /** Полный URL запроса. */
  url: string;
  /** Заголовок авторизации. */
  authorization: string | null;
  /** Разобранное тело запроса (для GET — `null`). */
  body: Record<string, unknown> | null;
}

/**
 * Подменяет глобальный `fetch` заглушкой upstream.
 *
 * @returns список полученных запросов (порядок вызовов сохраняется)
 */
function stubUpstream(): UpstreamCall[] {
  const calls: UpstreamCall[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : null;

      calls.push({
        method: init?.method ?? 'GET',
        url: String(url),
        authorization: headers.get('authorization'),
        body,
      });

      if (String(url).includes('/models')) {
        return Promise.resolve(
          new Response(JSON.stringify(MODELS_RESPONSE), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify(TASK_RESPONSE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );

  return calls;
}

/**
 * Собирает исполнителя с реальным провайдером и замоканным upstream.
 *
 * @param spentUsd - сколько уже потратил запуск (для проверки бюджета)
 * @param maxUsd - лимит запуска в USD
 * @returns пару «исполнитель + список ушедших запросов»
 */
async function createExecutor(
  spentUsd = '0',
  maxUsd = 5,
): Promise<{ executor: MediaNodeExecutor; calls: UpstreamCall[] }> {
  const calls = stubUpstream();

  const moduleRef = await Test.createTestingModule({
    providers: [
      CreativeLabProvider,
      { provide: MEDIA_PROVIDERS, useFactory: (p: CreativeLabProvider) => [p], inject: [CreativeLabProvider] },
      MediaNodeExecutor,
      // Реестр в этом тесте не используется (инструмент идёт к провайдеру
      // напрямую), но он — обязательная зависимость исполнителя.
      {
        provide: MediaRegistryService,
        useValue: { getTaskAsync: vi.fn(() => Promise.resolve(null)) },
      },
      // Реальный предохранитель по стоимости: проверяем связку бюджета и
      // провайдера, а не заглушку.
      CostBudgetService,
      {
        provide: DRIZZLE,
        useValue: {
          select: () => ({
            from: () => ({
              where: () =>
                Promise.resolve([{ costUsd: spentUsd, costRub: '0' }]),
            }),
          }),
        } as unknown as Database,
      },
      {
        provide: ConfigService,
        useValue: {
          get: vi.fn((key: string) => {
            const values: Record<string, unknown> = {
              GPTUNNEL_MEDIA_API_KEY: API_KEY,
              GPTUNNEL_MEDIA_BASE_URL: BASE_URL,
              GPTUNNEL_MEDIA_CACHE_TTL_MS: 900_000,
              WORKFLOW_RUN_MAX_COST_USD: maxUsd,
              WORKFLOW_RUN_MAX_COST_RUB: 500,
              WORKFLOW_RUN_BUDGET_MODE: 'hard',
              WORKFLOW_RUN_USD_RUB_RATE: 100,
            };

            return values[key];
          }),
        },
      },
    ],
  }).compile();

  return { executor: moduleRef.get(MediaNodeExecutor), calls };
}

/**
 * Создаёт узел `image_tool`.
 *
 * @param data - поля `data` узла
 * @returns узел графа
 */
function toolNode(data: Record<string, unknown>): NodeDto {
  return {
    id: 'tool-1',
    type: 'image_tool',
    position: { x: 0, y: 0 },
    data,
  };
}

describe('image_tool: апскейл через реальный провайдер (R7.1, KI-196)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('upscale: в upstream уходит POST /tasks с inputs по ролям и ключом идемпотентности', async () => {
    const { executor, calls } = await createExecutor();

    const result = await executor.executeToolAsync(
      toolNode({ operation: 'upscale', model: 'upscale-model' }),
      { url: INPUT_URL },
      RUN_ID,
    );

    const post = calls.find((call) => call.method === 'POST');

    expect(post?.url).toBe(`${BASE_URL}/tasks`);
    expect(post?.authorization).toBe(API_KEY);
    expect(post?.body).toEqual({
      model: 'upscale-model',
      prompt: 'upscale this image, keep the details',
      params: {},
      inputs: { image: [INPUT_URL] },
      idempotency_key: `${RUN_ID}:tool-1`,
      wait: true,
    });

    // Результат upstream доехал до выходов узла в формате DESIGN § 3.1.
    expect(result.outputs).toEqual({
      resultUrls: ['https://cdn.example.com/upscaled.png'],
      costRub: 25,
      mediaType: 'TOOL',
      taskId: 'task-42',
    });
  });

  it('bg_removal без выбранной модели идёт в bgremover с дефолтным промптом', async () => {
    const { executor, calls } = await createExecutor();

    await executor.executeToolAsync(
      toolNode({ operation: 'bg_removal' }),
      { url: INPUT_URL },
      RUN_ID,
    );

    const post = calls.find((call) => call.method === 'POST');

    expect(post?.body).toMatchObject({
      model: 'bgremover',
      prompt: 'remove the background',
      inputs: { image: [INPUT_URL] },
    });
  });

  it('lipsync без аудио не уходит в upstream: платного запроса нет', async () => {
    const { executor, calls } = await createExecutor();

    const error = await executor
      .executeToolAsync(
        toolNode({
          operation: 'lipsync',
          model: 'kling-lipsync',
          inputUrl: 'https://cdn.example.com/clip.mp4',
        }),
        {},
        RUN_ID,
      )
      .catch((caught: unknown) => caught);

    expect((error as Error).message).toContain('нужен аудио-файл');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('исчерпанный бюджет останавливает вызов до запроса к upstream (KI-048)', async () => {
    // Лимит 1 USD, потрачено 2 USD: оценка 25 ₽ (0.25 USD) уже не влезает.
    const { executor, calls } = await createExecutor('2.000000', 1);

    const error = await executor
      .executeToolAsync(
        toolNode({ operation: 'upscale', model: 'upscale-model' }),
        { url: INPUT_URL },
        RUN_ID,
      )
      .catch((caught: unknown) => caught);

    expect((error as Error).message).toContain('Budget exceeded');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });
});
