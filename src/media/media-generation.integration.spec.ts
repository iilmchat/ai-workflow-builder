import { Test } from '@nestjs/testing';
import type { NodeDto } from '../engine/dto/index.js';
import { CostBudgetService } from '../runs/cost-budget.service.js';
import type { MediaTaskResult } from './dto/media-task.mapper.js';
import { MediaNodeExecutor } from './media-node-executor.service.js';
import { MEDIA_PROVIDERS, MediaRegistryService } from './media-registry.service.js';
import {
  MediaProviderException,
  type CreateMediaTaskInput,
  type IMediaProvider,
  type MediaModelInfo,
  type MediaType,
} from './media-provider.interface.js';

/**
 * Интеграционные тесты R7.2 (KI-361): узлы `video_generation`,
 * `audio_generation`, `music_generation` целиком — **реальный**
 * `MediaNodeExecutor` + **реальный** `MediaRegistryService` + мок-провайдер.
 *
 * Юниты (`media-generation.spec.ts`) проверяют логику узла на заглушке реестра,
 * а здесь проверяется связка: реестр находит модель по каталогу провайдера,
 * отдаёт её параметры (`findParamsAsync`) и маршрутизирует задачу
 * (`createTaskAsync`) — то, что в юните подменено моками. Поэтому запрос
 * проверяется в том виде, в каком его получил бы настоящий CreativeLab
 * (`POST /media/tasks`).
 */

/** Идентификатор запуска для ключа идемпотентности. */
const RUN_ID = '11111111-1111-4111-8111-111111111111';

/** Ссылка на входное изображение для image-to-video. */
const IMAGE_URL = 'https://cdn.example.com/frame.png';

/**
 * Создаёт модель каталога.
 *
 * @param id - id модели
 * @param type - тип модели
 * @param overrides - поля, которые нужно переопределить
 * @returns описание модели
 */
function model(
  id: string,
  type: MediaType,
  overrides: Partial<MediaModelInfo> = {},
): MediaModelInfo {
  return {
    id,
    code: id,
    type,
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
 * Каталог мок-провайдера: схемы повторяют реальный CreativeLab.
 *
 * `type=AUDIO` намеренно пуст (как у upstream), TTS-модель `tts2` лежит в
 * MUSIC — интеграционный тест обязан пройти тот же фолбэк, что и продакшен.
 */
const CATALOG: readonly MediaModelInfo[] = [
  model('wan-2.5', 'VIDEO', {
    price: 55,
    params: [
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
  model('tts2', 'MUSIC', {
    price: 0,
    priceUnit: null,
    params: [{ key: 'voice', type: 'string', label: 'voice' }],
  }),
  model('grom-zvuk', 'MUSIC', {
    price: 6,
    prompt: 'optional',
    params: [{ key: 'tags', type: 'string', label: 'tags' }],
  }),
];

/** Результат задачи, который отдаёт мок-провайдер. */
const TASK_RESULT: MediaTaskResult = {
  taskId: 'task-77',
  model: 'wan-2.5',
  status: 'done',
  resultUrls: ['https://cdn.example.com/media.bin'],
  costRub: 55,
  error: null,
};

describe('media-генерация R7.2: исполнитель + реестр + мок-провайдер', () => {
  /** Запросы, которые получил мок-провайдер. */
  let created: CreateMediaTaskInput[];

  /**
   * Собирает исполнителя с реальным реестром и мок-провайдером.
   *
   * @returns исполнитель медиа-узлов
   */
  async function createExecutor(): Promise<MediaNodeExecutor> {
    created = [];

    const provider: IMediaProvider = {
      name: 'creativelab',
      isConfigured: true,
      listModelsAsync: (type?: MediaType) =>
        Promise.resolve(
          type === undefined
            ? CATALOG
            : CATALOG.filter((item) => item.type === type),
        ),
      createTaskAsync: (input: CreateMediaTaskInput) => {
        created.push(input);

        return Promise.resolve(TASK_RESULT);
      },
      getTaskAsync: () => Promise.resolve(TASK_RESULT),
      applyToolAsync: () =>
        Promise.reject(new MediaProviderException('creativelab', 'не нужен в тесте')),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MediaNodeExecutor,
        MediaRegistryService,
        { provide: MEDIA_PROVIDERS, useValue: [provider] },
        {
          provide: CostBudgetService,
          useValue: { assertWithinBudgetAsync: vi.fn(() => Promise.resolve()) },
        },
      ],
    }).compile();

    return moduleRef.get(MediaNodeExecutor);
  }

  /**
   * Создаёт узел media-генерации.
   *
   * @param type - тип узла
   * @param data - поля `data` узла
   * @returns узел графа
   */
  function node(type: string, data: Record<string, unknown>): NodeDto {
    return { id: `${type}-1`, type, position: { x: 0, y: 0 }, data };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('video_generation: модель, enum-параметры и слот картинки уходят в один запрос', async () => {
    const executor = await createExecutor();

    const result = await executor.executeVideoAsync(
      node('video_generation', {
        model: 'wan-2.5',
        prompt: 'кот идёт по крыше',
        durationSec: 10,
        aspectRatio: '16:9',
        imageUrl: IMAGE_URL,
      }),
      {},
      RUN_ID,
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toEqual({
      model: 'wan-2.5',
      prompt: 'кот идёт по крыше',
      params: { duration: '10', aspect_ratio: '16:9' },
      inputs: { first_frame: [IMAGE_URL] },
      idempotencyKey: `${RUN_ID}:video_generation-1`,
      wait: true,
    });
    expect(result.outputs).toEqual({
      mediaUrl: 'https://cdn.example.com/media.bin',
      mediaType: 'VIDEO',
      taskId: 'task-77',
    });
    expect(result.metrics.costRub).toBe(55);
  });

  it('audio_generation: TTS-модель находится в MUSIC, голос доезжает параметром', async () => {
    const executor = await createExecutor();

    const result = await executor.executeAudioAsync(
      node('audio_generation', { text: 'привет, мир', voiceId: 'ru-1' }),
      {},
      RUN_ID,
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toEqual({
      model: 'tts2',
      prompt: 'привет, мир',
      params: { voice: 'ru-1' },
      idempotencyKey: `${RUN_ID}:audio_generation-1`,
      wait: true,
    });
    expect(result.outputs.mediaType).toBe('AUDIO');
  });

  it('music_generation: жанр уходит объявленным ключом (tags), модель — из каталога', async () => {
    const executor = await createExecutor();

    const result = await executor.executeMusicAsync(
      node('music_generation', { prompt: 'энергичный трек', genre: 'rock' }),
      {},
      RUN_ID,
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toEqual({
      // `grom-zvuk` — единственная MUSIC-модель каталога без обязательных
      // входов после предпочтений (suno/mureka/minimax-music отсутствуют).
      model: 'grom-zvuk',
      prompt: 'энергичный трек',
      params: { tags: 'rock' },
      idempotencyKey: `${RUN_ID}:music_generation-1`,
      wait: true,
    });
    expect(result.outputs).toEqual({
      mediaUrl: 'https://cdn.example.com/media.bin',
      mediaType: 'MUSIC',
      taskId: 'task-77',
    });
  });
});
