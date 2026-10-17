import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { nodeRuns } from '../db/schema.js';
import type {
  MediaModelInfo,
  MediaPricing,
  MediaPricingPlus,
} from '../media/media-provider.interface.js';

/** Режим бюджета запуска: `hard` — блокировать, `soft` — только предупреждать. */
export type BudgetMode = 'hard' | 'soft';

/** Дефолтный лимит запуска в USD (совпадает с дефолтом env-схемы). */
export const DEFAULT_MAX_COST_USD = 5;
/** Дефолтный лимит запуска в рублях (совпадает с дефолтом env-схемы). */
export const DEFAULT_MAX_COST_RUB = 500;
/** Дефолтный курс RUB→USD для нормализации лимитов в одну валюту. */
export const DEFAULT_USD_RUB_RATE = 100;
/** Дефолтный режим бюджета. */
export const DEFAULT_BUDGET_MODE: BudgetMode = 'hard';

/**
 * Оценка стоимости следующего вызова (в валюте провайдера).
 *
 * Обе валюты необязательны: LLM-узлы оцениваются в USD, media-узлы — в рублях,
 * а узел без известной цены может не передать оценку вовсе (`0`).
 */
export interface CostEstimate {
  /** Ожидаемая стоимость вызова в USD. */
  usd?: number;
  /** Ожидаемая стоимость вызова в рублях. */
  rub?: number;
}

/** Результат проверки бюджета запуска. */
export interface BudgetCheckResult {
  /**
   * Укладывается ли следующий вызов в лимиты — **факт**, без учёта режима.
   *
   * В `soft`-режиме `ok: false` не блокирует вызов (это решает
   * {@link CostBudgetService.assertWithinBudgetAsync}), но UI показывает
   * предупреждение, а не «всё хорошо».
   */
  ok: boolean;
  /** Уже потрачено запуском, USD (рубли пересчитаны по курсу). */
  accumulated: number;
  /** Оценка проверяемого вызова, USD. */
  estimated: number;
  /** Остаток бюджета, USD (может быть отрицательным — бюджет превышен). */
  remaining: number;
  /** Лимит запуска в USD. */
  maxUsd: number;
  /** Лимит запуска в рублях. */
  maxRub: number;
  /** Режим бюджета. */
  mode: BudgetMode;
}

/**
 * Ошибка: бюджет запуска исчерпан (KI-048).
 *
 * Текст ошибки — публичный контракт: он попадает в `node_runs.error` и
 * показывается пользователю в узле как
 * `Budget exceeded (estimated: $X, remaining: $Y)` (DESIGN v0.9 § 3.1),
 * поэтому формат собирается здесь, а не в исполнителях.
 */
export class BudgetExceededException extends Error {
  /** Оценка несостоявшегося вызова, USD. */
  readonly estimated: number;
  /** Остаток бюджета на момент проверки, USD. */
  readonly remaining: number;

  /**
   * @param estimated - оценка стоимости вызова в USD
   * @param remaining - остаток бюджета в USD (может быть отрицательным)
   */
  constructor(estimated: number, remaining: number) {
    super(
      `Budget exceeded (estimated: $${estimated.toFixed(4)}, remaining: $${remaining.toFixed(4)})`,
    );
    this.name = 'BudgetExceededException';
    this.estimated = estimated;
    this.remaining = remaining;
  }
}

/** Сколько символов в тарифной единице `per_character` (1K). */
const CHARACTERS_PER_1K = 1000;

/** Округление денежной оценки до 4 знаков (копейка/десятая копейки). */
const MONEY_SCALE = 10_000;

