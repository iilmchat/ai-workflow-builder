import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ILlmProvider } from './llm-provider.interface.js';
import {
  LLM_HEALTH_FAILURE_THRESHOLD,
  LLM_HEALTH_INTERVAL_MS,
  LLM_HEALTH_RECOVERY_PING_DELAY_MS,
  LlmHealthService,
} from './llm-health.service.js';
import { LlmRegistryService } from './llm-registry.service.js';

/** Провайдер-заглушка с управляемым пингом. */
interface PingStub {
  /** Заглушка провайдера для реестра. */
  provider: ILlmProvider;
  /** Мок `isAvailableAsync`. */
  isAvailableAsync: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
}

/**
 * Собирает локального провайдера, отвечающего на пинг заданным образом.
 *
 * @param results - очередь ответов `isAvailableAsync`; исчерпание — последний ответ
 * @returns заглушка и её мок
 */
function stubLocal(results: boolean[]): PingStub {
  const isAvailableAsync = vi.fn(() => {
    const next = results.length > 1 ? results.shift() : results[0];

    return Promise.resolve(next ?? false);
  });

  return {
    provider: {
      name: 'lmstudio',
      models: [
        {
          id: 'qwen-local',
          label: 'qwen-local',
          inputModalities: ['text'],
          outputModalities: ['text'],
        },
      ],
      isConfigured: true,
      isLocal: true,
      isAvailableAsync,
      generateAsync: vi.fn(),
      embedAsync: vi.fn(),
    },
    isAvailableAsync,
  };
}

/**
 * Собирает healthcheck с фейковым реестром.
 *
 * @param local - локальный провайдер либо `undefined`
 * @returns экземпляр сервиса
 */
async function createHealth(local?: ILlmProvider): Promise<LlmHealthService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      LlmHealthService,
      {
        provide: LlmRegistryService,
        useValue: { findLocalProvider: vi.fn(() => local) },
      },
    ],
  }).compile();

  return moduleRef.get(LlmHealthService);
}

