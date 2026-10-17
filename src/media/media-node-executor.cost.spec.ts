import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DRIZZLE, type Database } from '../db/db.module.js';
import type { NodeDto } from '../engine/dto/index.js';
import {
  BudgetExceededException,
  CostBudgetService,
} from '../runs/cost-budget.service.js';
import type { MediaTaskResult } from './dto/media-task.mapper.js';
import { MediaNodeExecutor } from './media-node-executor.service.js';
import type { MediaModelInfo } from './media-provider.interface.js';
import { MEDIA_PROVIDERS, MediaRegistryService } from './media-registry.service.js';

/** Идентификатор запуска для бюджета и ключа идемпотентности. */
const RUN_ID = '11111111-1111-4111-8111-111111111111';

/** Текст синтеза: 34 символа × 60 ₽/1K = 2.04 ₽. */
const TTS_TEXT = 'а'.repeat(34);

/**
 * Модель `tts2` из реального каталога (KI-384): `price = 0`, тариф лежит в
 * `pricing.per_character`.
 *
 * @returns описание модели
 */
function tts2Model(): MediaModelInfo {
  return {
    id: 'tts2',
    code: 'tts2',
    type: 'MUSIC',
    price: 0,
    priceUnit: null,
    priceInput: 0.06,
    priceInputUnit: 'per_character',
    pricing: { type: 'per_character', ratePer1K: 60 },
    moderation: 'strict',
    prompt: 'required',
    params: [
      {
        key: 'voice',
        type: 'string',
        label: 'Голос',
        default: '69e7736797a24533bd8ffca6',
      },
    ],
    inputs: [],
  };
}

/**
 * Узел `audio_generation` с моделью `tts2`.
 *
 * @param text - текст синтеза
 * @returns узел графа
 */
function audioNode(text: string): NodeDto {
  return {
    id: 'audio-1',
    type: 'audio_generation',
    data: { model: 'tts2', text },
  };
}

/**
 * Собирает заглушку DRIZZLE: запуск ещё ничего не потратил.
 *
 * @returns заглушка `Database`
 */
function emptyDb(): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ costUsd: '0', costRub: '0' }]),
      }),
    }),
  } as unknown as Database;
}

/**
 * Собирает исполнителя, реальный `CostBudgetService` и мок-реестр.
 *
 * @param maxRub - лимит запуска в рублях (`WORKFLOW_RUN_MAX_COST_RUB`)
 * @returns исполнитель, реестр и модуль Nest (для получения бюджета)
 */
async function createExecutor(
  maxRub: number,
): Promise<{
  executor: MediaNodeExecutor;
  budget: CostBudgetService;
  registry: {
    findModelAsync: ReturnType<typeof vi.fn>;
    findParamsAsync: ReturnType<typeof vi.fn>;
    createTaskAsync: ReturnType<typeof vi.fn>;
  };
}> {
  const registry = {
    findModelAsync: vi.fn(() => Promise.resolve(tts2Model())),
    findParamsAsync: vi.fn(() => Promise.resolve(tts2Model().params)),
    createTaskAsync: vi.fn(() =>
      Promise.resolve<MediaTaskResult>({
        taskId: 'task-tts',
        model: 'tts2',
        status: 'done',
        resultUrls: ['https://cdn/tts.mp3'],
        costRub: 2.04,
        error: null,
      }),
    ),
  };

  const env: Record<string, unknown> = {
    WORKFLOW_RUN_MAX_COST_RUB: maxRub,
    WORKFLOW_RUN_MAX_COST_USD: 5,
    WORKFLOW_RUN_USD_RUB_RATE: 100,
    WORKFLOW_RUN_BUDGET_MODE: 'hard',
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      MediaNodeExecutor,
      CostBudgetService,
      { provide: DRIZZLE, useValue: emptyDb() },
      {
        provide: ConfigService,
        useValue: { get: vi.fn((key: string) => env[key]) },
      },
      { provide: MediaRegistryService, useValue: registry },
      { provide: MEDIA_PROVIDERS, useValue: [] },
    ],
  }).compile();

  return {
    executor: moduleRef.get(MediaNodeExecutor),
    budget: moduleRef.get(CostBudgetService),
    registry,
  };
}

describe('MediaNodeExecutor + бюджет: честный pricing (R7.2b, KI-384)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tts2: price=0, но ratePer1K=60 — бюджет блокирует вызов до провайдера', async () => {
    // Лимит 2 ₽, оценка 2.04 ₽ (34 символа × 60 ₽/1K). До KI-384 оценка была 0
    // (price=0), и hard cap не срабатывал: TTS уходил в upstream.
    const { executor, budget, registry } = await createExecutor(2);
    const assertSpy = vi.spyOn(budget, 'assertWithinBudgetAsync');

    const error = await executor
      .executeAudioAsync(audioNode(TTS_TEXT), {}, RUN_ID)
      .catch((caught: unknown) => caught);

    // Оценка пришла именно из pricing.per_character, а не из старого price=0.
    expect(assertSpy).toHaveBeenCalledWith(RUN_ID, { rub: 2.04 });
    expect(error).toBeInstanceOf(BudgetExceededException);
    expect((error as BudgetExceededException).estimated).toBeCloseTo(0.0204, 6);
    expect(registry.createTaskAsync).not.toHaveBeenCalled();
  });

  it('tts2: в пределах лимита вызов проходит с оценкой по pricing', async () => {
    // Лимит 3 ₽ > 2.04 ₽ — вызов разрешён.
    const { executor, registry } = await createExecutor(3);

    const result = await executor.executeAudioAsync(audioNode(TTS_TEXT), {}, RUN_ID);

    expect(registry.createTaskAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'tts2',
        prompt: TTS_TEXT,
        idempotencyKey: `${RUN_ID}:audio-1`,
      }),
    );
    expect(result.outputs.mediaUrl).toBe('https://cdn/tts.mp3');
    expect(result.metrics.costRub).toBe(2.04);
  });

  it('tts2: короткий текст (1 символ) дешевле лимита', async () => {
    // 1 символ × 60 ₽/1K = 0.06 ₽ < 2 ₽.
    const { executor, registry } = await createExecutor(2);

    await expect(
      executor.executeAudioAsync(audioNode('а'), {}, RUN_ID),
    ).resolves.toBeDefined();
    expect(registry.createTaskAsync).toHaveBeenCalled();
  });
});