/**
 * Оценивает стоимость media-вызова в рублях по блоку `pricing` каталога
 * (R7.2b, KI-384).
 *
 * **Зачем.** Каталожное поле `price` расходится с фактическим списанием
 * (`glabs-veo-3`: 480 vs 960; `tts2`: 0 vs 2.04 ₽), поэтому бюджет запуска
 * (KI-048) недооценивал media-узлы, а для `tts2` оценка была нулевой — hard cap
 * не срабатывал. Здесь цена считается по тарифу и **параметрам конкретного
 * вызова**: длительности, разрешению, длине текста.
 *
 * **Приоритет источников** (первое совпавшее правило выигрывает, чтобы не
 * складывать взаимоисключающие тарифы):
 * 1. `pricing.fixed` — фиксированная цена (упрощённая форма);
 * 2. `pricing.cost` — фиксированная цена upstream (`type: 'fixed'`);
 * 3. `pricing.per_second` × длительность;
 * 4. `pricing.per_character.ratePer1K` × (длина текста / 1000);
 * 5. `pricing.baseRates` × длительность (per_second с выбором ставки по параметру);
 * 6. `pricing.matrix`/`pricing.tiers` — тариф по условиям; при `unitParam:
 *    'duration'` стоимость умножается на длительность (у `wan-3.0` тариф задан
 *    за секунду);
 * 7. `pricing.rates` — ставка per_resolution;
 * 8. `pricing.tierRates` × длительность для `expr`;
 * 9. **фолбэк** — старое поле `price` (для `priceUnit: 'per_second'` — с
 *    умножением на длительность, `sound-effect`).
 *
 * Если правило требует параметра, которого нет в `data` (например,
 * `per_second` без длительности), оно пропускается: оценивать «наугад» хуже,
 * чем вернуть каталожную цену.
 *
 * @param model - модель из каталога (с блоком `pricing`, если upstream его отдал)
 * @param data - параметры вызова: `node.data` узла плюс отфильтрованные
 *   параметры модели (`duration`/`durationSec`, `resolution`, `text`/`prompt`);
 *   вложенный `data.params` тоже читается
 * @returns оценка стоимости вызова в рублях (не меньше 0, округлена до 4 знаков)
 */
export function calculateMediaCostEstimate(
  model: MediaModelInfo,
  data: Readonly<Record<string, unknown>> = {},
): number {
  const fromPricing =
    model.pricing === undefined ? null : estimateFromPricing(model.pricing, data);

  return roundMoney(fromPricing ?? estimateFromLegacyPrice(model, data));
}

/**
 * Считает оценку по блоку `pricing`.
 *
 * @param pricing - блок тарификации из каталога
 * @param data - параметры вызова
 * @returns стоимость в рублях либо `null`, если ни одно правило не применимо
 *   (тогда используется старое поле `price`)
 */
function estimateFromPricing(
  pricing: MediaPricing,
  data: Readonly<Record<string, unknown>>,
): number | null {
  // 1–2. Фиксированная цена: упрощённое `fixed` приоритетнее upstream-поля
  // `cost` (если оба пришли, считаем более конкретное значение).
  if (isNonNegativeNumber(pricing.fixed)) {
    return pricing.fixed;
  }

  if (isNonNegativeNumber(pricing.cost)) {
    return pricing.cost;
  }

  const durationSec = readDurationSec(data);

  // 3. Упрощённая ставка за секунду.
  if (isNonNegativeNumber(pricing.per_second) && durationSec !== null) {
    return pricing.per_second * durationSec;
  }

  // 4. Цена за текст (TTS): ratePer1K × длина / 1000. Upstream кладёт ставку
  // на верхний уровень (`{ type: 'per_character', ratePer1K: 60 }`), но
  // поддерживаем и вложенную форму из KI-384.
  const text = readText(data);
  const ratePer1K = pricing.ratePer1K ?? pricing.per_character?.ratePer1K;

  if (isNonNegativeNumber(ratePer1K) && text.length > 0) {
    return (ratePer1K * text.length) / CHARACTERS_PER_1K;
  }

  // 5. per_second с выбором ставки по параметру вызова (resolution).
  if (pricing.baseRates !== undefined && durationSec !== null) {
    const rate = pickRate(pricing.baseRates, pricing.baseBy, data);

    if (rate !== null) {
      return rate * durationSec;
    }
  }

  // 6. Матрица тарифов: выбираем первый подходящий по условиям.
  const tiers = pricing.matrix ?? pricing.tiers;

  if (tiers !== undefined) {
    const tier = tiers.find((candidate) =>
      matchesCondition(candidate.condition, data),
    );

    if (tier !== undefined) {
      // `unitParam: 'duration'` означает тариф за секунду (wan-3.0): при
      // отсутствии длительности берём стоимость тира как есть, иначе оценка
      // была бы нулевой.
      const perUnit =
        pricing.unitParam === 'duration' && durationSec !== null
          ? tier.cost * durationSec
          : tier.cost;

      return perUnit + calculatePlus(pricing.plus, data);
    }
  }

  // 7. per_resolution: ставка выбирается по параметру (rateBy).
  if (pricing.rates !== undefined) {
    const rate = pickRate(pricing.rates, pricing.rateBy, data);

    if (rate !== null) {
      return rate + calculatePlus(pricing.plus, data);
    }
  }

  // 8. expr: ставка × единицы (`units: ['duration']`).
  if (pricing.tierRates !== undefined) {
    const rate = pickRate(pricing.tierRates, pricing.tierBy, data);

    if (rate !== null) {
      const perUnit = usesDurationUnit(pricing.units) && durationSec !== null;

      return perUnit ? rate * durationSec : rate;
    }
  }

  return null;
}

