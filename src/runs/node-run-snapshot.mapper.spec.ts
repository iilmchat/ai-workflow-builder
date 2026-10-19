import { Test } from '@nestjs/testing';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { nodeRuns, type NodeRun } from '../db/schema.js';
import type { GraphSnapshotDto } from '../engine/dto/index.js';
import {
  MEDIA_STORAGE,
  type IMediaStorage,
} from '../media/media-storage.service.js';
import { buildSignedMediaPath } from '../media/media-url-signer.js';
import { NodeRunSnapshotMapper } from './node-run-snapshot.mapper.js';

/** uuid запуска в тестах. */
const RUN_ID = '22222222-2222-4222-8222-222222222222';

/**
 * Создаёт строку `node_runs` с дефолтами.
 *
 * @param overrides - поля, которые нужно переопределить
 * @returns строка таблицы `node_runs`
 */
function nodeRun(overrides: Partial<NodeRun> = {}): NodeRun {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    runId: RUN_ID,
    nodeId: 'A',
    nodeType: 'llm',
    status: 'completed',
    inputs: {},
    outputs: { text: 'привет' },
    error: null,
    logs: null,
    tokensIn: null,
    tokensOut: null,
    costUsd: null,
    costRub: null,
    durationMs: 5,
    startedAt: new Date('2024-01-01T00:00:01.000Z'),
    finishedAt: new Date('2024-01-01T00:00:01.005Z'),
    ...overrides,
    // R7.7/R7.8: nullable-колонки — после spread`а возвращаем к `… | null`,
    // иначе `Partial<NodeRun>` расширяет тип до `| undefined`.
    cacheReadTokens: overrides.cacheReadTokens ?? null,
    cacheCreationTokens: overrides.cacheCreationTokens ?? null,
    storedUrl: overrides.storedUrl ?? null,
    storedExpiresAt: overrides.storedExpiresAt ?? null,
    storageKey: overrides.storageKey ?? null,
  };
}

/**
 * Собирает снимок графа с одним узлом `A` (и, при необходимости, моделью).
 *
 * @param model - значение `data.model` узла (`undefined` — модели нет)
 * @returns снимок графа
 */
function graphWithModel(model?: string): GraphSnapshotDto {
  return {
    nodes: [
      {
        id: 'A',
        type: 'llm',
        data: model === undefined ? {} : { model },
      },
    ],
    edges: [],
  };
}

/**
 * Заглушка Drizzle для `listAsync`: отдаёт фиксированные строки `node_runs`.
 *
 * @param rows - строки, которые вернёт запрос
 * @returns заглушка БД и spy `orderBy` (проверка порядка выборки)
 */
function dbStub(rows: NodeRun[]): {
  db: Database;
  orderBy: ReturnType<typeof vi.fn>;
} {
  const orderBy = vi.fn(() => Promise.resolve(rows));

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy }),
      }),
    }),
  } as unknown as Database;

  return { db, orderBy };
}

/**
 * Собирает маппер на заглушках БД и хранилища.
 *
 * @param options - строки `node_runs` и переопределения media-хранилища
 * @returns маппер, хранилище и spy `orderBy`
 */
async function createMapper(options: {
  rows?: NodeRun[];
  storage?: Partial<IMediaStorage>;
} = {}): Promise<{
  mapper: NodeRunSnapshotMapper;
  storage: IMediaStorage & {
    refreshStoredUrlAsync: ReturnType<typeof vi.fn>;
    refreshStoredUrlByKeyAsync: ReturnType<typeof vi.fn>;
  };
  orderBy: ReturnType<typeof vi.fn>;
}> {
  const { db, orderBy } = dbStub(options.rows ?? []);
  const storage = {
    backend: 'local' as const,
    uploadAsync: vi.fn(() => Promise.resolve(null)),
    saveGeneratedAsync: vi.fn(() => Promise.resolve({ url: null, key: null })),
    openAsync: vi.fn(() => Promise.resolve(null)),
    refreshStoredUrlAsync: vi.fn(() => Promise.resolve(null)),
    refreshStoredUrlByKeyAsync: vi.fn(() => Promise.resolve(null)),
    ...options.storage,
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      NodeRunSnapshotMapper,
      { provide: DRIZZLE, useValue: db },
      { provide: MEDIA_STORAGE, useValue: storage },
    ],
  }).compile();

  return {
    mapper: moduleRef.get(NodeRunSnapshotMapper),
    storage: storage as unknown as IMediaStorage & {
      refreshStoredUrlAsync: ReturnType<typeof vi.fn>;
      refreshStoredUrlByKeyAsync: ReturnType<typeof vi.fn>;
    },
    orderBy,
  };
}

