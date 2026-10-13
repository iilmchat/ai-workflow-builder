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
    });

    expect(options.WORKFLOW_RUNS_WORKER_OPTIONS).toEqual({
      concurrency: 5,
      lockDuration: 300_000,
      maxStalledCount: 2,
    });
    expect(options.RUN_STALE_THRESHOLD_MS).toBe(300_000);
  });

  it('берёт значения из окружения', async () => {
    const options = await loadOptions({
      WORKFLOW_RUNS_CONCURRENCY: '2',
      WORKFLOW_RUNS_LOCK_DURATION_MS: '120000',
      WORKFLOW_RUNS_MAX_STALLED_COUNT: '3',
      WORKFLOW_RUNS_STALE_THRESHOLD_MS: '60000',
    });

    expect(options.WORKFLOW_RUNS_WORKER_OPTIONS).toEqual({
      concurrency: 2,
      lockDuration: 120_000,
      maxStalledCount: 3,
    });
    // KI-032: lease-порог больше не захардкожен, он из окружения.
    expect(options.RUN_STALE_THRESHOLD_MS).toBe(60_000);
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