/**
 * Фолбэк на устаревшее поле `price` (до KI-384 бюджет считался только по нему).
 *
 * Для `priceUnit: 'per_second'` цена умножается на длительность (`sound-effect`:
 * 2.8 ₽/с, блока `pricing` у модели нет). Для `per_character` используется
 * `priceInput` — ставка за вход (`tts2.priceInput = 0.06 ₽/символ`), если блока
 * `pricing` почему-то нет.
 *
 * @param model - модель из каталога
 * @param data - параметры вызова
 * @returns стоимость в рублях
 */
function estimateFromLegacyPrice(
  model: MediaModelInfo,
  data: Readonly<Record<string, unknown>>,
): number {
  const unit = model.priceUnit ?? model.priceInputUnit;

  if (unit === 'per_second') {
    const durationSec = readDurationSec(data);

    if (durationSec !== null) {
      return model.price * durationSec;
    }
  }

  if (unit === 'per_character' && isNonNegativeNumber(model.priceInput)) {
    const text = readText(data);

    if (text.length > 0) {
      return model.priceInput * text.length;
    }
  }

  return model.price;
}

/**
 * Длительность вызова в секундах.
 *
 * Читается `durationSec` (поле узла R7.2) или `duration` (параметр модели;
 * upstream часто отдаёт enum со строковыми значениями — `'5'`).
 *
 * @param data - параметры вызова
 * @returns секунды либо `null`, если длительности в данных нет
 */
function readDurationSec(data: Readonly<Record<string, unknown>>): number | null {
  for (const key of ['durationSec', 'duration']) {
    const parsed = toFiniteNumber(lookupData(data, key));

    if (parsed !== null && parsed >= 0) {
      return parsed;
    }
  }

  return null;
}

/**
 * Текст вызова (для тарифа `per_character`).
 *
 * Приоритет: `text` (поле узла `audio_generation`), затем `prompt` (то, что
 * реально уходит в upstream).
 *
 * @param data - параметры вызова
 * @returns текст либо пустая строка
 */
function readText(data: Readonly<Record<string, unknown>>): string {
  for (const key of ['text', 'prompt']) {
    const value = lookupData(data, key);

    if (typeof value === 'string') {
      return value;
    }
  }

  return '';
}

/**
 * Достаёт значение параметра вызова.
 *
 * Сначала ищет ключ в верхнем уровне `data` (исполнитель кладёт туда
 * `node.data` и отфильтрованные параметры), затем во вложенном `data.params`
 * (форма «как есть» из узла).
 *
 * @param data - параметры вызова
 * @param key - имя параметра
 * @returns значение либо `undefined`
 */
function lookupData(
  data: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  const direct = data[key];

  if (direct !== undefined) {
    return direct;
  }

  const params = data.params;

  return isPlainRecord(params) ? params[key] : undefined;
}

/**
 * Выбирает ставку из карты `ставка по значению параметра`.
 *
 * Порядок: точное значение параметра (`resolution: '720p'`) → ставка с пустым
 * ключом (`{ '': 32 }`, когда `baseBy` пуст) → единственная ставка карты.
 *
 * @param rates - карта ставок из `pricing` (`baseRates`/`rates`/`tierRates`)
 * @param paramName - имя параметра вызова, по которому выбирается ставка
 * @param data - параметры вызова
 * @returns ставка либо `null`, если выбрать не из чего
 */
