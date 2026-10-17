import type {
  MediaModelInfo,
  MediaPricing,
} from '../media/media-provider.interface.js';
import { calculateMediaCostEstimate } from './cost-budget.service.js';

/**
 * Собирает описание модели с заданным тарифом (KI-384).
 *
 * Поля, не относящиеся к тарифу, заполнены минимально валидными значениями:
 * оценке стоимости они не нужны.
 *
 * @param overrides - поля модели, которые нужно переопределить
 * @returns модель из каталога
 */
function model(overrides: Partial<MediaModelInfo> = {}): MediaModelInfo {
  return {
    id: 'test-model',
    code: 'test-model',
    type: 'VIDEO',
    price: 100,
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
 * Собирает модель с блоком `pricing`.
 *
 * @param pricing - блок тарификации из каталога
 * @param overrides - прочие поля модели
 * @returns модель из каталога
 */
function priced(
  pricing: MediaPricing,
  overrides: Partial<MediaModelInfo> = {},
): MediaModelInfo {
  return model({ pricing, ...overrides });
}

describe('calculateMediaCostEstimate (R7.2b, KI-384)', () => {
  it('fixed: фиксированная цена из упрощённого блока', () => {
    expect(
      calculateMediaCostEstimate(priced({ fixed: 42 }), { prompt: 'кот' }),
    ).toBe(42);
  });

  it('cost: фиксированная цена upstream (glabs-veo-3: 960 при price=480)', () => {
    const veo = priced(
      { type: 'fixed', cost: 960 },
      { id: 'glabs-veo-3', price: 480 },
    );

    // Старое поле price недооценивало реальное списание вдвое.
    expect(calculateMediaCostEstimate(veo, { prompt: 'кот' })).toBe(960);
  });

  it('per_second: ставка × durationSec', () => {
    const kling = priced(
      { type: 'per_second', per_second: 33.6 },
      { id: 'kling-v3', price: 210 },
    );

    expect(
      calculateMediaCostEstimate(kling, { prompt: 'кот', durationSec: 5 }),
    ).toBe(168);
  });

  it('per_second: ставка из baseRates выбирается по resolution (kling-v3)', () => {
    const kling = priced(
      {
        type: 'per_second',
        baseBy: 'resolution',
        baseRates: { '720p': 33.6, '1080p': 42 },
        unitParam: 'duration',
      },
      { id: 'kling-v3', price: 210 },
    );

    expect(
      calculateMediaCostEstimate(kling, { resolution: '720p', duration: 5 }),
    ).toBe(168);
    expect(
      calculateMediaCostEstimate(kling, { resolution: '1080p', duration: 5 }),
    ).toBe(210);
  });

  it('per_second: пустой baseBy берёт ставку с пустым ключом (omnihuman)', () => {
    const omnihuman = priced({
      type: 'per_second',
      baseBy: '',
      baseRates: { '': 32 },
      unitParam: 'duration',
    });

    expect(
      calculateMediaCostEstimate(omnihuman, { durationSec: 10, resolution: '1080p' }),
    ).toBe(320);
  });

  it('per_character: ratePer1K × длина текста / 1000 (tts2: 34 символа → 2.04 ₽)', () => {
    const tts = priced(
      { type: 'per_character', ratePer1K: 60 },
      { id: 'tts2', price: 0, priceUnit: null, type: 'MUSIC' },
    );
    const text = 'а'.repeat(34);

    // Реальная форма upstream: ставка лежит на верхнем уровне.
    expect(calculateMediaCostEstimate(tts, { text })).toBe(2.04);
    // Текст может прийти и как `prompt` (связь от Text/LLM-узла).
    expect(calculateMediaCostEstimate(tts, { prompt: text })).toBe(2.04);
    // Кириллица считается по JS-длине строки — той же, что уходит в upstream.
    expect(calculateMediaCostEstimate(tts, { text: 'привет' })).toBe(0.36);

    // Вложенная форма из описания KI-384 тоже поддерживается.
    const nested = priced({
      type: 'per_character',
      per_character: { ratePer1K: 60 },
    });

    expect(calculateMediaCostEstimate(nested, { text })).toBe(2.04);
  });

  it('приоритет: fixed важнее cost, если upstream отдал оба поля', () => {
    expect(
      calculateMediaCostEstimate(priced({ fixed: 10, cost: 960 }), {}),
    ).toBe(10);
  });

  it('приоритет: cost важнее per_second и matrix', () => {
    const both = priced({
      type: 'fixed',
      cost: 25,
      per_second: 10,
      matrix: [{ cost: 999 }],
    });

    expect(calculateMediaCostEstimate(both, { durationSec: 5 })).toBe(25);
  });

  it('matrix: тариф выбирается по условиям, unitParam=duration — за секунду (wan-3.0)', () => {
    const wan = priced(
      {
        type: 'matrix',
        unitParam: 'duration',
        tiers: [
          { cost: 30, condition: { variant: 'base', resolution: '720p' } },
          { cost: 60, condition: { variant: 'base', resolution: '1080p' } },
        ],
      },
      { id: 'wan-3.0', price: 150 },
    );

    // 5 секунд × 30 ₽/с = 150 ₽ — совпадает с фактическим списанием R7.2.
    expect(
      calculateMediaCostEstimate(wan, {
        variant: 'base',
        resolution: '720p',
        durationSec: 5,
      }),
    ).toBe(150);
  });

  it('matrix: без unitParam — цена за вызов (recraftv4)', () => {
    const recraft = priced({
      type: 'matrix',
      tiers: [
        { cost: 8, condition: { type: 'raster', variant: 'base' } },
        { cost: 16, condition: { type: 'vector', variant: 'base' } },
      ],
    });

    expect(
      calculateMediaCostEstimate(recraft, {
        type: 'vector',
        variant: 'base',
        durationSec: 5,
      }),
    ).toBe(16);
  });

  it('per_resolution: ставка по rateBy (qwen-image-2.1: 2K → 8)', () => {
    const qwen = priced({
      type: 'per_resolution',
      rates: { '1K': 4, '2K': 8 },
      rateBy: 'resolution',
    });

    expect(calculateMediaCostEstimate(qwen, { resolution: '2K' })).toBe(8);
  });

  it('expr: tierRates × duration (vidu-q4: 720p, 5 с → 76)', () => {
    const vidu = priced({
      type: 'expr',
      units: ['duration'],
      tierBy: 'resolution',
      tierRates: { '540p': 7.2, '720p': 15.2, '1080p': 19.2 },
    });

    expect(
      calculateMediaCostEstimate(vidu, { resolution: '720p', durationSec: 5 }),
    ).toBe(76);
  });

  it('фолбэк: без pricing используется старое поле price', () => {
    const legacy = model({ price: 55, priceUnit: 'per_generation' });

    expect(
      calculateMediaCostEstimate(legacy, { durationSec: 5, prompt: 'кот' }),
    ).toBe(55);
  });

  it('фолбэк: priceUnit=per_second без pricing — price × длительность (sound-effect)', () => {
    const sound = model({
      id: 'sound-effect',
      type: 'MUSIC',
      price: 2.8,
      priceUnit: 'per_second',
    });

    expect(calculateMediaCostEstimate(sound, { durationSec: 10 })).toBe(28);
    // Без длительности умножать не на что — возвращаем каталожную цену.
    expect(calculateMediaCostEstimate(sound, {})).toBe(2.8);
  });

  it('фолбэк: per_character без pricing — priceInput × длину текста (tts2)', () => {
    const tts = model({
      id: 'tts2',
      type: 'MUSIC',
      price: 0,
      priceUnit: null,
      priceInput: 0.06,
      priceInputUnit: 'per_character',
    });

    expect(calculateMediaCostEstimate(tts, { text: 'а'.repeat(34) })).toBe(2.04);
  });

  it('pricing без применимого правила (per_second без длительности) → price', () => {
    const kling = priced(
      {
        type: 'per_second',
        baseBy: 'resolution',
        baseRates: { '720p': 33.6 },
      },
      { price: 210 },
    );

    // Длительности нет: тариф за секунду применить нельзя, поэтому оценка —
    // каталожная цена, а не произвольная «1 секунда».
    expect(calculateMediaCostEstimate(kling, { resolution: '720p' })).toBe(210);
  });

  it('нулевой fixed — валидная цена, а не повод уйти в фолбэк', () => {
    expect(calculateMediaCostEstimate(priced({ fixed: 0, cost: 960 }), {})).toBe(0);
  });

  it('читает параметры из вложенного data.params', () => {
    const kling = priced({
      type: 'per_second',
      baseBy: 'resolution',
      baseRates: { '720p': 33.6 },
    });

    expect(
      calculateMediaCostEstimate(kling, {
        params: { resolution: '720p', duration: '5' },
      }),
    ).toBe(168);
  });

  it('expr с units-объектами (flux-2-pro) не ломает расчёт — фолбэк на price', () => {
    // Реальный upstream: units = [{ key: 'width', scale }, { key: 'height', ... }]
    // — цена зависит от размера, бюджет такую формулу не считает.
    const flux = priced(
      {
        type: 'expr',
        base: 6,
        units: [
          { key: 'width', scale: 0.0009765625 },
          { key: 'height', scale: 0.0009765625 },
        ],
        roundUp: true,
      },
      { id: 'flux-2-pro', price: 6 },
    );

    expect(calculateMediaCostEstimate(flux, { width: 1024, height: 1024 })).toBe(6);
  });

  it('составные доплаты plus без rate/param пропускаются (minimax-h3-max)', () => {
    const minimax = priced(
      {
        type: 'matrix',
        unitParam: 'duration',
        tiers: [{ cost: 10, condition: { resolution: '480p' } }],
        plus: [
          {
            base: 0.004,
            free: 4096,
            unitsSum: [{ key: 'ref_images', weight: 1024 }],
          },
        ],
      },
      { id: 'minimax-h3-max', price: 80 },
    );

    // Тариф 10 ₽/с × 5 с; доплата без rate/param не добавляет ничего.
    expect(calculateMediaCostEstimate(minimax, { resolution: '480p', durationSec: 5 })).toBe(50);
  });

  it('доплата plus с param считается сверх free (gpt-image-2.5)', () => {
    const gptImage = priced({
      type: 'matrix',
      tiers: [{ cost: 11, condition: { variant: 'high', resolution: '1K' } }],
      plus: [{ rate: 2.5, param: 'ref_count' }],
    });

    expect(
      calculateMediaCostEstimate(gptImage, {
        variant: 'high',
        resolution: '1K',
        ref_count: 2,
      }),
    ).toBe(16);
  });
});
