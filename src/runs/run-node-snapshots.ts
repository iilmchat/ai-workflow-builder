/**
 * Чтение и проекция `node_runs` в REST/SSE-представление (v0.10.2, KI-450).
 *
 * До KI-450 маппинг строк `node_runs` жил только в `RunsStreamService`: SSE-
 * снимок умел отдавать узлы, а `GET /runs/:id` — нет, поэтому после F5 без SSE
 * панель не могла восстановить результаты. Логика вынесена сюда, чтобы оба
 * пути отдавали **одну и ту же** проекцию: одинаковые поля, ISO-даты,
 * переподписанные `stored_url` и `storedUrl`/`fileUrl` в `outputs` (KI-464).
 *
 * Функции принимают зависимости параметрами (`db`, `mediaStorage`), а не через
 * Nest-DI: их вызывают два сервиса, которые уже получили эти зависимости в
 * конструкторе, — отдельный провайдер ради двух чистых операций не нужен.
 */
import { eq } from 'drizzle-orm';
import { Logger } from '@nestjs/common';
import type { Database } from '../db/db.module.js';
import { nodeRuns, type NodeRun } from '../db/schema.js';
import type { GraphSnapshotDto } from '../engine/dto/index.js';
import { calculateCacheSavingsUsd } from '../llm/model-pricing.js';
import type { IMediaStorage } from '../media/media-storage.service.js';
import { parseSignedMediaUrlExpiry } from '../media/media-url-signer.js';
import type { NodeRunSnapshot } from './dto/index.js';

/** Логгер модуля: ошибки переподписи ссылок не должны молча теряться. */
const logger = new Logger('RunNodeSnapshots');

/**
 * Читает все `node_runs` запуска и приводит их к представлению снимка.
 *
 * Порядок по `nodeId` детерминирован (в отличие от nullable `started_at`):
 * UI сортирует узлы сам. Переподпись просроченных ссылок выполняется
 * параллельно (`Promise.all`) — независимые подписи не должны идти в цикле
 * (RULES 4.17).
 *
 * @param db - соединение Drizzle
 * @param runId - uuid запуска
 * @param snapshot - снимок графа запуска (нужен `data.model` узла)
 * @param mediaStorage - хранилище media-результатов (переподпись ссылок)
 * @returns узлы в форме `NodeRunSnapshot` (без запуска)
 */
export async function loadRunNodeSnapshotsAsync(
  db: Database,
  runId: string,
  snapshot: GraphSnapshotDto,
  mediaStorage: IMediaStorage,
): Promise<NodeRunSnapshot[]> {
  const rows = await db
    .select()
    .from(nodeRuns)
    .where(eq(nodeRuns.runId, runId))
    .orderBy(nodeRuns.nodeId);

  return Promise.all(
    rows.map((row) => toNodeSnapshotAsync(row, snapshot, mediaStorage)),
  );
}

/**
 * Приводит строку `node_runs` к узлу снимка (даты — ISO, `cost_usd` — строка,
 * как её отдаёт колонка `numeric`).
 *
 * **R7.7 (KI-055):** `cacheSavingsUsd` в БД не хранится — он пересчитывается
 * здесь по модели узла из снимка графа и `cacheReadTokens` (тарифы живут
 * только в `model-pricing.ts`). Без модели (узел удалён/тип без модели)
 * экономия — `null`, токены при этом всё равно отдаются.
 *
 * **KI-443/KI-464:** просроченный `stored_url` переподписывается при чтении, а
 * его копии в `outputs` (`storedUrl`/`fileUrl` у `document_gen`) заменяются на
 * свежие. В БД ссылка не обновляется: снимок — это проекция, а подпись стоит
 * дёшево и не требует записи.
 *
 * @param row - строка таблицы `node_runs`
 * @param snapshot - снимок графа запуска (нужен `data.model` узла)
 * @param mediaStorage - хранилище media-результатов
 * @returns узел снимка состояния
 */
