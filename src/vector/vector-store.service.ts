import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { workflowMemory, workflowRuns, workflowVectors } from '../db/schema.js';
import type {
  VectorMatch,
  VectorMemoryStore,
  VectorQueryInput,
  VectorRecordInput,
} from '../engine/node-executors.js';

/**
 * Строка результата косинусного поиска (R7.4a).
 *
 * `db.execute` отдаёт нетипизированные rows: форма внешних данных проверяется
 * Zod'ом на границе (RULES 1.17). `score` — `double precision`, pg возвращает
 * его числом; `z.number()` здесь ещё и ловит неожиданную строку.
 */
const VectorRowSchema = z.object({
  id: z.string(),
  content: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()),
  score: z.number(),
});

/**
 * Хранилище vector/memory-данных поверх PostgreSQL + pgvector (R7.4a).
 *
 * Реализует структурный контракт {@link VectorMemoryStore}, объявленный в
 * `node-executors.ts`: исполнители не знают про Drizzle и Nest, а сервис —
 * единственное место, где живёт SQL.
 *
 * Векторные запросы выполняются raw-SQL'ом: drizzle-query-builder не умеет
 * оператор расстояния `<=>` и `ORDER BY` по нему. Параметр-вектор передаётся
 * текстом (`'[0.1,…]'`) с явным приведением `::vector` — драйвер `pg` не знает
 * типа `vector` и иначе отправил бы массив как `real[]`.
 */
@Injectable()
export class VectorStoreService implements VectorMemoryStore {
  /**
   * @param db - drizzle-клиент (глобальный `DbModule`, RULES 4.10)
   */
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Находит workflow запуска — владельца векторов и памяти.
   *
   * Исполнителям `vector_*`/`memory_*` нужен `workflow_id`, а в контексте
   * выполнения есть только `runId` (снимок графа живёт в `workflow_runs`).
   *
   * @param runId - uuid запуска
   * @returns uuid workflow
   * @throws Error если запуск не найден (запуск без строки истории — ошибка движка)
   */
  async findWorkflowIdByRunAsync(runId: string): Promise<string> {
    const [row] = await this.db
      .select({ workflowId: workflowRuns.workflowId })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .limit(1);

    if (!row) {
      throw new Error(`Запуск ${runId} не найден — workflow для векторов неизвестен`);
    }

    return row.workflowId;
  }

  /**
   * Добавляет вектор в коллекцию workflow.
   *
   * Идемпотентности нет осознанно: upsert-узел может вызываться в цикле и
   * добавлять новые чанки; повторный прогон графа создаёт копии — это
   * документированное поведение R7.4a (см. KI о дедупликации).
   *
   * @param record - workflow, коллекция, вектор, содержимое и метаданные
   * @returns `id` созданной строки
   * @throws Error если INSERT не вернул строку
   */
  async insertVectorAsync(record: VectorRecordInput): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(workflowVectors)
      .values({
        workflowId: record.workflowId,
        collection: record.collection,
        embedding: record.embedding,
        content: record.content,
        metadata: record.metadata,
      })
      .returning({ id: workflowVectors.id });

    if (!row) {
      throw new Error('INSERT в workflow_vectors не вернул id');
    }

    return { id: row.id };
  }

  /**
   * Ищет ближайшие векторы коллекции по косинусной близости.
   *
   * SQL: подзапрос берёт `topK` ближайших по `<=>` (это использует HNSW-индекс
   * `workflow_vectors_embedding_idx`), внешний запрос применяет порог
   * `scoreThreshold` и сортирует по убыванию близости. Порог **после** LIMIT —
   * так semantics «top-K, затем отсечь слабые» сохраняется.
   *
   * @param query - workflow, коллекция, вектор запроса, topK и порог
   * @returns совпадения, отсортированные по убыванию `score`
   * @throws Error если БД вернула строку неожиданной формы
   */
  async queryVectorsAsync(query: VectorQueryInput): Promise<VectorMatch[]> {
    const literal = JSON.stringify(query.embedding);

    const result = await this.db.execute<{
      id: string;
      content: Record<string, unknown>;
      metadata: Record<string, unknown>;
      score: number;
    }>(sql`
      SELECT id, content, metadata, score
        FROM (
          SELECT ${workflowVectors.id} AS id,
                 ${workflowVectors.content} AS content,
                 ${workflowVectors.metadata} AS metadata,
                 1 - (${workflowVectors.embedding} <=> ${literal}::vector) AS score
            FROM ${workflowVectors}
           WHERE ${workflowVectors.workflowId} = ${query.workflowId}
             AND ${workflowVectors.collection} = ${query.collection}
           ORDER BY ${workflowVectors.embedding} <=> ${literal}::vector
           LIMIT ${query.topK}
        ) AS ranked
       WHERE score >= ${query.scoreThreshold}
       ORDER BY score DESC
    `);

    return result.rows.map((row) => {
      const parsed = VectorRowSchema.safeParse(row);

      if (!parsed.success) {
        throw new Error(
          `workflow_vectors: неожиданная форма строки (${parsed.error.issues
            .map((issue) => issue.message)
            .join('; ')})`,
        );
      }

      return parsed.data;
    });
  }

  /**
   * Читает значение памяти workflow по ключу.
   *
   * @param workflowId - владелец памяти
   * @param key - ключ записи
   * @returns сохранённое значение либо `undefined`, если ключа нет
   */
  async readMemoryAsync(workflowId: string, key: string): Promise<unknown> {
    const [row] = await this.db
      .select({ value: workflowMemory.value })
      .from(workflowMemory)
      .where(and(eq(workflowMemory.workflowId, workflowId), eq(workflowMemory.key, key)))
      .limit(1);

    return row ? row.value : undefined;
  }

  /**
   * Записывает значение памяти (UPSERT по `workflow_id` + `key`).
   *
   * `onConflictDoUpdate` использует первичный ключ `(workflow_id, key)`:
   * повторный запуск обновляет значение и `updated_at`, не создавая дубль.
   *
   * @param workflowId - владелец памяти
   * @param key - ключ записи
   * @param value - произвольное JSON-значение
   */
  async writeMemoryAsync(
    workflowId: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    const updatedAt = new Date();

    await this.db
      .insert(workflowMemory)
      .values({ workflowId, key, value, updatedAt })
      .onConflictDoUpdate({
        target: [workflowMemory.workflowId, workflowMemory.key],
        set: { value, updatedAt },
      });
  }
}
