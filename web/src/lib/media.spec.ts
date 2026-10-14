import { describe, expect, it } from 'vitest';
// Относительные пути (не `@/`): тестовый конфиг web не задаёт alias —
// см. KI-155. Остальные (компонентные) тесты сюда не попадают.
import { pickDefaultMediaModel } from './media';
import type { MediaModelInfo } from '../types/media';

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
      model('bgremover', { prompt: 'required', inputs: [{ required: true }] }),
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
      model('bgremover', { inputs: [{ required: true }] }),
      model('faceswap', { inputs: [{ required: true }] }),
    ];

    expect(pickDefaultMediaModel(catalog)).not.toBe('bgremover');
    expect(pickDefaultMediaModel(catalog)).toBe('');
  });

  it('иначе берёт первую модель с обязательным промптом и без входов', () => {
    const catalog = [
      model('bgremover', { inputs: [{ required: true }] }),
      model('di', { inputs: [{ required: true }] }),
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
      model('flux-schnell', { inputs: [{ required: false }] }),
    ];

    expect(pickDefaultMediaModel(catalog)).toBe('flux-schnell');
  });

  it('возвращает пустую строку для пустого каталога', () => {
    expect(pickDefaultMediaModel([])).toBe('');
  });

  it('не падает на нестроковом поле required во входах', () => {
    const catalog = [
      model('weird', { inputs: [{ required: 'yes' }] }),
      model('normal'),
    ];

    // Строгий разбор: `'yes'` — не `true`, поэтому модель считается без
    // обязательных входов и подходит. Главное — отсутствие исключения.
    expect(() => pickDefaultMediaModel(catalog)).not.toThrow();
    expect(pickDefaultMediaModel(catalog)).toBe('weird');
  });
});
