import { Test } from '@nestjs/testing';
import type { NodeDto } from '../engine/dto/index.js';
import { MediaProviderException } from './media-provider.interface.js';
import type { MediaTaskResult } from './dto/media-task.mapper.js';
import { MediaNodeExecutor } from './media-node-executor.service.js';
import { MediaRegistryService } from './media-registry.service.js';

/** Идентификатор запуска для ключа идемпотентности. */
const RUN_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Создаёт узел `image_generation` с заданными данными.
 *
 * @param data - поля `data` узла
 * @returns узел графа
 */
function imageNode(data: Record<string, unknown> = {}): NodeDto {
  return {
    id: 'image-1',
    type: 'image_generation',
    position: { x: 0, y: 0 },
    data: {
      model: 'flux-schnell',
      params: { aspect_ratio: '1:1' },
      ...data,
    },
  };
}

/**
 * Создаёт результат задачи с заданным статусом.
 *
 * @param overrides - поля, которые нужно переопределить
 * @returns результат задачи
 */
function task(overrides: Partial<MediaTaskResult> = {}): MediaTaskResult {
  return {
    taskId: 'task-1',
    model: 'flux-schnell',
    status: 'queued',
    resultUrls: [],
    costRub: null,
    error: null,
    ...overrides,
  };
}

