import { hostname } from 'node:os';
import { resolveInstanceId } from './runs.worker-options.js';

/**
 * Загружает модуль настроек воркера заново с заданным окружением.
 *
 * Модуль разбирает `process.env` в момент загрузки, поэтому для проверки разных
 * значений нужен свежий импорт (`vi.resetModules`).
 *
 * @param env - переменные для подстановки; `undefined` — удалить переменную
 * @returns загруженный модуль настроек воркера
 */
async function loadOptions(
  env: Record<string, string | undefined>,
): Promise<typeof import('./runs.worker-options.js')> {
  const saved = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(env)) {
    saved.set(key, process.env[key]);

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  vi.resetModules();

  try {
    return await import('./runs.worker-options.js');
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('resolveInstanceId (KI-391)', () => {
  it('явный INSTANCE_ID важнее hostname и порта', () => {
    expect(resolveInstanceId('prod-eu', 'node-1', '3100')).toBe('prod-eu');
  });

  it('обрезает пробелы у явного INSTANCE_ID', () => {
    expect(resolveInstanceId('  smoke  ', 'node-1', '3100')).toBe('smoke');
  });

  it('строит стабильный hostname:PORT', () => {
    expect(resolveInstanceId(undefined, 'node-1', '3100')).toBe('node-1:3100');
  });

  it('без PORT подставляет 3000', () => {
    expect(resolveInstanceId(undefined, 'node-1', undefined)).toBe(
      'node-1:3000',
    );
    expect(resolveInstanceId(undefined, 'node-1', '')).toBe('node-1:3000');
  });

  it('пустой explicit игнорируется (пустая строка из .env)', () => {
    expect(resolveInstanceId('', 'node-1', '3100')).toBe('node-1:3100');
  });
});

describe('WORKFLOW_RUNS_WORKER_OPTIONS и RUN_STALE_THRESHOLD_MS (KI-065, KI-032)', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('использует дефолты, когда переменные окружения не заданы', async () => {
    const options = await loadOptions({
      WORKFLOW_RUNS_CONCURRENCY: undefined,
      WORKFLOW_RUNS_LOCK_DURATION_MS: undefined,
      WORKFLOW_RUNS_MAX_STALLED_COUNT: undefined,
      WORKFLOW_RUNS_STALE_THRESHOLD_MS: undefined,
      BULLMQ_PREFIX: undefined,
      REDIS_QUEUE_DB: undefined,
      INSTANCE_ID: undefined,
    });

    expect(options.WORKFLOW_RUNS_WORKER_OPTIONS).toEqual({
      concurrency: 5,
      lockDuration: 300_000,
      maxStalledCount: 2,
      // KI-387: воркер слушает префикс очереди, а не дефолтный `bull`.
      prefix: 'workflow-runs',
    });
    expect(options.RUN_STALE_THRESHOLD_MS).toBe(300_000);
    expect(options.RUNS_QUEUE_DB).toBe(0);
    // KI-391: без INSTANCE_ID идентификатор стабилен — hostname:PORT.
    expect(options.RUNS_INSTANCE_ID).toBe(`${hostname()}:3000`);
  });

  it('берёт значения из окружения', async () => {
    const options = await loadOptions({
      WORKFLOW_RUNS_CONCURRENCY: '2',
      WORKFLOW_RUNS_LOCK_DURATION_MS: '120000',
      WORKFLOW_RUNS_MAX_STALLED_COUNT: '3',
      WORKFLOW_RUNS_STALE_THRESHOLD_MS: '60000',
      BULLMQ_PREFIX: 'workflow-runs-dev',
      REDIS_QUEUE_DB: '2',
      INSTANCE_ID: 'dev-instance',
      PORT: '3100',
    });

    expect(options.WORKFLOW_RUNS_WORKER_OPTIONS).toEqual({
      concurrency: 2,
      lockDuration: 120_000,
      maxStalledCount: 3,
      prefix: 'workflow-runs-dev',
    });
    // KI-032: lease-порог больше не захардкожен, он из окружения.
    expect(options.RUN_STALE_THRESHOLD_MS).toBe(60_000);
    // KI-387: БД Redis и маркер инстанса тоже из окружения.
    expect(options.RUNS_QUEUE_DB).toBe(2);
    // KI-391: явный INSTANCE_ID важнее hostname:PORT.
    expect(options.RUNS_INSTANCE_ID).toBe('dev-instance');
  });

  it('KI-391: без INSTANCE_ID идентификатор стабилен между рестартами', async () => {
    // Модуль перечитывается (vi.resetModules) — как два процесса на одном
    // хосте/порту: идентификаторы обязаны совпасть, иначе новый воркер
    // пропустит задание прежнего и run останется в `pending`.
    const first = await loadOptions({ INSTANCE_ID: undefined, PORT: '4100' });
    const second = await loadOptions({ INSTANCE_ID: undefined, PORT: '4100' });

    expect(first.RUNS_INSTANCE_ID).toBe(`${hostname()}:4100`);
    expect(second.RUNS_INSTANCE_ID).toBe(first.RUNS_INSTANCE_ID);
  });

  it('KI-391: без PORT берёт 3000', async () => {
    const options = await loadOptions({
      INSTANCE_ID: undefined,
      PORT: undefined,
    });

    expect(options.RUNS_INSTANCE_ID).toBe(`${hostname()}:3000`);
  });

  it('падает с понятной ошибкой на нечисловом значении', async () => {
    await expect(loadOptions({ WORKFLOW_RUNS_CONCURRENCY: 'abc' })).rejects.toThrow(
      'Некорректные настройки воркера очереди workflow-runs',
    );
  });

  it('падает на значении вне границ (concurrency = 100)', async () => {
    await expect(loadOptions({ WORKFLOW_RUNS_CONCURRENCY: '100' })).rejects.toThrow(
      'Некорректные настройки воркера очереди workflow-runs',
    );
  });
});
