import { describe, expect, it } from 'vitest';
import {
  GENERATION_MEDIA_TYPE_BY_NODE,
  GENRE_PARAM_KEYS,
  isTtsModel,
  paramOptions,
  paramSelectValue,
  parseNumberField,
  pickDeclaredParam,
  pickDefaultGenerationModel,
  pickGenerationModels,
  VOICE_PARAM_KEYS,
  type GenerationMediaType,
} from './generation-node';
import type { MediaModelInfo } from '@/types/media';

/**
 * Юнит-тесты чистой логики узлов media-генерации R7.2 (KI-361).
 *
 * Каталог-заглушка повторяет реальный CreativeLab там, где это влияет на
 * решения: `type=AUDIO` пуст, TTS-модель `tts2` лежит в `MUSIC`, а `duration`
 * объявлен enum со строковыми значениями.
 */

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

/** Модели, как их отдаёт реальный каталог CreativeLab (сокращённо). */
const CATALOG: readonly MediaModelInfo[] = [
  model('wan-2.5', {
    type: 'VIDEO',
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
      },
    ],
    inputs: [{ key: 'first_frame', kind: 'image', required: false }],
  }),
  model('kling-v3-motion', {
    type: 'VIDEO',
    // Инструмент, а не text-to-video: обязательный вход.
    inputs: [{ key: 'image', kind: 'image', required: true }],
  }),
  model('tts2', {
    type: 'MUSIC',
    price: 0,
    priceUnit: null,
    params: [{ key: 'voice', type: 'string', label: 'voice' }],
  }),
  model('suno', { type: 'MUSIC', price: 24 }),
  model('grom-zvuk', {
    type: 'MUSIC',
    params: [{ key: 'tags', type: 'string', label: 'tags' }],
  }),
  model('flux-schnell', { type: 'IMAGE' }),
];

describe('generation-node: каталог по типу (R7.2)', () => {
  it('VIDEO/MUSIC — модели своего типа', () => {
    expect(pickGenerationModels(CATALOG, 'VIDEO').map((item) => item.id)).toEqual([
      'wan-2.5',
      'kling-v3-motion',
    ]);
    expect(pickGenerationModels(CATALOG, 'MUSIC').map((item) => item.id)).toEqual([
      'tts2',
      'suno',
      'grom-zvuk',
    ]);
  });

  it('AUDIO: каталог пуст — берутся TTS-модели из MUSIC', () => {
    const audio = pickGenerationModels(CATALOG, 'AUDIO');

    // Только `tts2` объявляет голосовой параметр; `suno`/`grom-zvuk` — музыка.
    expect(audio.map((item) => item.id)).toEqual(['tts2']);
    expect(isTtsModel(model('x', { type: 'AUDIO' }))).toBe(false);
  });
});

describe('generation-node: модель по умолчанию (R7.2)', () => {
  it('берёт предпочтительный id, а не первую модель каталога', () => {
    expect(pickDefaultGenerationModel(pickGenerationModels(CATALOG, 'VIDEO'), 'VIDEO')).toBe(
      'wan-2.5',
    );
    expect(
      pickDefaultGenerationModel(pickGenerationModels(CATALOG, 'AUDIO'), 'AUDIO'),
    ).toBe('tts2');
  });

  it('без известных id выбирает модель без обязательных входов', () => {
    const models = [
      model('tool-with-input', {
        type: 'VIDEO',
        inputs: [{ key: 'image', kind: 'image', required: true }],
      }),
      model('text-to-video', { type: 'VIDEO' }),
    ] as const;

    expect(pickDefaultGenerationModel(models, 'VIDEO')).toBe('text-to-video');
  });

  it('пустой каталог → пустая строка (подставит backend)', () => {
    const emptyType: GenerationMediaType = 'MUSIC';

    expect(pickDefaultGenerationModel([], emptyType)).toBe('');
  });
});

describe('generation-node: объявленные параметры (R7.2)', () => {
  const video = CATALOG[0] as MediaModelInfo;

  it('находит параметр по возможным ключам и отдаёт варианты', () => {
    const duration = pickDeclaredParam(video, ['duration']);

    expect(duration?.key).toBe('duration');
    expect(paramOptions(duration!)).toEqual(['5', '10']);
    // Модель, которая параметра не объявляет, поля в UI не получает (KI-181).
    expect(pickDeclaredParam(video, ['speed'])).toBeUndefined();
    expect(pickDeclaredParam(undefined, ['duration'])).toBeUndefined();
  });

  it('значение селекта: выбор пользователя → дефолт → первый вариант', () => {
    const duration = pickDeclaredParam(video, ['duration'])!;
    const aspectRatio = pickDeclaredParam(video, ['aspect_ratio'])!;

    expect(paramSelectValue(duration, 10)).toBe('10');
    expect(paramSelectValue(duration, undefined)).toBe('5');
    // У `aspect_ratio` дефолта нет — берётся первый вариант.
    expect(paramSelectValue(aspectRatio, undefined)).toBe('auto');
    expect(paramSelectValue(aspectRatio, '16:9')).toBe('16:9');
  });

  it('ключи голоса и жанра совпадают с backend-контрактом', () => {
    expect(VOICE_PARAM_KEYS).toEqual(['voice', 'voice_id']);
    expect(GENRE_PARAM_KEYS).toEqual(['genre', 'tags']);
  });

  it('parseNumberField: пусто и мусор → undefined (KI-129)', () => {
    expect(parseNumberField('5')).toBe(5);
    expect(parseNumberField('1.5')).toBe(1.5);
    expect(parseNumberField('')).toBeUndefined();
    expect(parseNumberField('abc')).toBeUndefined();
  });

  it('тип media-модели выводится из типа узла', () => {
    expect(GENERATION_MEDIA_TYPE_BY_NODE.video_generation).toBe('VIDEO');
    expect(GENERATION_MEDIA_TYPE_BY_NODE.audio_generation).toBe('AUDIO');
    expect(GENERATION_MEDIA_TYPE_BY_NODE.music_generation).toBe('MUSIC');
    expect(GENERATION_MEDIA_TYPE_BY_NODE.llm).toBeUndefined();
  });
});