describe('MediaNodeExecutor', () => {
  let executor: MediaNodeExecutor;
  let registry: {
    createTaskAsync: ReturnType<typeof vi.fn>;
    getTaskAsync: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    registry = {
      createTaskAsync: vi.fn(() => Promise.resolve(task())),
      getTaskAsync: vi.fn(() => Promise.resolve(task())),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MediaNodeExecutor,
        { provide: MediaRegistryService, useValue: registry },
      ],
    }).compile();

    executor = moduleRef.get(MediaNodeExecutor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('бросает при пустом prompt', async () => {
    await expect(
      executor.executeAsync(imageNode({ value: '' }), {}, RUN_ID),
    ).rejects.toThrow('Пустой prompt');
  });

  it('берёт prompt из inputs, а если его нет — из data.value', async () => {
    registry.createTaskAsync.mockResolvedValue(
      task({ status: 'done', resultUrls: ['https://cdn/img.png'], costRub: 0.6 }),
    );

    await executor.executeAsync(imageNode({ value: 'из data' }), {}, RUN_ID);
    expect(registry.createTaskAsync).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'из data' }),
    );

    await executor.executeAsync(
      imageNode({ value: 'из data' }),
      { prompt: 'из inputs' },
      RUN_ID,
    );
    expect(registry.createTaskAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: 'из inputs' }),
    );
  });

  it('KI-166: берёт prompt из data.prompt, если вход пуст', async () => {
    registry.createTaskAsync.mockResolvedValue(
      task({ status: 'done', resultUrls: ['https://cdn/img.png'], costRub: 0.6 }),
    );

    await executor.executeAsync(
      imageNode({ prompt: 'промпт из узла' }),
      {},
      RUN_ID,
    );

    expect(registry.createTaskAsync).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'промпт из узла' }),
    );
  });

  it('KI-166: вход важнее data.prompt', async () => {
    registry.createTaskAsync.mockResolvedValue(
      task({ status: 'done', resultUrls: ['https://cdn/img.png'], costRub: 0.6 }),
    );

    await executor.executeAsync(
      imageNode({ prompt: 'промпт из узла' }),
      { prompt: 'промпт из связи' },
      RUN_ID,
    );

    expect(registry.createTaskAsync).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'промпт из связи' }),
    );
  });

  it('KI-166: старый формат (data.value) продолжает работать', async () => {
    registry.createTaskAsync.mockResolvedValue(
      task({ status: 'done', resultUrls: ['https://cdn/img.png'], costRub: 0.6 }),
    );

    // Workflow, сохранённый до появления data.prompt.
    await executor.executeAsync(imageNode({ value: 'старый промпт' }), {}, RUN_ID);

    expect(registry.createTaskAsync).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'старый промпт' }),
    );
  });

  it('KI-166: пустой data.prompt не перекрывает data.value', async () => {
    registry.createTaskAsync.mockResolvedValue(
      task({ status: 'done', resultUrls: ['https://cdn/img.png'], costRub: 0.6 }),
    );

    await executor.executeAsync(
      imageNode({ prompt: '', value: 'запасной промпт' }),
      {},
      RUN_ID,
    );

    expect(registry.createTaskAsync).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'запасной промпт' }),
    );
  });

  it('бросает при пустой модели', async () => {
    await expect(
      executor.executeAsync(imageNode({ model: '' }), { prompt: 'кот' }, RUN_ID),
    ).rejects.toThrow('Не задана модель media-узла');
  });

  it('создаёт задачу с ключом идемпотентности runId:nodeId', async () => {
    registry.createTaskAsync.mockResolvedValue(
      task({ status: 'done', resultUrls: ['https://cdn/img.png'], costRub: 0.6 }),
    );

    await executor.executeAsync(imageNode(), { prompt: 'кот' }, RUN_ID);

    expect(registry.createTaskAsync).toHaveBeenCalledWith({
      model: 'flux-schnell',
      prompt: 'кот',
      params: { aspect_ratio: '1:1' },
      idempotencyKey: `${RUN_ID}:image-1`,
      wait: true,
    });
  });

  it('задача сразу done → outputs.mediaUrl и costRub заполнены', async () => {
    registry.createTaskAsync.mockResolvedValue(
      task({ status: 'done', resultUrls: ['https://cdn/img.png'], costRub: 0.6 }),
    );

    const result = await executor.executeAsync(
      imageNode(),
      { prompt: 'кот в шляпе' },
      RUN_ID,
    );

    expect(result.outputs).toEqual({
      mediaUrl: 'https://cdn/img.png',
      mediaType: 'IMAGE',
      taskId: 'task-1',
    });
    expect(result.metrics).toEqual({
      costRub: 0.6,
      mediaType: 'IMAGE',
      taskId: 'task-1',
    });
    // Задача уже завершена — опрос не нужен.
    expect(registry.getTaskAsync).not.toHaveBeenCalled();
  });

  it('опрашивает задачу с backoff до статуса done', async () => {
    vi.useFakeTimers();

    registry.createTaskAsync.mockResolvedValue(task({ status: 'running' }));
    registry.getTaskAsync
      .mockResolvedValueOnce(task({ status: 'running' }))
      .mockResolvedValueOnce(task({ status: 'running' }))
      .mockResolvedValueOnce(
        task({ status: 'done', resultUrls: ['https://cdn/done.png'], costRub: 0.6 }),
      );

    const pending = executor.executeAsync(imageNode(), { prompt: 'кот' }, RUN_ID);

    // Прогоняем таймеры: 2 c → 3 c → 4.5 c (backoff ×1.5).
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.advanceTimersByTimeAsync(5_000);

    const result = await pending;

    expect(registry.getTaskAsync).toHaveBeenCalledTimes(3);
    expect(result.outputs.mediaUrl).toBe('https://cdn/done.png');
    expect(result.metrics.costRub).toBe(0.6);
  });

  it('задача failed → бросает с причиной из upstream', async () => {
    registry.createTaskAsync.mockResolvedValue(
      task({ status: 'failed', error: 'moderation rejected' }),
    );

    await expect(
      executor.executeAsync(imageNode(), { prompt: 'кот' }, RUN_ID),
    ).rejects.toThrow('moderation rejected');
  });

  it('истёк общий таймаут ожидания → MediaProviderException', async () => {
    vi.useFakeTimers();

    registry.createTaskAsync.mockResolvedValue(task({ status: 'running' }));
    registry.getTaskAsync.mockResolvedValue(task({ status: 'running' }));

    const pending = executor.executeAsync(imageNode(), { prompt: 'кот' }, RUN_ID);
    // Ловим отказ заранее, иначе необработанный reject уронит тест.
    const guarded = pending.catch((caught: unknown) => caught);

    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);

    const error = await guarded;

    expect(error).toBeInstanceOf(MediaProviderException);
    expect((error as MediaProviderException).message).toContain('не завершилась за 300 с');
  });

  it('пробрасывает ошибку провайдера без подмены', async () => {
    registry.createTaskAsync.mockRejectedValue(
      new MediaProviderException('creativelab', 'ключ media API не принят'),
    );

    await expect(
      executor.executeAsync(imageNode(), { prompt: 'кот' }, RUN_ID),
    ).rejects.toThrow('ключ media API не принят');
  });

  it('поддерживает data.params и fallback на data.aspectRatio', async () => {
    registry.createTaskAsync.mockResolvedValue(
      task({ status: 'done', resultUrls: ['https://cdn/img.png'] }),
    );

    await executor.executeAsync(
      imageNode({ params: { resolution: '1024x1024', nsfw: false } }),
      { prompt: 'кот' },
      RUN_ID,
    );

    expect(registry.createTaskAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        params: { resolution: '1024x1024', nsfw: false },
      }),
    );

    await executor.executeAsync(
      imageNode({ params: undefined, aspectRatio: '16:9' }),
      { prompt: 'кот' },
      RUN_ID,
    );

    expect(registry.createTaskAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: { aspect_ratio: '16:9' } }),
    );
  });

  it('учитывает data.mediaType для метрик', async () => {
    registry.createTaskAsync.mockResolvedValue(
      task({ status: 'done', resultUrls: ['https://cdn/video.mp4'] }),
    );

    const result = await executor.executeAsync(
      imageNode({ mediaType: 'VIDEO' }),
      { prompt: 'кот' },
      RUN_ID,
    );

    expect(result.metrics.mediaType).toBe('VIDEO');
  });
});
