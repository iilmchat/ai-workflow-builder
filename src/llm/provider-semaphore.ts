/**
 * Семафор на провайдера LLM и его настройка из окружения (R7.7, KI-067).
 *
 * Проблема: `concurrency` воркера очереди — один на все запуски, поэтому пять
 * тяжёлых workflow одновременно бьют в одного провайдера, ловят 429 и растят
 * расходы. Здесь — ограничение **одновременных вызовов** на каждого
 * провайдера: лишние вызовы ждут в очереди семафора, а не в HTTP-слое
 * провайдера.
 *
 * Ограничение включается только явно: `LLM_PROVIDER_MAX_CONCURRENCY_<NAME>`.
 * Без переменной поведение прежнее (backward compat, DESIGN § 3.7.2).
 *
 * Реализация — самописная (DESIGN допускает `p-limit` или самописную): без
 * новой зависимости, FIFO-очередь ожидающих, освобождение в `finally`.
 */

/**
 * Семафор с FIFO-очередью ожидания.
 *
 * `acquireAsync()` возвращает функцию освобождения, а не просто промис: так
 * освобождение нельзя забыть «случайно дважды» — повторный вызов no-op.
 */
export class Semaphore {
  /** Максимум одновременно удерживаемых «слотов». */
  private readonly max: number;

  /** Сколько слотов занято сейчас. */
  private active = 0;

  /** Очередь ожидающих: их резолвят по одному при освобождении. */
  private readonly waiters: Array<() => void> = [];

  /**
   * @param max - максимум одновременных операций (> 0)
   * @throws Error если `max` не положительное целое
   */
  constructor(max: number) {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error(`Semaphore: лимит должен быть целым > 0, получено ${max}`);
    }

    this.max = max;
  }

  /** Текущий лимит одновременных операций. */
  get limit(): number {
    return this.max;
  }

  /** Сколько операций удерживает семафор сейчас. */
  get activeCount(): number {
    return this.active;
  }

  /** Сколько операций ждёт освобождения слота. */
  get pendingCount(): number {
    return this.waiters.length;
  }

  /**
   * Занимает слот, дожидаясь его при необходимости.
   *
   * @returns функция освобождения слота (идемпотентная)
   */
  async acquireAsync(): Promise<() => void> {
    if (this.active < this.max) {
      this.active += 1;

      return this.createRelease();
    }

    // Слот занят — ждём, пока текущий держатель не передаст его нам.
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    // Слот уже «передан»: в release() active не уменьшается, а сразу
    // переходит следующему ожидающему (см. release ниже).

    return this.createRelease();
  }

  /**
   * Выполняет операцию под семафором.
   *
   * @param fn - операция
   * @returns результат операции
   * @throws ошибку операции (слот освобождается в `finally`)
   */
  async runAsync<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquireAsync();

    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Создаёт идемпотентную функцию освобождения слота.
   *
   * @returns функция освобождения
   */
  private createRelease(): () => void {
    let released = false;

    return (): void => {
      if (released) {
        return;
      }

      released = true;

      const next = this.waiters.shift();

      if (next !== undefined) {
        // Слот не освобождаем: он переходит ожидающему, `active` не меняется.
        next();

        return;
      }

      this.active = Math.max(0, this.active - 1);
    };
  }
}

/**
 * Имя env-переменной лимита для провайдера.
 *
 * `routerai` → `LLM_PROVIDER_MAX_CONCURRENCY_ROUTERAI`; дефисы и прочие
 * не-буквы превращаются в `_` (например, `openai-images` →
 * `LLM_PROVIDER_MAX_CONCURRENCY_OPENAI_IMAGES`).
 *
 * @param provider - имя провайдера (`anthropic`, `openai`, `lmstudio`, ...)
 * @returns имя переменной окружения
 */
export function concurrencyEnvKey(provider: string): string {
  const normalized = provider.toUpperCase().replace(/[^A-Z0-9]/g, '_');

  return `LLM_PROVIDER_MAX_CONCURRENCY_${normalized}`;
}

/**
 * Разбирает лимит из значения env.
 *
 * Принимает число (после `validateEnv`) и строку (сырой env). Всё, что не
 * целое > 0, трактуется как «лимита нет»: опечатка в `.env` не должна
 * останавливать вызовы LLM.
 *
 * @param value - значение переменной
 * @returns целое > 0 либо `undefined`
 */
export function parseConcurrencyLimit(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Источник env-значений: `ConfigService` в проде, объект — в тестах.
 */
export interface EnvReader {
  /**
   * Читает значение переменной.
   *
   * @param key - имя переменной
   * @returns значение либо `undefined`
   */
  get(key: string): unknown;
}

/**
 * Реестр семафоров по провайдерам.
 *
 * Семафор создаётся лениво при первом вызове провайдера: без env-переменной
 * его нет вовсе, поэтому лишних объектов и ограничений не появляется.
 */
export class ProviderSemaphoreRegistry {
  /** Созданные семафоры: имя провайдера → семафор. */
  private readonly semaphores = new Map<string, Semaphore>();

  /**
   * @param env - источник env (может отсутствовать: тогда лимитов нет)
   */
  constructor(private readonly env?: EnvReader) {}

  /**
   * Возвращает семафор провайдера или `null`, если лимит не задан.
   *
   * @param provider - имя провайдера
   * @returns семафор либо `null` (без ограничения)
   */
  forProvider(provider: string): Semaphore | null {
    const existing = this.semaphores.get(provider);

    if (existing !== undefined) {
      return existing;
    }

    const limit = parseConcurrencyLimit(this.env?.get(concurrencyEnvKey(provider)));

    if (limit === undefined) {
      return null;
    }

    const semaphore = new Semaphore(limit);

    this.semaphores.set(provider, semaphore);

    return semaphore;
  }

  /**
   * Выполняет операцию под семафором провайдера.
   *
   * Без лимита операция выполняется сразу — поведение до R7.7.
   *
   * @param provider - имя провайдера
   * @param fn - операция
   * @returns результат операции
   * @throws ошибку операции
   */
  async runAsync<T>(provider: string, fn: () => Promise<T>): Promise<T> {
    const semaphore = this.forProvider(provider);

    if (semaphore === null) {
      return fn();
    }

    return semaphore.runAsync(fn);
  }
}

/**
 * Создаёт реестр семафоров с чтением лимитов из окружения.
 *
 * @param env - источник env (`ConfigService`); без него лимитов нет
 * @returns реестр семафоров
 */
export function createProviderSemaphoreRegistry(
  env?: EnvReader,
): ProviderSemaphoreRegistry {
  return new ProviderSemaphoreRegistry(env);
}