describe('LlmHealthService (v1.2 S1)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('первая успешная проверка — available; дальше пинг не нужен', async () => {
    const local = stubLocal([true]);
    const health = await createHealth(local.provider);

    await expect(health.checkAsync()).resolves.toBe(true);
    expect(health.getStatus()).toBe('available');

    await expect(health.isAvailableAsync()).resolves.toBe(true);
    // Статус известен — повторный HTTP-пинг не выполняется.
    expect(local.isAvailableAsync).toHaveBeenCalledTimes(1);
  });

  it(`после ${LLM_HEALTH_FAILURE_THRESHOLD} неудач подряд — unavailable`, async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const local = stubLocal([false]);
    const health = await createHealth(local.provider);

    for (let attempt = 1; attempt <= LLM_HEALTH_FAILURE_THRESHOLD; attempt += 1) {
      await expect(health.checkAsync()).resolves.toBe(false);
    }

    expect(health.getStatus()).toBe('unavailable');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`${LLM_HEALTH_FAILURE_THRESHOLD} проверки подряд`),
    );

    // Статус unavailable — роутер не дёргает сервер, пока не придёт следующий тик.
    await expect(health.isAvailableAsync()).resolves.toBe(false);
    expect(local.isAvailableAsync).toHaveBeenCalledTimes(LLM_HEALTH_FAILURE_THRESHOLD);
  });

  it('две неудачи подряд порог не включают', async () => {
    const local = stubLocal([false]);
    const health = await createHealth(local.provider);

    await health.checkAsync();
    await health.checkAsync();

    expect(health.getStatus()).toBe('unknown');

    // Третья проверка (через isAvailableAsync при unknown) добивает порог.
    await expect(health.isAvailableAsync()).resolves.toBe(false);
    expect(health.getStatus()).toBe('unavailable');
  });

  it('успех после недоступности возвращает провайдера в роутинг', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const local = stubLocal([false, false, false, true]);
    const health = await createHealth(local.provider);

    for (let attempt = 0; attempt < LLM_HEALTH_FAILURE_THRESHOLD; attempt += 1) {
      await health.checkAsync();
    }

    expect(health.getStatus()).toBe('unavailable');

    await expect(health.checkAsync()).resolves.toBe(true);
    expect(health.getStatus()).toBe('available');
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('снова доступен'),
    );
  });

  it('успех сбрасывает счётчик неудач', async () => {
    const local = stubLocal([false, false, true, false, false]);
    const health = await createHealth(local.provider);

    await health.checkAsync();
    await health.checkAsync();
    await health.checkAsync();
    expect(health.getStatus()).toBe('available');

    await health.checkAsync();
    await health.checkAsync();

    // После сброса две новые неудачи — ещё не порог.
    expect(health.getStatus()).toBe('available');
  });

  it('без локального провайдера — false и статус unknown (не «недоступен»)', async () => {
    const health = await createHealth();

    await expect(health.checkAsync()).resolves.toBe(false);
    await expect(health.isAvailableAsync()).resolves.toBe(false);
    expect(health.getStatus()).toBe('unknown');
    // Пинга не было — «последней проверки» тоже нет (KI-618).
    expect(health.getLastCheckAt()).toBe('');
  });

  describe('getLastCheckAt (v1.2.0 S3, KI-618)', () => {
    it('до первой проверки — пустая строка, после успешной — ISO-строка', async () => {
      const local = stubLocal([true]);
      const health = await createHealth(local.provider);

      // Healthcheck ещё не выполнялся: lastCheck = '' (а не «сейчас»).
      expect(health.getLastCheckAt()).toBe('');

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-06T10:00:00.000Z'));

      await expect(health.checkAsync()).resolves.toBe(true);
      expect(health.getLastCheckAt()).toBe('2026-11-06T10:00:00.000Z');
      // Возвращается именно ISO-строка, пригодная для JSON/Date.parse.
      expect(Number.isNaN(Date.parse(health.getLastCheckAt()))).toBe(false);

      // Каждая завершённая проверка сдвигает время вперёд.
      vi.setSystemTime(new Date('2026-11-06T10:00:30.000Z'));
      await expect(health.checkAsync()).resolves.toBe(true);
      expect(health.getLastCheckAt()).toBe('2026-11-06T10:00:30.000Z');
    });

    it('неуспешная проверка тоже обновляет lastCheck: она завершилась', async () => {
      const local = stubLocal([false]);
      const health = await createHealth(local.provider);

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-06T10:01:00.000Z'));

      await expect(health.checkAsync()).resolves.toBe(false);
      // Статус остаётся unknown (порог не достигнут), но проверка была.
      expect(health.getStatus()).toBe('unknown');
      expect(health.getLastCheckAt()).toBe('2026-11-06T10:01:00.000Z');
    });
  });

  it('isAvailableAsync при unknown делает реальную проверку', async () => {
    const local = stubLocal([true]);
    const health = await createHealth(local.provider);

    await expect(health.isAvailableAsync()).resolves.toBe(true);
    expect(local.isAvailableAsync).toHaveBeenCalledTimes(1);
    expect(health.getStatus()).toBe('available');
  });

  it('параллельные isAvailableAsync при unknown дают один пинг', async () => {
    const local = stubLocal([true]);
    const health = await createHealth(local.provider);

    await Promise.all([
      health.isAvailableAsync(),
      health.isAvailableAsync(),
      health.isAvailableAsync(),
    ]);

    expect(local.isAvailableAsync).toHaveBeenCalledTimes(1);
  });

  it('start() запускает интервал и делает первую проверку сразу; stop() снимает таймер', async () => {
    vi.useFakeTimers();
    const local = stubLocal([true]);
    const health = await createHealth(local.provider);

    health.start();
    // Первая проверка стартует сразу, не дожидаясь 30 с.
    await vi.advanceTimersByTimeAsync(0);
    expect(local.isAvailableAsync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(LLM_HEALTH_INTERVAL_MS);
    expect(local.isAvailableAsync).toHaveBeenCalledTimes(2);
    expect(health.getStatus()).toBe('available');

    health.stop();
    await vi.advanceTimersByTimeAsync(LLM_HEALTH_INTERVAL_MS * 2);
    expect(local.isAvailableAsync).toHaveBeenCalledTimes(2);
  });

  it('start() идемпотентен: второй вызов не создаёт второй таймер', async () => {
    vi.useFakeTimers();
    const local = stubLocal([true]);
    const health = await createHealth(local.provider);

    health.start();
    health.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(LLM_HEALTH_INTERVAL_MS);

    expect(local.isAvailableAsync).toHaveBeenCalledTimes(2);

    health.stop();
  });

  describe('внеочередной пинг после восстановления (v1.3.0 S2, KI-621)', () => {
    it('после восстановления пинг ровно через 5 с и без цикла', async () => {
      vi.useFakeTimers();
      vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      // Три неудачи подряд (порог), затем успех — восстановление.
      const local = stubLocal([false, false, false, true, true]);
      const health = await createHealth(local.provider);

      health.start();
      // Пинг №1 — сразу при старте, не дожидаясь интервала.
      await vi.advanceTimersByTimeAsync(0);
      expect(local.isAvailableAsync).toHaveBeenCalledTimes(1);

      // Пинги №2 и №3 — обычные тики; на третьей неудаче статус unavailable.
      await vi.advanceTimersByTimeAsync(LLM_HEALTH_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(LLM_HEALTH_INTERVAL_MS);
      expect(local.isAvailableAsync).toHaveBeenCalledTimes(3);
      expect(health.getStatus()).toBe('unavailable');

      // Пинг №4 — успех на очередном тике: восстановление и внеочередной пинг.
      await vi.advanceTimersByTimeAsync(LLM_HEALTH_INTERVAL_MS);
      expect(local.isAvailableAsync).toHaveBeenCalledTimes(4);
      expect(health.getStatus()).toBe('available');

      // Раньше 5 с внеочередного пинга нет.
      await vi.advanceTimersByTimeAsync(LLM_HEALTH_RECOVERY_PING_DELAY_MS - 1);
      expect(local.isAvailableAsync).toHaveBeenCalledTimes(4);

      // Ровно через 5 с — внеочередной пинг №5.
      await vi.advanceTimersByTimeAsync(1);
      expect(local.isAvailableAsync).toHaveBeenCalledTimes(5);

      // Цикла нет: до следующего обычного тика новых пингов не появляется.
      await vi.advanceTimersByTimeAsync(
        LLM_HEALTH_INTERVAL_MS - LLM_HEALTH_RECOVERY_PING_DELAY_MS - 1,
      );
      expect(local.isAvailableAsync).toHaveBeenCalledTimes(5);

      // Следующий пинг — только по обычному тику 30 с (пинг №6).
      await vi.advanceTimersByTimeAsync(1);
      expect(local.isAvailableAsync).toHaveBeenCalledTimes(6);

      health.stop();
    });

    it('stop() отменяет запланированный внеочередной пинг', async () => {
      vi.useFakeTimers();
      vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const local = stubLocal([false, false, false, true, true]);
      const health = await createHealth(local.provider);

      health.start();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(LLM_HEALTH_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(LLM_HEALTH_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(LLM_HEALTH_INTERVAL_MS);
      expect(local.isAvailableAsync).toHaveBeenCalledTimes(4);
      expect(health.getStatus()).toBe('available');

      // Внеочередной пинг ещё не сработал — stop() должен его снять.
      health.stop();
      await vi.advanceTimersByTimeAsync(LLM_HEALTH_INTERVAL_MS);
      expect(local.isAvailableAsync).toHaveBeenCalledTimes(4);
    });

    it('неудачный внеочередной пинг не зацикливает проверки и не выводит из роутинга', async () => {
      vi.useFakeTimers();
      vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      // Восстановление, затем неудача внеочередного пинга и обычного тика.
      const local = stubLocal([false, false, false, true, false, false, false]);
      const health = await createHealth(local.provider);

      health.start();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(LLM_HEALTH_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(LLM_HEALTH_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(LLM_HEALTH_INTERVAL_MS);
      expect(health.getStatus()).toBe('available');

      // Внеочередной пинг №5 — неудача: порог 3 не достигнут, статус available.
      await vi.advanceTimersByTimeAsync(LLM_HEALTH_RECOVERY_PING_DELAY_MS);
      expect(local.isAvailableAsync).toHaveBeenCalledTimes(5);
      expect(health.getStatus()).toBe('available');
      // Провайдер остаётся в роутинге — повторного пинга не требуется.
      await expect(health.isAvailableAsync()).resolves.toBe(true);
      expect(local.isAvailableAsync).toHaveBeenCalledTimes(5);

      // Новый внеочередной пинг не запланирован: до обычного тика тишина.
      await vi.advanceTimersByTimeAsync(
        LLM_HEALTH_INTERVAL_MS - LLM_HEALTH_RECOVERY_PING_DELAY_MS - 1,
      );
      expect(local.isAvailableAsync).toHaveBeenCalledTimes(5);

      // Обычный тик через 30 с — пинг №6 (тоже неудача, но статус ещё available).
      await vi.advanceTimersByTimeAsync(1);
      expect(local.isAvailableAsync).toHaveBeenCalledTimes(6);
      expect(health.getStatus()).toBe('available');

      health.stop();
    });
  });
});
