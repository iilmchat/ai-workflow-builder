import { Test } from '@nestjs/testing';
import type { NodeDto } from '../engine/dto/index.js';
import { NodeDataValidationException } from '../engine/node-executors.js';
import {
  BudgetExceededException,
  CostBudgetService,
} from '../runs/cost-budget.service.js';
import type { MediaTaskResult } from './dto/media-task.mapper.js';
import { DEFAULT_IMAGE_TOOL_MODELS } from './image-tool.js';
import { MediaNodeExecutor } from './media-node-executor.service.js';
import { MEDIA_PROVIDERS, MediaRegistryService } from './media-registry.service.js';
import {
  MediaProviderException,
  type MediaModelInfo,
} from './media-provider.interface.js';

/** Идентификатор запуска для ключа идемпотентности. */
const RUN_ID = '11111111-1111-4111-8111-111111111111';

/** Ссылка на входное изображение (только http(s) — KI-006). */
const INPUT_URL = 'https://cdn.example.com/in.png';

/**
 * Создаёт модель каталога.
 *
 * @param id - id модели
 * @param overrides - поля, которые нужно переопределить
 * @returns описание модели
 */
function model(id: string, overrides: Partial<MediaModelInfo> = {}): MediaModelInfo {
  return {
    id,
    code: id,
    type: 'IMAGE',
    price: 10,
    priceUnit: 'per_generation',
    priceInput: null,
    priceInputUnit: null,
    moderation: 'auto',
    prompt: 'required',
    params: [],
    inputs: [],
    ...overrides,
  };
}

/**
 * Создаёт узел `image_tool` с заданными данными.
 *
 * @param data - поля `data` узла
 * @returns узел графа
 */
function toolNode(data: Record<string, unknown> = {}): NodeDto {
  return {
    id: 'tool-1',
    type: 'image_tool',
    position: { x: 0, y: 0 },
    data: {
      operation: 'bg_removal',
      model: 'bgremover',
      ...data,
    },
  };
}

/**
 * Создаёт результат задачи инструмента.
 *
 * @param overrides - поля, которые нужно переопределить
 * @returns результат задачи
 */
function task(overrides: Partial<MediaTaskResult> = {}): MediaTaskResult {
  return {
    taskId: 'tool-task-1',
    model: 'bgremover',
    status: 'done',
    resultUrls: ['https://cdn.example.com/out.png'],
    costRub: 10,
    error: null,
    ...overrides,
  };
}

