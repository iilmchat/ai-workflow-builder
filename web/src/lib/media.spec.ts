import { describe, expect, it } from 'vitest';
// Относительные пути (не `@/`): тестовый конфиг web не задаёт alias —
// см. KI-155. Остальные (компонентные) тесты сюда не попадают.
import { pickDefaultMediaModel, pickDefaultToolModel, pickToolModels } from './media';
import type { MediaInput, MediaModelInfo } from '../types/media';

/**
 * Создаёт входной слот модели (R7.1: `inputs` разбирается по полям).
 *
 * @param required - обязателен ли слот
 * @returns слот входа
 */
function input(required: boolean): MediaInput {
  return { key: 'image', kind: 'image', role: 'reference', required };
}

/**
 * Создаёт модель каталога с минимально нужными полями.
 *
 * @param id - id модели
 * @param overrides - поля, которые нужно переопределить
 * @returns модель каталога
 */
function model(
  id: string,
  overrides: Partial<MediaModelInfo> = {},
): MediaModelInfo {
  return {
    id,
    code: id,
    type: 'IMAGE',
    price: 1,
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

describe('pickDefaultMediaModel (KI-154)', () => {
  it('предпочитает известные text-to-image модели в порядке приоритета', () => {
    // Каталог в алфавитном порядке, как его отдаёт CreativeLab.
    const catalog = [
      model('bgremover', { prompt: 'required', inputs: [input(true)] }),
      model('flux-schnell'),
      model('flux-dev'),
    ];

    expect(pickDefaultMediaModel(catalog)).toBe('flux-schnell');
  });

  it('берёт dall-e-3, если flux-моделей нет', () => {
    expect(
      pickDefaultMediaModel([model('bgremover'), model('dall-e-3')]),
    ).toBe('dall-e-3');
  });

  it('не выбирает bgremover: у неё обязательный входной файл', () => {
    // Первая в каталоге, но image-to-image — именно она ломала Run (KI-154).
    const catalog = [
      model('bgremover', { inputs: [input(true)] }),
      model('faceswap', { inputs: [input(true)] }),
    ];

    expect(pickDefaultMediaModel(catalog)).not.toBe('bgremover');
    expect(pickDefaultMediaModel(catalog)).toBe('');
  });

  it('иначе берёт первую модель с обязательным промптом и без входов', () => {
    const catalog = [
      model('bgremover', { inputs: [input(true)] }),
      model('di', { inputs: [input(true)] }),
      model('some-new-model'),
    ];

    expect(pickDefaultMediaModel(catalog)).toBe('some-new-model');
  });

  it('пропускает модель, у которой промпт необязателен', () => {
    const catalog = [
      model('upscaler', { prompt: 'none' }),
      model('text-to-image'),
    ];

    expect(pickDefaultMediaModel(catalog)).toBe('text-to-image');
  });

  it('необязательный вход не мешает выбору', () => {
    const catalog = [
      model('flux-schnell', { inputs: [input(false)] }),
    ];

    expect(pickDefaultMediaModel(catalog)).toBe('flux-schnell');
  });

  it('возвращает пустую строку для пустого каталога', () => {
    expect(pickDefaultMediaModel([])).toBe('');
  });

  it('не падает на нестроковом поле required во входах', () => {
    const catalog = [
      model('weird', {
        inputs: [{ required: 'yes' } as unknown as MediaInput],
      }),
      model('normal'),
    ];

    // Строгий разбор: `'yes'` — не `true`, поэтому модель считается без
    // обязательных входов и подходит. Главное — отсутствие исключения.
    expect(() => pickDefaultMediaModel(catalog)).not.toThrow();
    expect(pickDefaultMediaModel(catalog)).toBe('weird');
  });
});

describe('pickToolModels / pickDefaultToolModel (R7.1)', () => {
  it('берёт TOOL-модели, если upstream их размечен', () => {
    const catalog = {
      toolModels: [model('upscale-tool', { type: 'TOOL', inputs: [input(true)] })],
      fallbackModels: [model('bgremover', { inputs: [input(true)] })],
    };

    expect(pickToolModels(catalog).map((item) => item.id)).toEqual([
      'upscale-tool',
      'bgremover',
    ]);
  });

  it('падает на модели с обязательным входом, когда type=TOOL пуст', () => {
    // Реальность R7.1: каталог CreativeLab не отдаёт TOOL — инструменты
    // объявлены обычными моделями с обязательным входным файлом.
    const catalog = {
      toolModels: [],
      fallbackModels: [
        model('flux-schnell'),
        model('bgremover', { inputs: [input(true)] }),
        model('kling-lipsync', { type: 'VIDEO', inputs: [input(true)] }),
      ],
    };

    expect(pickToolModels(catalog).map((item) => item.id)).toEqual([
      'bgremover',
      'kling-lipsync',
    ]);
  });

  it('не дублирует модель, объявленную и как TOOL, и в фолбэке', () => {
    const shared = model('bgremover', { type: 'TOOL', inputs: [input(true)] });

    expect(
      pickToolModels({ toolModels: [shared], fallbackModels: [shared] }),
    ).toHaveLength(1);
  });

  it('дефолт операции bg_removal — bgremover, иначе первая приоритетная', () => {
    const models = [
      model('faceswap', { inputs: [input(true)] }),
      model('bgremover', { inputs: [input(true)] }),
    ];

    expect(pickDefaultToolModel(models, 'bg_removal')).toBe('bgremover');
    expect(pickDefaultToolModel(models, 'upscale')).toBe('bgremover');
    expect(pickDefaultToolModel([], 'upscale')).toBe('');
  });
});
