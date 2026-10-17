import { MediaModelSchema } from './media-model.dto.js';
import { toMediaModelInfo } from './media-model.mapper.js';

/**
 * Разбирает модель так же, как это делает провайдер на границе upstream:
 * сначала Zod-схема (snake_case), затем маппер в camelCase.
 *
 * @param raw - сырая модель из ответа upstream
 * @returns модель во внутреннем виде
 */
function mapRaw(raw: Record<string, unknown>) {
  return toMediaModelInfo(MediaModelSchema.parse(raw));
}

/** Минимально валидная модель upstream. */
const baseRaw = {
  id: 'tts2',
  code: 'tts2',
  type: 'MUSIC',
  price: 0,
  moderation: 'strict',
  prompt: 'required',
  params: [],
  inputs: [],
};

describe('toMediaModelInfo: блок pricing (R7.2b, KI-384)', () => {
  it('маппит per_character (tts2: price=0, ratePer1K=60)', () => {
    const model = mapRaw({
      ...baseRaw,
      price_input: 0.06,
      price_input_unit: 'per_character',
      pricing: { type: 'per_character', ratePer1K: 60 },
    });

    expect(model.price).toBe(0);
    expect(model.pricing).toEqual({ type: 'per_character', ratePer1K: 60 });
  });

  it('маппит fixed/cost (glabs-veo-3: price=480, pricing.cost=960)', () => {
    const model = mapRaw({
      ...baseRaw,
      id: 'glabs-veo-3',
      code: 'glabs-veo-3',
      type: 'VIDEO',
      price: 480,
      price_unit: 'per_generation',
      pricing: { type: 'fixed', cost: 960 },
    });

    expect(model.price).toBe(480);
    expect(model.pricing?.cost).toBe(960);
    expect(model.pricing?.type).toBe('fixed');
  });

  it('маппит per_second с baseRates (kling-v3)', () => {
    const model = mapRaw({
      ...baseRaw,
      id: 'kling-v3',
      code: 'kling-v3',
      type: 'VIDEO',
      price: 210,
      price_unit: 'per_generation',
      pricing: {
        type: 'per_second',
        baseBy: 'resolution',
        baseRates: { '720p': 33.6, '1080p': 42 },
        unitParam: 'duration',
      },
    });

    expect(model.pricing?.baseRates?.['720p']).toBe(33.6);
    expect(model.pricing?.baseBy).toBe('resolution');
  });

  it('маппит matrix с условиями тарифа', () => {
    const model = mapRaw({
      ...baseRaw,
      id: 'wan-3.0',
      code: 'wan-3.0',
      type: 'VIDEO',
      price: 150,
      pricing: {
        type: 'matrix',
        unitParam: 'duration',
        tiers: [
          { cost: 30, condition: { variant: 'base', resolution: '720p' } },
        ],
      },
    });

    expect(model.pricing?.tiers).toEqual([
      { cost: 30, condition: { variant: 'base', resolution: '720p' } },
    ]);
  });

  it('не добавляет поле pricing, если upstream его не отдал (sound-effect)', () => {
    const model = mapRaw({
      ...baseRaw,
      id: 'sound-effect',
      price: 2.8,
      price_unit: 'per_second',
    });

    expect(model).not.toHaveProperty('pricing');
    expect(model.priceUnit).toBe('per_second');
  });

  it('принимает pricing: null (нет тарифа) и не падает', () => {
    const model = mapRaw({ ...baseRaw, pricing: null });

    expect(model).not.toHaveProperty('pricing');
  });

  it('принимает expr с units-объектами (flux-2-pro) и составные plus', () => {
    // Реальные формы каталога, которые ломали строгую схему до смоука R7.2b:
    // units — массив объектов, plus — без rate/param.
    const expr = mapRaw({
      ...baseRaw,
      id: 'flux-2-pro',
      type: 'IMAGE',
      price: 6,
      pricing: {
        type: 'expr',
        base: 6,
        units: [
          { key: 'width', scale: 0.0009765625 },
          { key: 'height', scale: 0.0009765625 },
        ],
        roundUp: true,
      },
    });

    expect(Array.isArray(expr.pricing?.units)).toBe(true);
    expect(expr.pricing?.units).toHaveLength(2);

    const minimax = mapRaw({
      ...baseRaw,
      id: 'minimax-h3-max',
      type: 'VIDEO',
      price: 80,
      pricing: {
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
    });

    expect(minimax.pricing?.plus).toHaveLength(1);
    expect(minimax.pricing?.plus?.[0]?.base).toBe(0.004);
  });

  it('сохраняет незнакомые поля блока (passthrough, RULES 1.17)', () => {
    const model = mapRaw({
      ...baseRaw,
      pricing: {
        type: 'fixed',
        cost: 10,
        future_field: { nested: true },
      },
    });

    // Незнакомое поле не должно ронять разбор каталога: upstream меняется без
    // нашего релиза.
    expect(model.pricing?.future_field).toEqual({ nested: true });
  });
});
