import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_EMBEDDING_DIMENSIONS } from '../llm/llm-constants.js';
import type { Database } from '../db/db.module.js';
import * as schema from '../db/schema.js';
import { workflowRuns, workflows } from '../db/schema.js';
import { VectorStoreService } from './vector-store.service.js';

/**
 * Интеграционный тест pgvector на живой PostgreSQL (R7.4a).
 *
 * Проверяет то, что нельзя проверить моками: `CREATE EXTENSION vector`,
 * тип `vector(1536)`, HNSW-индекс и реальный косинусный оператор `<=>`.
 * Запускается только при заданном `DATABASE_URL` (как
 * `schema-parity.spec.ts`): в CI переменная есть после шага `Apply migrations`
 * (RULES 3.19), локально — прогон через `node --env-file=.env`.
 */

/** Схема БД, в которой живут таблицы приложения. */
const TABLE_SCHEMA = 'public';

/**
 * Строит базисный вектор размерности колонки.
 *
 * `[1, 0, 0, …]` и `[0, 1, 0, …]` ортогональны: косинусная близость с первым
 * равна 1 и 0 соответственно — порог 0.5 отделяет их детерминированно, без
 * зависимости от поведения модели эмбеддингов.
 *
 * @param axis - индекс ненулевой компоненты
 * @returns вектор длины {@link DEFAULT_EMBEDDING_DIMENSIONS}
 */
function basisVector(axis: number): number[] {
  const result = Array.from({ length: DEFAULT_EMBEDDING_DIMENSIONS }, () => 0);

  result[axis] = 1;

  return result;
}

describe.skipIf(!process.env.DATABASE_URL)(
  'VectorStoreService + pgvector (R7.4a)',
  () => {
    let pool: Pool | undefined;
    let store: VectorStoreService | undefined;
    let db: NodePgDatabase<typeof schema> | undefined;
    let workflowId = '';
    let runId = '';

    beforeAll(async () => {
      const url = process.env.DATABASE_URL;

      if (!url) {
        throw new Error('DATABASE_URL не задан — интеграционный тест пропущен');
      }

      pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5_000 });
      db = drizzle(pool, { schema });
      // `Database` = клиент + `$client` (тип из `DbModule`); `drizzle()` в
      // типах `$client` не выводит, хотя в рантайме он есть.
      store = new VectorStoreService(db as unknown as Database);

      workflowId = randomUUID();

      await db.insert(workflows).values({
        id: workflowId,
        userId: randomUUID(),
        name: `R7.4a integration ${Date.now()}`,
        nodes: [],
        edges: [],
      });

      runId = randomUUID();

      await db.insert(workflowRuns).values({
        id: runId,
        workflowId,
        status: 'running',
        inputs: {},
        snapshot: { nodes: [], edges: [] },
      });
    }, 30_000);

    afterAll(async () => {
      if (db !== undefined) {
        // CASCADE снимает workflow_vectors, workflow_memory и workflow_runs.
        await db.delete(workflows).where(eq(workflows.id, workflowId));
      }

      if (pool !== undefined) {
        await pool.end();
      }
    });

    it('находит workflow запуска по runId', async () => {
      await expect(store?.findWorkflowIdByRunAsync(runId)).resolves.toBe(workflowId);
    });

    it('upsert → query → topK: находит ближайший вектор и режет по порогу', async () => {
      const service = store;

      if (!service) {
        throw new Error('store не инициализирован');
      }

      await service.insertVectorAsync({
        workflowId,
        collection: 'docs',
        embedding: basisVector(0),
        content: { text: 'первый документ' },
        metadata: { source: 'integration' },
      });
      await service.insertVectorAsync({
        workflowId,
        collection: 'docs',
        embedding: basisVector(1),
        content: { text: 'второй документ' },
        metadata: {},
      });

      // topK=2, порог 0.5: ортогональный вектор (score 0) отбрасывается.
      const matches = await service.queryVectorsAsync({
        workflowId,
        collection: 'docs',
        embedding: basisVector(0),
        topK: 2,
        scoreThreshold: 0.5,
      });

      expect(matches).toHaveLength(1);
      expect(matches[0]?.content).toEqual({ text: 'первый документ' });
      expect(matches[0]?.metadata).toEqual({ source: 'integration' });
      // Косинусная близость одинакового вектора — 1 (float8, допускаем эпсилон).
      expect(matches[0]?.score).toBeCloseTo(1, 5);

      // Порог 0 (topK=2) возвращает оба, порядок — по убыванию score.
      const both = await service.queryVectorsAsync({
        workflowId,
        collection: 'docs',
        embedding: basisVector(0),
        topK: 2,
        scoreThreshold: 0,
      });

      expect(both.map((match) => match.content)).toEqual([
        { text: 'первый документ' },
        { text: 'второй документ' },
      ]);
    });

    it('коллекции изолированы: другая коллекция пуста', async () => {
      const service = store;

      if (!service) {
        throw new Error('store не инициализирован');
      }

      const matches = await service.queryVectorsAsync({
        workflowId,
        collection: 'other',
        embedding: basisVector(0),
        topK: 5,
        scoreThreshold: -1,
      });

      expect(matches).toEqual([]);
    });

    it('memory_write → memory_read: UPSERT обновляет значение', async () => {
      const service = store;

      if (!service) {
        throw new Error('store не инициализирован');
      }

      await service.writeMemoryAsync(workflowId, 'profile', { user: 'Аня' });
      await expect(service.readMemoryAsync(workflowId, 'profile')).resolves.toEqual({
        user: 'Аня',
      });

      await service.writeMemoryAsync(workflowId, 'profile', { user: 'Борис' });
      await expect(service.readMemoryAsync(workflowId, 'profile')).resolves.toEqual({
        user: 'Борис',
      });

      await expect(
        service.readMemoryAsync(workflowId, 'unknown'),
      ).resolves.toBeUndefined();
    });

    it('таблица и HNSW-индекс созданы миграцией 0008', async () => {
      if (db === undefined) {
        throw new Error('db не инициализирован');
      }

      // `pg_indexes` — фактическое состояние БД, а не снапшот drizzle.
      const result = await db.execute<{ indexname: string; indexdef: string }>(
        sql`SELECT indexname, indexdef FROM pg_indexes
             WHERE schemaname = ${TABLE_SCHEMA}
               AND tablename = 'workflow_vectors'`,
      );
      const defs = result.rows.map((row) => row.indexdef).join('\n');

      expect(defs).toContain('USING hnsw');
      expect(defs).toContain('vector_cosine_ops');
    });
  },
);