function pickRate(
  rates: Record<string, number>,
  paramName: string | undefined,
  data: Readonly<Record<string, unknown>>,
): number | null {
  const paramValue =
    paramName !== undefined && paramName.length > 0
      ? lookupData(data, paramName)
      : undefined;

  if (paramValue !== undefined) {
    const exact = rates[toComparableString(paramValue)];

    if (exact !== undefined) {
      return exact;
    }
  }

  const fallback = rates[''];

  if (fallback !== undefined) {
    return fallback;
  }

  const values = Object.values(rates);

  return values.length === 1 && values[0] !== undefined ? values[0] : null;
}

/**
 * Проверяет, что условия тарифа матрицы выполнены для параметров вызова.
 *
 * @param condition - условие тарифа (`{ resolution: '720p' }`); без условия
 *   тариф считается подходящим
 * @param data - параметры вызова
 * @returns `true`, если все пары «параметр → значение» совпали
 */
function matchesCondition(
  condition: Readonly<Record<string, unknown>> | undefined,
  data: Readonly<Record<string, unknown>>,
): boolean {
  if (condition === undefined) {
    return true;
  }

  return Object.entries(condition).every(([key, expected]) => {
    const actual = lookupData(data, key);

    // Сравнение строковое: каталог отдаёт `'720p'`, а узел может прислать
    // число/строку в зависимости от типа параметра.
    return (
      actual !== undefined &&
      toComparableString(actual) === toComparableString(expected)
    );
  });
}

/**
 * Приводит значение параметра к строке для сравнения с каталогом.
 *
 * Примитивы — через `String`, объекты — через `JSON.stringify`: обычный
 * `String({})` дал бы `[object Object]` и склеил бы разные условия тарифа.
 *
 * @param value - значение параметра вызова или условие тарифа
 * @returns строковое представление
 */
function toComparableString(value: unknown): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }

  return JSON.stringify(value) ?? '';
}

/**
 * Считает доплаты матрицы (`pricing.plus`): например, за референсы сверх
 * бесплатного лимита.
 *
 * @param plus - список доплат из `pricing`
 * @param data - параметры вызова
 * @returns сумма доплат в рублях (`0`, если доплат нет или параметр не задан)
 */
function calculatePlus(
  plus: readonly MediaPricingPlus[] | undefined,
  data: Readonly<Record<string, unknown>>,
): number {
  if (plus === undefined) {
    return 0;
  }

  let total = 0;

  for (const item of plus) {
    // Составные доплаты upstream (`base`/`unitsSum`/`tierRates`) бюджет пока не
    // интерпретирует: у них нет `rate`/`param`. Пропускаем, а не падаем.
    if (
      !isNonNegativeNumber(item.rate) ||
      typeof item.param !== 'string' ||
      item.param.length === 0
    ) {
      continue;
    }

    const count = toFiniteNumber(lookupData(data, item.param));

    if (count === null) {
      continue;
    }

    total += Math.max(0, count - (item.free ?? 0)) * item.rate;
  }

  return total;
}

/**
 * Проверяет, что `expr`-тариф умножается на длительность.
 *
 * `units` бывает `['duration']`, а бывает набором объектов
 * (`[{ key: 'width', scale }]`, `flux-2-pro`) — во втором случае тариф зависит
 * от размера картинки и бюджет по нему не считает: вернётся фолбэк на `price`.
 *
 * @param units - единицы тарифа из `pricing.units`
 * @returns `true`, если среди единиц есть `duration`
 */
function usesDurationUnit(units: readonly unknown[] | undefined): boolean {
  if (units === undefined) {
    return false;
  }

  return units.some(
    (unit) =>
      unit === 'duration' ||
      (isPlainRecord(unit) && unit.key === 'duration'),
  );
}

/**
 * Приводит значение к конечному числу.
 *
 * @param value - значение из данных вызова (число, строка числа или иное)
 * @returns число либо `null`, если значение нечисловое
 */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/**
 * Проверяет, что значение — неотрицательное конечное число.
 *
 * @param value - значение из `pricing`
 * @returns `true` для `0` и положительных чисел
 */
