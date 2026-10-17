import { describe, expect, it } from 'vitest';
import {
  ProviderSemaphoreRegistry,
  Semaphore,
  concurrencyEnvKey,
  parseConcurrencyLimit,
} from './provider-semaphore.js';

/** Отложенное освобождение: тест сам решает, когда задача завершится. */
interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

/**
 * Создаёт промис с внешним `resolve`.
 *
 * @returns промис и функция его завершения
 */
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

/**
 * Даёт отработать микрозадачам и таймерам: после `resolve()` ожидающие
 * семафоры должны успеть захватить слот.
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Semaphore: ограничение одновременных вызовов (R7.7, KI-067)', () => {
  it('держит не больше лимита одновременных операций', async () => {
    const semaphore = new Semaphore(2);
    const gates = Array.from({ length: 5 }, () => deferred());
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;

    const runs = gates.map((gate, index) =>
      semaphore.runAsync(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        started.push(index);
        await gate.promise;
        active -= 1;
      }),
    );

    await flush();

    expect(started).toEqual([0, 1]);
    expect(semaphore.activeCount).toBe(2);
    expect(semaphore.pendingCount).toBe(3);

    gates[0]?.resolve();
    await flush();

    // Освободившийся слот сразу передан следующему ожидающему.
    expect(started).toEqual([0, 1, 2]);
    expect(semaphore.activeCount).toBe(2);

    gates.forEach((gate) => gate.resolve());
    await Promise.all(runs);

    expect(maxActive).toBe(2);
    expect(semaphore.activeCount).toBe(0);
    expect(semaphore.pendingCount).toBe(0);
  });

  it('освобождает слоты в порядке FIFO', async () => {
    const semaphore = new Semaphore(1);
    const gates = [deferred(), deferred(), deferred()];
    const order: number[] = [];

    const runs = gates.map((gate, index) =>
      semaphore.runAsync(async () => {
        order.push(index);
        await gate.promise;
      }),
    );

    await flush();
    expect(order).toEqual([0]);

    gates[0]?.resolve();
    await flush();
    gates[1]?.resolve();
    await flush();

    expect(order).toEqual([0, 1, 2]);

    gates[2]?.resolve();
    await Promise.all(runs);
  });

  it('освобождение идемпотентно: двойной release не отдаёт лишний слот', async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquireAsync();

    release();
    release();

    expect(semaphore.activeCount).toBe(0);
    await expect(semaphore.acquireAsync()).resolves.toBeTypeOf('function');
    expect(semaphore.activeCount).toBe(1);
  });

  it('некорректный лимит — ошибка конструктора, а не тихое «без ограничения»', () => {
    expect(() => new Semaphore(0)).toThrow(/лимит/);
    expect(() => new Semaphore(-1)).toThrow(/лимит/);
    expect(() => new Semaphore(1.5)).toThrow(/лимит/);
  });
});

describe('Лимиты провайдеров из env (R7.7, KI-067)', () => {
  it('без переменной лимита нет — поведение до R7.7', async () => {
    const registry = new ProviderSemaphoreRegistry({ get: () => undefined });

    expect(registry.forProvider('anthropic')).toBeNull();
    await expect(registry.runAsync('anthropic', () => Promise.resolve(7))).resolves.toBe(
      7,
    );
  });

  it('читает LLM_PROVIDER_MAX_CONCURRENCY_<NAME> и кэширует семафор', () => {
    const registry = new ProviderSemaphoreRegistry({
      get: (key) =>
        key === 'LLM_PROVIDER_MAX_CONCURRENCY_ANTHROPIC' ? '2' : undefined,
    });

    const first = registry.forProvider('anthropic');

    expect(first).toBeInstanceOf(Semaphore);
    expect(first?.limit).toBe(2);
    // Повторный вызов отдаёт тот же семафор: лимит общий на процесс.
    expect(registry.forProvider('anthropic')).toBe(first);
  });

  it('имя провайдера нормализуется в env-ключ', () => {
    expect(concurrencyEnvKey('anthropic')).toBe(
      'LLM_PROVIDER_MAX_CONCURRENCY_ANTHROPIC',
    );
    expect(concurrencyEnvKey('openai-images')).toBe(
      'LLM_PROVIDER_MAX_CONCURRENCY_OPENAI_IMAGES',
    );
  });

  it('парсит число и строку, мусор игнорирует', () => {
    expect(parseConcurrencyLimit(3)).toBe(3);
    expect(parseConcurrencyLimit('5')).toBe(5);
    expect(parseConcurrencyLimit('  ')).toBeUndefined();
    expect(parseConcurrencyLimit('0')).toBeUndefined();
    expect(parseConcurrencyLimit('abc')).toBeUndefined();
    expect(parseConcurrencyLimit('1.5')).toBeUndefined();
    expect(parseConcurrencyLimit(-2)).toBeUndefined();
    expect(parseConcurrencyLimit(undefined)).toBeUndefined();
  });

  it('ограничивает одновременные вызовы конкретного провайдера', async () => {
    const registry = new ProviderSemaphoreRegistry({
      get: (key) =>
        key === 'LLM_PROVIDER_MAX_CONCURRENCY_GPTUNNEL' ? 1 : undefined,
    });
    const gate = deferred();
    let active = 0;
    let maxActive = 0;

    const first = registry.runAsync('gptunnel', async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active -= 1;
    });
    const second = registry.runAsync('gptunnel', async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      active -= 1;
    });

    await flush();
    // Второй вызов ждёт слот, пока первый держит gate.
    expect(maxActive).toBe(1);

    gate.resolve();
    await Promise.all([first, second]);

    expect(maxActive).toBe(1);
  });
});
