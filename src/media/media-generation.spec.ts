import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NodeDto } from '../engine/dto/index.js';
import { NodeDataValidationException } from '../engine/node-executors.js';
import {
  BudgetExceededException,
  CostBudgetService,
} from '../runs/cost-budget.service.js';
import type { MediaTaskResult } from './dto/media-task.mapper.js';
import { MediaNodeExecutor } from './media-node-executor.service.js';
import { MEDIA_PROVIDERS, MediaRegistryService } from './media-registry.service.js';
import {
  MediaProviderException,
  type MediaModelInfo,
  type MediaType,
} from './media-provider.interface.js';

/**
 * Юнит-тесты узлов media-генерации R7.2 (KI-361, DESIGN v0.9 § 3.2):
 * `video_generation`, `audio_generation`, `music_generation`.
 *
 * Каталог-заглушка повторяет **реальный** CreativeLab там, где это важно для
 * логики:
 * - `type=AUDIO` пуст, TTS-модель `tts2` объявлена как `MUSIC` (фолбэк);
 * - `duration`/`aspect_ratio` — enum со **строковыми** значениями;
 * - у video-модели слот картинки называется `first_frame`, у другой — `image`.
 */

/** Идентификатор запуска для ключа идемпотентности. */
const RUN_ID = '11111111-1111-4111-8111-111111111111';

/** Ссылка на входное изображение (только http(s) — KI-006). */
const IMAGE_URL = 'https://cdn.example.com/frame.png';

/**
 * Создаёт модель каталога.
 *
 * @param id - id модели
 * @param overrides - поля, которые нужно переопределить
 * @returns описание модели
 */