describe('NodeRunSnapshotMapper (v0.11 S12, DESIGN § 3.4.2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('toSnapshotAsync', () => {
    it('маппит строку в публичный снимок: ISO-даты, строковые cost-поля, null-safe объекты', async () => {
      const { mapper } = await createMapper();
      const row = nodeRun({
        status: 'failed',
        error: 'HTTP 404',
        logs: ['попытка 1/3'],
        tokensIn: 10,
        tokensOut: 20,
        costUsd: '0.000300',
        // Drizzle `numeric` без mode отдаёт значение строкой.
        costRub: '0.600000',
        cacheCreationTokens: 7,
      });

      const snapshot = await mapper.toSnapshotAsync(row, graphWithModel());

      expect(snapshot).toEqual({
        nodeId: 'A',
        nodeType: 'llm',
        status: 'failed',
        inputs: {},
        outputs: { text: 'привет' },
        error: 'HTTP 404',
        logs: ['попытка 1/3'],
        tokensIn: 10,
        tokensOut: 20,
        costUsd: '0.000300',
        costRub: '0.600000',
        cacheReadTokens: null,
        cacheCreationTokens: 7,
        // Модели в графе нет — экономию посчитать нельзя.
        cacheSavingsUsd: null,
        storedUrl: null,
        storedExpiresAt: null,
        durationMs: 5,
        startedAt: '2024-01-01T00:00:01.000Z',
        finishedAt: '2024-01-01T00:00:01.005Z',
      });
    });

    it('пересчитывает cacheSavingsUsd по модели узла из снимка графа (R7.7, KI-055)', async () => {
      const { mapper } = await createMapper();
      // gpt-4o: вход 2.5 $/M, кэш-чтение 1.25 $/M → 1000 токенов дают 0.00125.
      const row = nodeRun({ cacheReadTokens: 1000 });

      const snapshot = await mapper.toSnapshotAsync(row, graphWithModel('gpt-4o'));

      expect(snapshot.cacheReadTokens).toBe(1000);
      expect(snapshot.cacheSavingsUsd).toBe(0.00125);
    });

    it('cacheSavingsUsd = null, если узла нет в снимке графа (удалён после запуска)', async () => {
      const { mapper } = await createMapper();
      const row = nodeRun({ nodeId: 'removed', cacheReadTokens: 1000 });

      const snapshot = await mapper.toSnapshotAsync(row, graphWithModel('gpt-4o'));

      expect(snapshot.nodeId).toBe('removed');
      expect(snapshot.cacheSavingsUsd).toBeNull();
    });

    it('переподписывает просроченный stored_url и его копии в outputs (KI-443/KI-464)', async () => {
      const oldUrl = 'https://s3.test/doc/run-1/A.docx?X-Amz-Signature=old';
      const freshUrl = 'https://s3.test/doc/run-1/A.docx?X-Amz-Signature=new';
      const freshExpiresAt = new Date(Date.now() + 3_600_000);
      const { mapper, storage } = await createMapper({
        storage: {
          refreshStoredUrlByKeyAsync: vi.fn(() =>
            Promise.resolve({ storedUrl: freshUrl, storedExpiresAt: freshExpiresAt }),
          ),
        },
      });
      const row = nodeRun({
        nodeType: 'document_gen',
        outputs: {
          fileUrl: oldUrl,
          storedUrl: oldUrl,
          mediaUrl: 'https://cdn/provider.png',
        },
        storedUrl: oldUrl,
        storedExpiresAt: new Date(Date.now() - 60_000),
        storageKey: 'run-1/A.docx',
      });

      const snapshot = await mapper.toSnapshotAsync(row, graphWithModel());

      // Ключ объекта — приоритетный путь: URL не парсится (KI-464).
      expect(storage.refreshStoredUrlByKeyAsync).toHaveBeenCalledWith(
        'run-1/A.docx',
      );
      expect(storage.refreshStoredUrlAsync).not.toHaveBeenCalled();
      expect(snapshot.storedUrl).toBe(freshUrl);
      expect(snapshot.storedExpiresAt).toBe(freshExpiresAt.toISOString());
      // Обе копии ссылки обновлены, ссылка провайдера не тронута.
      expect(snapshot.outputs).toEqual({
        fileUrl: freshUrl,
        storedUrl: freshUrl,
        mediaUrl: 'https://cdn/provider.png',
      });
    });

    it('свежий stored_url не переподписывается', async () => {
      const { mapper, storage } = await createMapper();
      const row = nodeRun({
        storedUrl: 'https://s3.test/media/run-1/A.png?X-Amz-Signature=live',
        storedExpiresAt: new Date(Date.now() + 60_000),
      });

      const snapshot = await mapper.toSnapshotAsync(row, graphWithModel());

      expect(storage.refreshStoredUrlAsync).not.toHaveBeenCalled();
      expect(storage.refreshStoredUrlByKeyAsync).not.toHaveBeenCalled();
      expect(snapshot.storedUrl).toBe(row.storedUrl);
    });

    it('истёкшая HMAC-подпись перевыпускается, хотя файловый TTL ещё не вышел (KI-415)', async () => {
      const key = 'run-1/A.png';
      // Подпись выпущена два часа назад при часом сроке — сама ссылка истекла,
      // а `stored_expires_at` (хранение файла) ещё в будущем.
      const expired = buildSignedMediaPath(
        key,
        { secret: 'unit-test-media-signing-secret', ttlSeconds: 3600 },
        new Date(Date.now() - 2 * 60 * 60 * 1000),
      );
      const freshUrl = buildSignedMediaPath(
        key,
        { secret: 'unit-test-media-signing-secret', ttlSeconds: 3600 },
      ).path;
      const { mapper, storage } = await createMapper({
        storage: {
          refreshStoredUrlByKeyAsync: vi.fn(() =>
            Promise.resolve({
              storedUrl: freshUrl,
              storedExpiresAt: new Date(Date.now() + 3_600_000),
            }),
          ),
        },
      });
      const row = nodeRun({
        storedUrl: expired.path,
        storedExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        storageKey: key,
      });

      const snapshot = await mapper.toSnapshotAsync(row, graphWithModel());

      expect(storage.refreshStoredUrlByKeyAsync).toHaveBeenCalledWith(key);
      expect(snapshot.storedUrl).toBe(freshUrl);
    });

    it('ошибка хранилища не ломает снимок — остаётся исходная ссылка (RULES 4.18)', async () => {
      const oldUrl = 'https://s3.test/media/run-1/A.png?X-Amz-Signature=old';
      const { mapper } = await createMapper({
        storage: {
          refreshStoredUrlAsync: vi.fn(() =>
            Promise.reject(new Error('S3 connection refused')),
          ),
        },
      });
      const row = nodeRun({
        storedUrl: oldUrl,
        storedExpiresAt: new Date(Date.now() - 60_000),
      });

      const snapshot = await mapper.toSnapshotAsync(row, graphWithModel());

      expect(snapshot.storedUrl).toBe(oldUrl);
    });
  });

  describe('listAsync', () => {
    it('читает node_runs запуска с порядком по nodeId и маппит каждую строку', async () => {
      const { mapper, orderBy } = await createMapper({
        rows: [
          nodeRun({ nodeId: 'A', cacheReadTokens: 1000 }),
          nodeRun({ nodeId: 'B', nodeType: 'text' }),
        ],
      });

      const snapshots = await mapper.listAsync(RUN_ID, graphWithModel('gpt-4o'));

      expect(orderBy).toHaveBeenCalledWith(nodeRuns.nodeId);
      expect(snapshots).toHaveLength(2);
      expect(snapshots[0]?.nodeId).toBe('A');
      expect(snapshots[1]?.nodeId).toBe('B');
      // Модель из снимка графа применена к строке A — экономия посчитана.
      expect(snapshots[0]?.cacheSavingsUsd).toBe(0.00125);
    });

    it('возвращает пустой массив, если запуск ещё не выполнил ни одного узла', async () => {
      const { mapper } = await createMapper({ rows: [] });

      await expect(mapper.listAsync(RUN_ID, graphWithModel())).resolves.toEqual([]);
    });
  });
});
