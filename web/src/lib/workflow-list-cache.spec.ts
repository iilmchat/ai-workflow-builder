import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listWorkflowsAsync, type ApiWorkflow } from './api';
import {
  getCachedWorkflowList,
  getWorkflowListRevision,
  invalidateWorkflowListCache,
  loadWorkflowListAsync,
  subscribeWorkflowList,
  WORKFLOW_LIST_TTL_MS,
} from './workflow-list-cache';

// Сеть подменяем целиком: тест проверяет поведение кэша, а не HTTP.
vi.mock('./api', () => ({ listWorkflowsAsync: vi.fn() }));

/**
 * Собирает карточку workflow для тестов.
 *
 * @param id - id workflow (он же имя по умолчанию)
 * @param version - версия графа
 * @returns карточка в форме ответа `GET /workflow`
 */
function workflow(id: string, version = 1): ApiWorkflow {
  return {
    id,
    userId: 'user-1',
    name: id,
    description: null,
    nodes: [],
    edges: [],
    version,
    createdAt: null,
    updatedAt: null,
  };
}

const listWorkflowsMock = vi.mocked(listWorkflowsAsync);

describe('workflow-list-cache (KI-302)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
    listWorkflowsMock.mockReset();
    // Состояние модуля общее на файл: сбрасываем кэш и ревизию между тестами.
    invalidateWorkflowListCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('второй вызов берёт список из кэша, а не из сети', async () => {
    listWorkflowsMock.mockResolvedValue([workflow('a')]);

    const first = await loadWorkflowListAsync();
    const second = await loadWorkflowListAsync();

    expect(first).toEqual(second);
    expect(listWorkflowsMock).toHaveBeenCalledTimes(1);
  });

  it('параллельные вызовы делят один запрос (RULES 4.17)', async () => {
    listWorkflowsMock.mockResolvedValue([workflow('a')]);

    const [first, second] = await Promise.all([
      loadWorkflowListAsync(),
      loadWorkflowListAsync(),
    ]);

    expect(first).toEqual(second);
    expect(listWorkflowsMock).toHaveBeenCalledTimes(1);
  });

  it('инвалидация сбрасывает кэш: следующий вызов видит созданный workflow', async () => {
    listWorkflowsMock.mockResolvedValueOnce([workflow('a')]);
    await loadWorkflowListAsync();

    // Сценарий KI-302: workflow создан в этой же вкладке.
    listWorkflowsMock.mockResolvedValueOnce([workflow('a'), workflow('b')]);
    invalidateWorkflowListCache();

    const afterCreate = await loadWorkflowListAsync();

    expect(afterCreate.map((item) => item.id)).toEqual(['a', 'b']);
    expect(listWorkflowsMock).toHaveBeenCalledTimes(2);
  });

  it('уведомляет подписчиков и увеличивает ревизию', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkflowList(listener);
    const before = getWorkflowListRevision();

    invalidateWorkflowListCache();

    expect(getWorkflowListRevision()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);

    // Отписка отключает уведомления (иначе размонтированный узел тянул бы
    // повторный запрос на каждую инвалидацию).
    unsubscribe();
    invalidateWorkflowListCache();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('по истечении TTL список перечитывается без инвалидации', async () => {
    listWorkflowsMock.mockResolvedValueOnce([workflow('a')]);
    await loadWorkflowListAsync();

    listWorkflowsMock.mockResolvedValueOnce([workflow('a'), workflow('c')]);
    vi.setSystemTime(new Date(Date.now() + WORKFLOW_LIST_TTL_MS));

    const refreshed = await loadWorkflowListAsync();

    expect(refreshed.map((item) => item.id)).toEqual(['a', 'c']);
    expect(listWorkflowsMock).toHaveBeenCalledTimes(2);
  });

  it('ответ, обогнанный инвалидацией, не попадает в кэш', async () => {
    let resolveRequest: (value: ApiWorkflow[]) => void = () => undefined;

    listWorkflowsMock.mockImplementationOnce(
      () =>
        new Promise<ApiWorkflow[]>((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const pending = loadWorkflowListAsync();

    // Инвалидация происходит, пока запрос ещё летит: его ответ уже устарел.
    invalidateWorkflowListCache();
    resolveRequest([workflow('stale')]);
    await pending;

    expect(getCachedWorkflowList()).toBeNull();
  });

  it('после инвалидации новый вызов не переиспользует устаревший летящий запрос', async () => {
    const resolvers: Array<(value: ApiWorkflow[]) => void> = [];

    listWorkflowsMock.mockImplementation(
      () =>
        new Promise<ApiWorkflow[]>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const stale = loadWorkflowListAsync();

    invalidateWorkflowListCache();
    const fresh = loadWorkflowListAsync();

    expect(listWorkflowsMock).toHaveBeenCalledTimes(2);

    // Старый ответ приходит последним — он не должен перезаписать свежий.
    resolvers[1]?.([workflow('fresh')]);
    resolvers[0]?.([workflow('stale')]);
    await Promise.all([stale, fresh]);

    expect(getCachedWorkflowList()?.map((item) => item.id)).toEqual(['fresh']);
  });

  it('ошибка не кэшируется: следующий вызов снова идёт в сеть', async () => {
    listWorkflowsMock.mockRejectedValueOnce(new Error('network'));
    await expect(loadWorkflowListAsync()).rejects.toThrow('network');

    listWorkflowsMock.mockResolvedValueOnce([workflow('a')]);
    const recovered = await loadWorkflowListAsync();

    expect(recovered.map((item) => item.id)).toEqual(['a']);
    expect(listWorkflowsMock).toHaveBeenCalledTimes(2);
  });
});