function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Проверяет, что значение — обычный объект (не массив и не `null`).
 *
 * @param value - значение из данных вызова
 * @returns `true`, если это объект-словарь
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Округляет денежную оценку, чтобы бюджет и UI не показывали «2.0399999».
 *
 * @param value - стоимость в рублях
 * @returns стоимость, округлённая до 4 знаков
 */
function roundMoney(value: number): number {
  return Math.round(value * MONEY_SCALE) / MONEY_SCALE;
}

/**
 * Стоимости запуска по валютам (сырые значения из `node_runs`).
 */
interface RunCostRow {
  /** Сумма `node_runs.cost_usd`, строка (Drizzle `numeric`). */
  costUsd: string | null;
  /** Сумма `node_runs.cost_rub`, строка (Drizzle `numeric`). */
  costRub: string | null;
}

/**
 * Предохранитель по стоимости запуска (R7.1, KI-048).
 *
 * **Зачем.** До v0.9 стоимость запуска ничем не ограничивалась: до 3 job-попыток
 * × 3 node-попыток = до 9 платных вызовов провайдера на узел, и каждый job-retry
 * прогонял граф заново (KI-046). Для текстовых моделей это копейки, для
 * media-инструментов (апскейл, липсинк, видео) — заметные деньги.
 *
 * **Модель.** Бюджет — свойство **запуска** (графа), а не попытки: суммы берутся
 * из `node_runs` (`cost_usd`/`cost_rub`), поэтому повторный прогон графа
 * учитывает уже потраченное (DESIGN v0.9 § 3.1 «Взаимодействие с job-retry»).
 * Лимиты задаются в двух валютах (`WORKFLOW_RUN_MAX_COST_USD` /
 * `WORKFLOW_RUN_MAX_COST_RUB`), а нормализуются в USD по курсу
 * `WORKFLOW_RUN_USD_RUB_RATE` — так у пользователя одна шкала в UI и в тексте
 * ошибки, и при этом рублёвый лимит остаётся независимым.
 *
 * **Режимы.** `hard` (дефолт) — превышение блокирует вызов
 * ({@link assertWithinBudgetAsync} бросает {@link BudgetExceededException}),
 * `soft` — предупреждение в лог и продолжение (DESIGN § 2.6: industry practice
 * warning + graceful degradation).
 *
 * Проверка вызывается **перед** обращением к провайдеру — в исполнителях узлов
 * `llm`, `image_generation` и `image_tool`.
 */
@Injectable()
export class CostBudgetService {
  private readonly logger = new Logger(CostBudgetService.name);

  /** Лимит запуска в USD. */
  private readonly maxUsd: number;
  /** Лимит запуска в рублях. */
  private readonly maxRub: number;
  /** Режим бюджета. */
  private readonly mode: BudgetMode;
  /** Курс RUB→USD для нормализации (сколько рублей в одном долларе). */
  private readonly usdRubRate: number;