async function toNodeSnapshotAsync(
  row: NodeRun,
  snapshot: GraphSnapshotDto,
  mediaStorage: IMediaStorage,
): Promise<NodeRunSnapshot> {
  const model = snapshot.nodes.find((node) => node.id === row.nodeId)?.data.model;
  const stored = await resolveStoredUrlAsync(row, mediaStorage);

  return {
    nodeId: row.nodeId,
    nodeType: row.nodeType,
    status: row.status,
    inputs: row.inputs ?? {},
    // KI-464: `outputs.storedUrl`/`fileUrl` у `document_gen` — копия ссылки
    // из `node_runs.stored_url`. После переподписи её нужно заменить, иначе
    // кнопка «Скачать DOCX» после истечения presigned URL ведёт на 403.
    outputs: withRefreshedOutputs(
      row.outputs ?? null,
      row.storedUrl,
      stored.storedUrl,
    ),
    error: row.error,
    logs: row.logs ?? null,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    costUsd: row.costUsd,
    costRub: row.costRub ?? null,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    cacheSavingsUsd:
      typeof model === 'string'
        ? calculateCacheSavingsUsd(model, row.cacheReadTokens)
        : null,
    storedUrl: stored.storedUrl,
    storedExpiresAt: stored.storedExpiresAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Отдаёт актуальные ссылку и срок её жизни для media-узла (KI-443/KI-464).
 *
 * Срок ссылки определяется в таком порядке:
 * 1. `expires` внутри подписанной локальной ссылки (KI-415) — подпись живёт
 *    час, а файл дни, поэтому `stored_expires_at` в БД для local означает
 *    срок хранения, а не срок ссылки;
 * 2. `node_runs.stored_expires_at` — для S3-presigned и старых строк.
 *
 * Просроченную ссылку переподписывает хранилище: по `storage_key`, если он
 * есть (основной путь, KI-464), иначе по URL (fallback для строк до v0.10,
 * KI-451). Любая ошибка хранилища не должна ломать снимок: остаётся исходная
 * пара, UI покажет плейсхолдер.
 *
 * @param row - строка `node_runs`
 * @param mediaStorage - хранилище media-результатов
 * @returns ссылка и срок (исходные, если обновление не удалось/не нужно)
 */
async function resolveStoredUrlAsync(
  row: NodeRun,
  mediaStorage: IMediaStorage,
): Promise<{ storedUrl: string | null; storedExpiresAt: Date | null }> {
  if (row.storedUrl === null) {
    return { storedUrl: null, storedExpiresAt: row.storedExpiresAt };
  }

  const linkExpiresAt =
    parseSignedMediaUrlExpiry(row.storedUrl) ?? row.storedExpiresAt;

  // `null` — срок не задан (local без TTL, публичный бакет): ссылка не
  // истекает, переподписывать нечего. Это же поведение было до KI-464.
  if (linkExpiresAt === null || linkExpiresAt.getTime() > Date.now()) {
    return { storedUrl: row.storedUrl, storedExpiresAt: row.storedExpiresAt };
  }

  try {
    // KI-464: ключ объекта — приоритетный путь, формат URL не важен.
    const byKey =
      row.storageKey === null
        ? null
        : await mediaStorage.refreshStoredUrlByKeyAsync(row.storageKey);

    if (byKey !== null) {
      return byKey;
    }

    // Fallback для строк без `storage_key` (KI-451): ключ из path-style URL.
    const byUrl = await mediaStorage.refreshStoredUrlAsync(row.storedUrl);

    if (byUrl !== null) {
      return byUrl;
    }
  } catch (error: unknown) {
    // RULES 4.18: внешняя граница (S3) не должна ронять снимок.
    const message = error instanceof Error ? error.message : String(error);

    logger.warn(
      `Не удалось переподписать stored_url узла ${row.nodeId}: ${message}`,
    );
  }

  return { storedUrl: row.storedUrl, storedExpiresAt: row.storedExpiresAt };
}

/**
 * Подставляет свежую ссылку в `outputs.storedUrl`/`outputs.fileUrl` (KI-464).
 *
 * У `document_gen` ссылка продублирована в `node_runs.outputs`: UI берёт
 * кнопку скачивания оттуда, а снимок переподписывает только `stored_url`.
 * Без синхронизации после часа жизни presigned URL кнопка ведёт на 403.
 * Заменяются только поля, которые действительно равны сохранённой ссылке:
 * `mediaUrl` media-узлов — ссылка провайдера, её трогать нельзя.
 *
 * @param outputs - выходы узла из `node_runs`
 * @param storedUrl - сохранённая ссылка (`node_runs.stored_url`)
 * @param freshUrl - актуальная ссылка после переподписи
 * @returns выходы с обновлёнными копиями либо исходный объект
 */
function withRefreshedOutputs(
  outputs: Record<string, unknown> | null,
  storedUrl: string | null,
  freshUrl: string | null,
): Record<string, unknown> | null {
  if (
    outputs === null ||
    storedUrl === null ||
    freshUrl === null ||
    freshUrl === storedUrl
  ) {
    return outputs;
  }

  let changed = false;
  const next: Record<string, unknown> = { ...outputs };

  for (const key of ['storedUrl', 'fileUrl'] as const) {
    if (next[key] === storedUrl) {
      next[key] = freshUrl;
      changed = true;
    }
  }

  return changed ? next : outputs;
}