describe('MediaNodeExecutor: узел image_tool (R7.1, KI-196)', () => {
  let executor: MediaNodeExecutor;
  let registry: {
    createTaskAsync: ReturnType<typeof vi.fn>;
    getTaskAsync: ReturnType<typeof vi.fn>;
    findParamsAsync: ReturnType<typeof vi.fn>;
  };
  let provider: {
    name: string;
    isConfigured: boolean;
    listModelsAsync: ReturnType<typeof vi.fn>;
    createTaskAsync: ReturnType<typeof vi.fn>;
    getTaskAsync: ReturnType<typeof vi.fn>;
    applyToolAsync: ReturnType<typeof vi.fn>;
  };
  let budget: { assertWithinBudgetAsync: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    registry = {
      createTaskAsync: vi.fn(() => Promise.resolve(task())),
      getTaskAsync: vi.fn(() => Promise.resolve(task())),
      findParamsAsync: vi.fn(() => Promise.resolve(null)),
    };

    provider = {
      name: 'creativelab',
      isConfigured: true,
      listModelsAsync: vi.fn(() =>
        Promise.resolve([
          // Инструмент удаления фона: вход `image` обязателен (реальный каталог).
          model('bgremover', {
            prompt: 'required',
            inputs: [
              { key: 'image', kind: 'image', role: 'reference', required: true },
            ],
          }),
          // Липсинк: два обязательных слота (видео + аудио).
          model('kling-lipsync', {
            type: 'VIDEO',
            price: 2.8,
            prompt: 'none',
            inputs: [
              { key: 'video', kind: 'video', role: 'edit_source', required: true },
              { key: 'audio', kind: 'audio', role: 'reference', required: true },
            ],
          }),
          model('upscale-model', { price: 25 }),
          // KI-367: дефолты из каталогов прямых провайдеров и @VideoEdit.
          model('fal:fal-ai/clarity-upscaler', { price: 1 }),
          model('@VideoEdit', {
            type: 'VIDEO',
            price: 50,
            inputs: [
              { key: 'video', kind: 'video', role: 'reference', required: true },
            ],
          }),
        ]),
      ),
      createTaskAsync: vi.fn(() => Promise.resolve(task())),
      getTaskAsync: vi.fn(() => Promise.resolve(task())),
      applyToolAsync: vi.fn(() => Promise.resolve(task())),
    };

    budget = {
      assertWithinBudgetAsync: vi.fn(() =>
        Promise.resolve({
          ok: true,
          accumulated: 0,
          estimated: 0,
          remaining: 5,
          maxUsd: 5,
          maxRub: 500,
          mode: 'hard',
        }),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MediaNodeExecutor,
        { provide: MediaRegistryService, useValue: registry },
        { provide: MEDIA_PROVIDERS, useValue: [provider] },
        { provide: CostBudgetService, useValue: budget },
      ],
    }).compile();

    executor = moduleRef.get(MediaNodeExecutor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('выполняет операцию с явной моделью и отдаёт outputs { resultUrls, costRub }', async () => {
    const result = await executor.executeToolAsync(
      toolNode({ operation: 'upscale', model: 'upscale-model' }),
      { url: INPUT_URL },
      RUN_ID,
    );

    expect(provider.applyToolAsync).toHaveBeenCalledWith(
      INPUT_URL,
      'upscale',
      expect.objectContaining({
        model: 'upscale-model',
        idempotencyKey: `${RUN_ID}:tool-1`,
      }),
    );
    expect(result.outputs).toEqual({
      resultUrls: ['https://cdn.example.com/out.png'],
      costRub: 10,
      mediaType: 'TOOL',
      taskId: 'tool-task-1',
    });
    expect(result.metrics).toMatchObject({
      costRub: 10,
      mediaType: 'TOOL',
      taskId: 'tool-task-1',
      // R7.8: хранилище не подключено — своя ссылка не сохраняется.
      storedUrl: null,
      storedExpiresAt: null,
    });
  });

  it('без выбранной модели берёт дефолт операции (bg_removal → bgremover)', async () => {
    await executor.executeToolAsync(
      toolNode({ model: undefined }),
      { url: INPUT_URL },
      RUN_ID,
    );

    expect(provider.applyToolAsync).toHaveBeenCalledWith(
      INPUT_URL,
      'bg_removal',
      expect.objectContaining({ model: DEFAULT_IMAGE_TOOL_MODELS.bg_removal?.[0] }),
    );
  });

  it('KI-367: без выбранной модели trim берёт @VideoEdit из CreativeLab', async () => {
    await executor.executeToolAsync(
      toolNode({ operation: 'trim', model: undefined, inputUrl: INPUT_URL }),
      {},
      RUN_ID,
    );

    expect(provider.applyToolAsync).toHaveBeenCalledWith(
      INPUT_URL,
      'trim',
      expect.objectContaining({ model: '@VideoEdit' }),
    );
  });

  it('KI-367: без выбранной модели upscale берёт дефолт прямого провайдера', async () => {
    await executor.executeToolAsync(
      toolNode({ operation: 'upscale', model: undefined, inputUrl: INPUT_URL }),
      {},
      RUN_ID,
    );

    expect(provider.applyToolAsync).toHaveBeenCalledWith(
      INPUT_URL,
      'upscale',
      expect.objectContaining({ model: 'fal:fal-ai/clarity-upscaler' }),
    );
  });

  it('берёт вход из data.inputUrl, когда связи нет', async () => {
    await executor.executeToolAsync(
      toolNode({ operation: 'upscale', model: 'upscale-model', inputUrl: INPUT_URL }),
      {},
      RUN_ID,
    );

    expect(provider.applyToolAsync).toHaveBeenCalledWith(
      INPUT_URL,
      'upscale',
      expect.any(Object),
    );
  });

  it('вход по связи приоритетнее data.inputUrl', async () => {
    await executor.executeToolAsync(
      toolNode({
        operation: 'upscale',
        model: 'upscale-model',
        inputUrl: 'https://cdn.example.com/fallback.png',
      }),
      { url: INPUT_URL },
      RUN_ID,
    );

    expect(provider.applyToolAsync).toHaveBeenCalledWith(
      INPUT_URL,
      'upscale',
      expect.any(Object),
    );
  });

  it('бросает, если входной файл не задан ни связью, ни узлом', async () => {
    await expect(
      executor.executeToolAsync(
        toolNode({ operation: 'upscale', model: 'upscale-model' }),
        {},
        RUN_ID,
      ),
    ).rejects.toThrow('Не задан входной файл');

    expect(provider.applyToolAsync).not.toHaveBeenCalled();
  });

  it('бросает у операции без дефолтной модели и без выбора пользователя', async () => {
    await expect(
      executor.executeToolAsync(
        toolNode({ operation: 'chromakey', model: undefined }),
        { url: INPUT_URL },
        RUN_ID,
      ),
    ).rejects.toThrow('не выбрана модель');
  });

  it('бросает, если модель не объявлена каталогом провайдера', async () => {
    await expect(
      executor.executeToolAsync(
        toolNode({ operation: 'upscale', model: 'нет-такой-модели' }),
        { url: INPUT_URL },
        RUN_ID,
      ),
    ).rejects.toThrow('не найдена в каталоге media');

    expect(provider.applyToolAsync).not.toHaveBeenCalled();
  });

  it('неизвестная операция в data → NodeDataValidationException (Zod)', async () => {
    const error = await executor
      .executeToolAsync(toolNode({ operation: 'teleport' }), { url: INPUT_URL }, RUN_ID)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NodeDataValidationException);
    expect((error as Error).message).toContain('operation');
  });

  it('передаёт промпт, аудио и скалярные параметры операции', async () => {
    await executor.executeToolAsync(
      toolNode({
        operation: 'lipsync',
        model: 'kling-lipsync',
        params: {
          prompt: 'говори как диктор',
          audioUrl: 'https://cdn.example.com/voice.mp3',
          duration: 5,
          мусор: { nested: true },
        },
      }),
      { url: INPUT_URL },
      RUN_ID,
    );

    expect(provider.applyToolAsync).toHaveBeenCalledWith(
      INPUT_URL,
      'lipsync',
      {
        prompt: 'говори как диктор',
        audioUrl: 'https://cdn.example.com/voice.mp3',
        duration: 5,
        model: 'kling-lipsync',
        idempotencyKey: `${RUN_ID}:tool-1`,
      },
    );
  });

  it('KI-369: невалидный audioUrl отклоняется Zod до платного вызова', async () => {
    const error = await executor
      .executeToolAsync(
        toolNode({
          operation: 'lipsync',
          model: 'kling-lipsync',
          params: { audioUrl: 'not-a-url' },
        }),
        { url: INPUT_URL },
        RUN_ID,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NodeDataValidationException);
    expect((error as Error).message).toContain('audioUrl');
    expect(provider.applyToolAsync).not.toHaveBeenCalled();
  });

  it('KI-369: пустой audioUrl из UI считается «не задано»', async () => {
    await executor.executeToolAsync(
      toolNode({
        operation: 'lipsync',
        model: 'kling-lipsync',
        params: { audioUrl: '' },
      }),
      { url: INPUT_URL },
      RUN_ID,
    );

    // Пустая строка не проходит в params: провайдер сам сообщит, что аудио нет.
    expect(provider.applyToolAsync).toHaveBeenCalledWith(
      INPUT_URL,
      'lipsync',
      expect.not.objectContaining({ audioUrl: expect.anything() }),
    );
  });

  it('опрашивает задачу, если инструмент не успел за окно wait', async () => {
    vi.useFakeTimers();

    provider.applyToolAsync.mockResolvedValue(task({ status: 'running' }));
    registry.getTaskAsync
      .mockResolvedValueOnce(task({ status: 'running' }))
      .mockResolvedValueOnce(
        task({ status: 'done', resultUrls: ['https://cdn.example.com/up.png'] }),
      );

    const pending = executor.executeToolAsync(
      toolNode({ operation: 'upscale', model: 'upscale-model' }),
      { url: INPUT_URL },
      RUN_ID,
    );

    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(3_000);

    const result = await pending;

    expect(registry.getTaskAsync).toHaveBeenCalledTimes(2);
    expect(result.outputs.resultUrls).toEqual(['https://cdn.example.com/up.png']);
  });

  it('упавшая задача инструмента → MediaProviderException с причиной upstream', async () => {
    provider.applyToolAsync.mockResolvedValue(
      task({ status: 'failed', error: 'модель недоступна', resultUrls: [] }),
    );

    await expect(
      executor.executeToolAsync(
        toolNode({ operation: 'upscale', model: 'upscale-model' }),
        { url: INPUT_URL },
        RUN_ID,
      ),
    ).rejects.toThrow('модель недоступна');
  });

  it('проверяет бюджет перед вызовом провайдера (KI-048)', async () => {
    await executor.executeToolAsync(
      toolNode({ operation: 'upscale', model: 'upscale-model' }),
      { url: INPUT_URL },
      RUN_ID,
    );

    // Оценка — цена модели из каталога (upscale-model: 25 ₽).
    expect(budget.assertWithinBudgetAsync).toHaveBeenCalledWith(RUN_ID, { rub: 25 });
  });

  it('превышение бюджета → BudgetExceededException и провайдер не вызывается', async () => {
    budget.assertWithinBudgetAsync.mockRejectedValue(
      new BudgetExceededException(25, 3),
    );

    const error = await executor
      .executeToolAsync(
        toolNode({ operation: 'upscale', model: 'upscale-model' }),
        { url: INPUT_URL },
        RUN_ID,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BudgetExceededException);
    expect((error as Error).message).toBe(
      'Budget exceeded (estimated: $25.0000, remaining: $3.0000)',
    );
    expect(provider.applyToolAsync).not.toHaveBeenCalled();
  });

  it('пробрасывает ошибку провайдера без подмены', async () => {
    provider.applyToolAsync.mockRejectedValue(
      new MediaProviderException('creativelab', 'ключ media API не принят'),
    );

    await expect(
      executor.executeToolAsync(
        toolNode({ operation: 'upscale', model: 'upscale-model' }),
        { url: INPUT_URL },
        RUN_ID,
      ),
    ).rejects.toThrow('ключ media API не принят');
  });

  it('проверяет бюджет и у генерации image_generation (оценка — цена модели)', async () => {
    registry.createTaskAsync.mockResolvedValue(
      task({ status: 'done', resultUrls: ['https://cdn.example.com/gen.png'] }),
    );

    await executor.executeAsync(
      {
        id: 'image-1',
        type: 'image_generation',
        data: { model: 'upscale-model' },
      } as NodeDto,
      { prompt: 'кот' },
      RUN_ID,
    );

    expect(budget.assertWithinBudgetAsync).toHaveBeenCalledWith(RUN_ID, { rub: 25 });
  });
});