  /**
   * @param db - доступ к `node_runs` (источник фактических трат запуска)
   * @param config - переменные окружения бюджета (RULES 4.6)
   */
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
  ) {
    this.maxUsd =
      config.get<number>('WORKFLOW_RUN_MAX_COST_USD') ?? DEFAULT_MAX_COST_USD;
    this.maxRub =
      config.get<number>('WORKFLOW_RUN_MAX_COST_RUB') ?? DEFAULT_MAX_COST_RUB;
    this.mode =
      config.get<BudgetMode>('WORKFLOW_RUN_BUDGET_MODE') ?? DEFAULT_BUDGET_MODE;
    this.usdRubRate =
      config.get<number>('WORKFLOW_RUN_USD_RUB_RATE') ?? DEFAULT_USD_RUB_RATE;
  }

  /**
   * Проверяет, укладывается ли следующий вызов в бюджет запуска.
   *
   * @param runId - uuid запуска
   * @param estimate - оценка стоимости вызова (обе валюты необязательны)
   * @returns снимок бюджета: `ok`, потрачено, оценка, остаток и лимиты
   * @throws Error если не удалось прочитать траты запуска (RULES 4.18: не гасим)
   */
  async checkBudgetAsync(
    runId: string,
    estimate: CostEstimate = {},
  ): Promise<BudgetCheckResult> {
    const [row] = await this.db
      .select({
        costUsd: sql<string | null>`coalesce(sum(${nodeRuns.costUsd}), 0)`,
        costRub: sql<string | null>`coalesce(sum(${nodeRuns.costRub}), 0)`,
      })
      .from(nodeRuns)
      .where(eq(nodeRuns.runId, runId));

    const spentUsd = toAmount((row as RunCostRow | undefined)?.costUsd);
    const spentRub = toAmount((row as RunCostRow | undefined)?.costRub);
    const accumulated = spentUsd + spentRub / this.usdRubRate;

    const estimatedUsd = (estimate.usd ?? 0) + (estimate.rub ?? 0) / this.usdRubRate;
    const remaining = Math.min(
      this.maxUsd - accumulated,
      (this.maxRub - spentRub) / this.usdRubRate,
    );
    const withinLimits =
      accumulated + estimatedUsd <= this.maxUsd &&
      spentRub + (estimate.rub ?? 0) <= this.maxRub;

    return {
      ok: withinLimits,
      accumulated,
      estimated: estimatedUsd,
      remaining,
      maxUsd: this.maxUsd,
      maxRub: this.maxRub,
      mode: this.mode,
    };
  }

  /**
   * Проверяет бюджет и бросает исключение при превышении в режиме `hard`.
   *
   * Вызывается исполнителями узлов перед обращением к провайдеру: в `soft`
   * режиме превышение попадает в лог предупреждением и работа продолжается,
   * в `hard` — узел падает с {@link BudgetExceededException} (текст ошибки
   * показывается пользователю).
   *
   * @param runId - uuid запуска
   * @param estimate - оценка стоимости вызова
   * @returns снимок бюджета (пригоден для логов и UI)
   * @throws BudgetExceededException если лимит превышен, а режим — `hard`
   */
  async assertWithinBudgetAsync(
    runId: string,
    estimate: CostEstimate = {},
  ): Promise<BudgetCheckResult> {
    const check = await this.checkBudgetAsync(runId, estimate);

    // `remaining` — минимум из двух лимитов (USD и RUB), поэтому превышение
    // определяется сравнением с ним: вызов не влезает, если оценка больше
    // остатка. Нулевая оценка при уже исчерпанном бюджете тоже считается
    // превышением — иначе hard cap не остановил бы повторный прогон графа
    // (KI-048: стоимость предыдущих попыток не сбрасывается).
    const exceeded = check.estimated > check.remaining;

    if (!exceeded) {
      return check;
    }

    if (check.mode === 'soft') {
      this.logger.warn(
        `Запуск ${runId}: бюджет превышен (потрачено $${check.accumulated.toFixed(4)}, ` +
          `оценка $${check.estimated.toFixed(4)}, остаток $${check.remaining.toFixed(4)}) — ` +
          'режим soft, вызов продолжается',
      );

      return check;
    }

    this.logger.warn(
      `Запуск ${runId}: бюджет исчерпан (потрачено $${check.accumulated.toFixed(4)}, ` +
        `оценка $${check.estimated.toFixed(4)}, остаток $${check.remaining.toFixed(4)})`,
    );

    throw new BudgetExceededException(check.estimated, check.remaining);
  }

  /**
   * Возвращает лимиты и режим бюджета без обращения к БД.
   *
   * Нужен UI (прогресс-бар в TopBar) и ручке `GET /runs/:id/budget`, когда
   * запуска ещё нет.
   *
   * @returns лимиты в двух валютах и режим
   */
  getLimits(): { maxUsd: number; maxRub: number; mode: BudgetMode } {
    return { maxUsd: this.maxUsd, maxRub: this.maxRub, mode: this.mode };
  }
}

/**
 * Приводит значение `numeric`/`sum` из БД к числу.
 *
 * Drizzle отдаёт `numeric` строкой (RULES 4.23), а агрегат может прийти
 * `null`-ом на пустой выборке: обе формы сводим к `0`.
 *
 * @param value - значение из БД (строка, число или `null`)
 * @returns число; `0`, если значение пустое или не число
 */
function toAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  const parsed = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}