function model(
  id: string,
  overrides: Partial<MediaModelInfo> = {},
): MediaModelInfo {
  return {
    id,
    code: id,
    type: 'VIDEO',
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

/** Каталог VIDEO: цены и схемы — как в реальном CreativeLab. */
const VIDEO_MODELS: readonly MediaModelInfo[] = [
  model('wan-2.5', {
    type: 'VIDEO',
    price: 55,
    params: [
      {
        key: 'resolution',
        type: 'enum',
        label: 'resolution',
        options: [
          { value: '720p', label: '720p' },
          { value: '1080p', label: '1080p' },
        ],
        default: '720p',
      },
      {
        key: 'duration',
        type: 'enum',
        label: 'duration',
        options: [
          { value: '5', label: '5' },
          { value: '10', label: '10' },
        ],
        default: '5',
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'aspect_ratio',
        options: [
          { value: 'auto', label: 'auto' },
          { value: '16:9', label: '16:9' },
        ],
        default: 'auto',
      },
    ],
    inputs: [
      { key: 'first_frame', kind: 'image', role: 'first_frame', required: false },
    ],
  }),
  model('kling-v3-motion', {
    type: 'VIDEO',
    price: 10.5,
    prompt: 'optional',
    inputs: [
      { key: 'image', kind: 'image', role: 'reference', required: true },
      { key: 'video', kind: 'video', role: 'edit_source', required: true },
    ],
  }),
];

/** Каталог MUSIC: TTS-модель (`tts2`) и генераторы музыки. */
const MUSIC_MODELS: readonly MediaModelInfo[] = [
  model('tts2', {
    type: 'MUSIC',
    price: 0,
    priceUnit: null,
    params: [{ key: 'voice', type: 'string', label: 'voice' }],
  }),
  model('grom-zvuk', {
    type: 'MUSIC',
    price: 6,
    prompt: 'optional',
    params: [
      { key: 'is_custom', type: 'boolean', label: 'is_custom' },
      { key: 'tags', type: 'string', label: 'tags' },
      { key: 'title', type: 'string', label: 'title' },
    ],
    inputs: [{ key: 'audio', kind: 'audio', role: 'reference', required: false }],
  }),
  model('minimax-music', { type: 'MUSIC', price: 30 }),
];

/**
 * Создаёт узел media-генерации.
 *
 * @param type - тип узла
 * @param data - поля `data` узла
 * @returns узел графа
 */
function node(type: string, data: Record<string, unknown> = {}): NodeDto {
  return { id: `${type}-1`, type, position: { x: 0, y: 0 }, data };
}

/**
 * Создаёт результат задачи.
 *
 * @param overrides - поля, которые нужно переопределить
 * @returns результат задачи
 */
function task(overrides: Partial<MediaTaskResult> = {}): MediaTaskResult {
  return {
    taskId: 'task-1',
    model: 'wan-2.5',
    status: 'done',
    resultUrls: ['https://cdn.example.com/out.mp4'],
    costRub: 55,
    error: null,
    ...overrides,
  };
}

describe('MediaNodeExecutor: media-генерация R7.2 (KI-361)', () => {
  let executor: MediaNodeExecutor;
  let registry: {
    createTaskAsync: ReturnType<typeof vi.fn>;
    getTaskAsync: ReturnType<typeof vi.fn>;
    findParamsAsync: ReturnType<typeof vi.fn>;
    findModelAsync: ReturnType<typeof vi.fn>;
    listModelsAsync: ReturnType<typeof vi.fn>;
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
    const catalog: readonly MediaModelInfo[] = [...VIDEO_MODELS, ...MUSIC_MODELS];
    const byType = (type?: MediaType): readonly MediaModelInfo[] => {
      if (type === undefined) {
        return catalog;
      }

      // Реальность CreativeLab: `type=AUDIO` пуст.
      return catalog.filter((item) => item.type === type);
    };

    registry = {
      createTaskAsync: vi.fn(() => Promise.resolve(task())),
      getTaskAsync: vi.fn(() => Promise.resolve(task())),
      findParamsAsync: vi.fn((modelId: string) =>
        Promise.resolve(catalog.find((item) => item.id === modelId)?.params ?? null),
      ),
      findModelAsync: vi.fn((modelId: string) =>
        Promise.resolve(catalog.find((item) => item.id === modelId) ?? null),
      ),
      listModelsAsync: vi.fn((type?: MediaType) => Promise.resolve(byType(type))),
    };

    provider = {
      name: 'creativelab',
      isConfigured: true,
      listModelsAsync: vi.fn(() => Promise.resolve(catalog)),
      createTaskAsync: vi.fn(() => Promise.resolve(task())),
      getTaskAsync: vi.fn(() => Promise.resolve(task())),
      applyToolAsync: vi.fn(() => Promise.resolve(task())),
    };

    budget = { assertWithinBudgetAsync: vi.fn(() => Promise.resolve()) };

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

  describe('video_generation', () => {
    it('собирает запрос: промпт, enum-параметры по каталогу и выход mediaUrl', async () => {
      const result = await executor.executeVideoAsync(
        node('video_generation', {
          model: 'wan-2.5',
          prompt: 'кот идёт по крыше',
          durationSec: 10,
          aspectRatio: '16:9',
          params: { resolution: '1080p', чужая_опция: 'x' },
        }),
        {},
        RUN_ID,
      );

      expect(registry.createTaskAsync).toHaveBeenCalledWith({
        model: 'wan-2.5',
        prompt: 'кот идёт по крыше',
        params: {
          resolution: '1080p',
          duration: '10',
          aspect_ratio: '16:9',
        },
        idempotencyKey: `${RUN_ID}:video_generation-1`,
        wait: true,
      });

      expect(result.outputs).toEqual({
        mediaUrl: 'https://cdn.example.com/out.mp4',
        mediaType: 'VIDEO',
        taskId: 'task-1',
      });
      expect(result.metrics).toEqual({
        costRub: 55,
        mediaType: 'VIDEO',
        taskId: 'task-1',
      });
    });

    it('без выбранной модели берёт модель по умолчанию из каталога VIDEO', async () => {
      await executor.executeVideoAsync(
        node('video_generation', { prompt: 'закат над морем' }),
        {},
        RUN_ID,
      );

      // `wan-2.5` — первый id из списка предпочтений и есть в каталоге.
      expect(registry.listModelsAsync).toHaveBeenCalledWith('VIDEO');
      expect(registry.createTaskAsync).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'wan-2.5', params: { resolution: '720p', duration: '5', aspect_ratio: 'auto' } }),
      );
    });

    it('imageUrl уходит в объявленный моделью слот картинки (first_frame)', async () => {
      await executor.executeVideoAsync(
        node('video_generation', {
          model: 'wan-2.5',
          prompt: 'оживи кадр',
          imageUrl: IMAGE_URL,
        }),
        {},
        RUN_ID,
      );

      expect(registry.createTaskAsync).toHaveBeenCalledWith(
        expect.objectContaining({ inputs: { first_frame: [IMAGE_URL] } }),
      );
    });

    it('значение вне enum каталога заменяется дефолтом модели', async () => {
      await executor.executeVideoAsync(
        node('video_generation', {
          model: 'wan-2.5',
          prompt: 'кот',
          // У модели допустимы только 5 и 10 секунд.
          durationSec: 7,
        }),
        {},
        RUN_ID,
      );

      expect(registry.createTaskAsync).toHaveBeenCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ duration: '5' }) }),
      );
    });

    it('бросает на пустом промпте до платного вызова', async () => {
      await expect(
        executor.executeVideoAsync(
          node('video_generation', { model: 'wan-2.5' }),
          {},
          RUN_ID,
        ),
      ).rejects.toThrow('Пустой prompt на входе media-узла');

      expect(registry.createTaskAsync).not.toHaveBeenCalled();
    });

    it('бросает, если модель не того типа (IMAGE для VIDEO-узла)', async () => {
      registry.findModelAsync.mockResolvedValue(
        model('flux-schnell', { type: 'IMAGE' }),
      );

      await expect(
        executor.executeVideoAsync(
          node('video_generation', { model: 'flux-schnell', prompt: 'кот' }),
          {},
          RUN_ID,
        ),
      ).rejects.toThrow('требует VIDEO');

      expect(registry.createTaskAsync).not.toHaveBeenCalled();
    });

    it('проверяет бюджет по цене модели из каталога (KI-048)', async () => {
      await executor.executeVideoAsync(
        node('video_generation', { model: 'wan-2.5', prompt: 'кот' }),
        {},
        RUN_ID,
      );

      expect(budget.assertWithinBudgetAsync).toHaveBeenCalledWith(RUN_ID, {
        rub: 55,
      });
    });

    it('превышение бюджета не создаёт задачу', async () => {
      budget.assertWithinBudgetAsync.mockRejectedValue(
        new BudgetExceededException(55, 3),
      );

      await expect(
        executor.executeVideoAsync(
          node('video_generation', { model: 'wan-2.5', prompt: 'кот' }),
          {},
          RUN_ID,
        ),
      ).rejects.toThrow('Budget exceeded');

      expect(registry.createTaskAsync).not.toHaveBeenCalled();
    });

    it('упавшая задача отдаёт причину upstream', async () => {
      registry.createTaskAsync.mockResolvedValue(
        task({ status: 'failed', error: 'модерация отклонила промпт', resultUrls: [] }),
      );

      await expect(
        executor.executeVideoAsync(
          node('video_generation', { model: 'wan-2.5', prompt: 'кот' }),
          {},
          RUN_ID,
        ),
      ).rejects.toThrow('модерация отклонила промпт');
    });

    it('опрашивает задачу, пока не получит done', async () => {
      vi.useFakeTimers();

      registry.createTaskAsync.mockResolvedValue(task({ status: 'running' }));
      registry.getTaskAsync
        .mockResolvedValueOnce(task({ status: 'running' }))
        .mockResolvedValueOnce(
          task({ status: 'done', resultUrls: ['https://cdn.example.com/v.mp4'] }),
        );

      const pending = executor.executeVideoAsync(
        node('video_generation', { model: 'wan-2.5', prompt: 'кот' }),
        {},
        RUN_ID,
      );

      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(3_000);

      const result = await pending;

      expect(registry.getTaskAsync).toHaveBeenCalledTimes(2);
      expect(result.outputs.mediaUrl).toBe('https://cdn.example.com/v.mp4');
    });

    it('data вне схемы → NodeDataValidationException (Zod)', async () => {
      const error = await executor
        .executeVideoAsync(
          node('video_generation', { model: 'wan-2.5', prompt: 'кот', durationSec: 999 }),
          {},
          RUN_ID,
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NodeDataValidationException);
      expect((error as Error).message).toContain('durationSec');
    });

    it('каталог VIDEO пуст → понятная ошибка вместо пустой модели', async () => {
      registry.listModelsAsync.mockResolvedValue([]);

      await expect(
        executor.executeVideoAsync(
          node('video_generation', { prompt: 'кот' }),
          {},
          RUN_ID,
        ),
      ).rejects.toThrow('каталог VIDEO пуст');
    });
  });

  describe('audio_generation', () => {
    it('текст, голос и модель по умолчанию: TTS-модель из MUSIC (AUDIO пуст)', async () => {
      const result = await executor.executeAudioAsync(
        node('audio_generation', {
          text: 'привет, это синтез речи',
          voiceId: 'ru-female-1',
        }),
        {},
        RUN_ID,
      );

      // `tts2` объявлен как MUSIC — фолбэк для AUDIO-узла (реальный каталог).
      expect(registry.listModelsAsync).toHaveBeenCalledWith('AUDIO');
      expect(registry.listModelsAsync).toHaveBeenCalledWith('MUSIC');
      expect(registry.createTaskAsync).toHaveBeenCalledWith({
        model: 'tts2',
        prompt: 'привет, это синтез речи',
        params: { voice: 'ru-female-1' },
        idempotencyKey: `${RUN_ID}:audio_generation-1`,
        wait: true,
      });
      expect(result.metrics.mediaType).toBe('AUDIO');
    });

    it('вход prompt (связь) приоритетнее data.text', async () => {
      await executor.executeAudioAsync(
        node('audio_generation', { text: 'из узла' }),
        { prompt: 'из связи' },
        RUN_ID,
      );

      expect(registry.createTaskAsync).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'из связи' }),
      );
    });

    it('speed не уходит модели, которая его не объявляет (KI-181)', async () => {
      await executor.executeAudioAsync(
        node('audio_generation', { text: 'текст', speed: 1.5 }),
        {},
        RUN_ID,
      );

      expect(registry.createTaskAsync).toHaveBeenCalledWith(
        expect.objectContaining({ params: {} }),
      );
    });

    it('бросает на пустом тексте', async () => {
      await expect(
        executor.executeAudioAsync(node('audio_generation', {}), {}, RUN_ID),
      ).rejects.toThrow('Пустой text на входе media-узла');

      expect(registry.createTaskAsync).not.toHaveBeenCalled();
    });

    it('нет ни AUDIO-, ни TTS-моделей → понятная ошибка', async () => {
      registry.listModelsAsync.mockImplementation((type?: MediaType) =>
        Promise.resolve(
          type === 'AUDIO' || type === 'MUSIC'
            ? []
            : MUSIC_MODELS.filter((item) => item.type === type),
        ),
      );

      await expect(
        executor.executeAudioAsync(
          node('audio_generation', { text: 'текст' }),
          {},
          RUN_ID,
        ),
      ).rejects.toThrow('каталог AUDIO пуст');
    });
  });

  describe('music_generation', () => {
    it('промпт, жанр и длительность уходят только объявленными ключами', async () => {
      const result = await executor.executeMusicAsync(
        node('music_generation', {
          model: 'grom-zvuk',
          prompt: 'энергичный трек',
          genre: 'rock',
          durationSec: 30,
        }),
        {},
        RUN_ID,
      );

      // `grom-zvuk` объявляет `tags`, но не `duration`/`genre`: длительность
      // отсеивается фильтром, жанр доезжает как `tags`, а параметры без
      // значения (`is_custom`, `title`) в запрос не попадают вовсе.
      expect(registry.createTaskAsync).toHaveBeenCalledWith({
        model: 'grom-zvuk',
        prompt: 'энергичный трек',
        params: { tags: 'rock' },
        idempotencyKey: `${RUN_ID}:music_generation-1`,
        wait: true,
      });
      expect(result.outputs).toEqual({
        mediaUrl: 'https://cdn.example.com/out.mp4',
        mediaType: 'MUSIC',
        taskId: 'task-1',
      });
      expect(result.metrics.mediaType).toBe('MUSIC');
    });

    it('без модели берёт предпочтительную MUSIC-модель, а не первую в каталоге', async () => {
      await executor.executeMusicAsync(
        node('music_generation', { prompt: 'спокойный эмбиент' }),
        {},
        RUN_ID,
      );

      // Первая в каталоге — `tts2` (синтез речи, не музыка): дефолт обязан
      // выбираться по списку предпочтений (`minimax-music`).
      expect(registry.createTaskAsync).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'minimax-music' }),
      );
    });

    it('промпт из связи приоритетнее data.prompt', async () => {
      await executor.executeMusicAsync(
        node('music_generation', { model: 'minimax-music', prompt: 'из узла' }),
        { prompt: 'из связи' },
        RUN_ID,
      );

      expect(registry.createTaskAsync).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'minimax-music', prompt: 'из связи', params: {} }),
      );
    });
  });

  describe('лимит ожидания задачи (R7.2)', () => {
    it('берёт CREATIVELAB_MEDIA_TIMEOUT_MS из конфига', async () => {
      vi.useFakeTimers();

      const moduleRef = await Test.createTestingModule({
        providers: [
          MediaNodeExecutor,
          { provide: MediaRegistryService, useValue: registry },
          { provide: MEDIA_PROVIDERS, useValue: [provider] },
          { provide: CostBudgetService, useValue: budget },
          {
            provide: ConfigService,
            useValue: { get: vi.fn(() => 1_000) },
          },
        ],
      }).compile();
      const configured = moduleRef.get(MediaNodeExecutor);

      registry.createTaskAsync.mockResolvedValue(task({ status: 'running' }));
      registry.getTaskAsync.mockResolvedValue(task({ status: 'running' }));

      const guarded = configured
        .executeMusicAsync(
          node('music_generation', { prompt: 'трек' }),
          {},
          RUN_ID,
        )
        .catch((caught: unknown) => caught);

      await vi.advanceTimersByTimeAsync(5_000);

      const error = await guarded;

      expect(error).toBeInstanceOf(MediaProviderException);
      expect((error as Error).message).toContain('не завершилась за 1 с');
    });
  });
});
