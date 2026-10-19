import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { nodeRuns, type NodeRun } from '../db/schema.js';
import type { GraphSnapshotDto } from '../engine/dto/index.js';
import { calculateCacheSavingsUsd } from '../llm/model-pricing.js';
import {
  MEDIA_STORAGE,
  type IMediaStorage,
} from '../media/media-storage.service.js';
import { parseSignedMediaUrlExpiry } from '../media/media-url-signer.js';
import type { NodeRunSnapshot } from './dto/index.js';

/**
 * Экономия на чтении из кэша, USD (R7.7, KI-055).
 *
 * В БД не хранится — пересчитывается по модели узла из снимка графа и
 * `cacheReadTokens`, потому что тарифы живут только в `model-pricing.ts`.
 */
type CacheSavingsUsd = number | null;

/**
 * Единый маппер строк `node_runs` в публичный снимок узла (DESIGN v0.11 § 2.6,
 * § 3.4.2).
 *
 * До S12 проекция жила в модуле `run-node-snapshots.ts`: SSE-снимок умел
 * отдавать узлы, `GET /runs/:id` — тоже (v0.10.2, KI-450), но истории после F5
 * без SSE не было. Извлечение в `@Injectable`-класс даёт **один** контракт у
 * двух транспортов: `RunsStreamService` (SSE-снимок) и `RunsService`
 * (`GET /runs/:id/nodes`). Логика перенесена 1:1:
 * - переподпись просроченного `stored_url` (KI-443) и его копий в `outputs`
 *   (KI-464);
 * - пересчёт `cacheSavingsUsd` по модели узла;
 * - ISO-даты (`startedAt`/`finishedAt`/`storedExpiresAt`).
 */
@Injectable()
export class NodeRunSnapshotMapper {
  /** Логгер: ошибки переподписи ссылок не должны теряться молча. */
  private readonly logger = new Logger(NodeRunSnapshotMapper.name);

  /**
   * @param db - соединение Drizzle: `listAsync` читает `node_runs`
   * @param mediaStorage - хранилище media-результатов: переподписывает
   *   просроченные ссылки при чтении (KI-443)
   */
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(MEDIA_STORAGE) private readonly mediaStorage: IMediaStorage,
  ) {}

  /**
   * Приводит строку `node_runs` к узлу снимка.
   *
   * Даты — ISO-строки, `cost_usd`/`cost_rub` — строки, как их отдаёт колонка
   * `numeric`. `cacheSavingsUsd` пересчитывается здесь: без модели узла
   * (узел удалён из графа либо тип без модели) экономия — `null`, токены при
   * этом всё равно отдаются.
   *
   * @param row - строка таблицы `node_runs`
   * @param graph - снимок графа запуска (нужен `data.model` узла)
   * @returns узел снимка состояния
   */
  async toSnapshotAsync(
    row: NodeRun,
    graph: GraphSnapshotDto,
  ): Promise<NodeRunSnapshot> {
    const model = graph.nodes.find((node) => node.id === row.nodeId)?.data.model;
    const stored = await this.resolveStoredUrlAsync(row);

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
      cacheSavingsUsd: this.calculateCacheSavings(model, row.cacheReadTokens),
      storedUrl: stored.storedUrl,
      storedExpiresAt: stored.storedExpiresAt?.toISOString() ?? null,
      durationMs: row.durationMs,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }

  /**
   * Возвращает снимки всех узлов запуска — порядок детерминирован по `nodeId`.
   *
   * Порядок по `nodeId`, а не по nullable `started_at`: UI сортирует узлы сам,
   * а строки с `started_at = null` (упавшие до старта) не должны теряться.
   * Переподпись ссылок выполняется параллельно (`Promise.all`): независимые
   * подписи не должны идти в цикле (RULES 4.17).
   *
   * @param runId - uuid запуска
   * @param graph - снимок графа запуска (нужен `data.model` узла)
   * @returns узлы в форме `NodeRunSnapshot` (без запуска)
   */
  async listAsync(
    runId: string,
    graph: GraphSnapshotDto,
  ): Promise<NodeRunSnapshot[]> {
    const rows = await this.db
      .select()
      .from(nodeRuns)
      .where(eq(nodeRuns.runId, runId))
      .orderBy(nodeRuns.nodeId);

    return Promise.all(rows.map((row) => this.toSnapshotAsync(row, graph)));
  }

  /**
   * Считает экономию на кэше по модели узла (R7.7, KI-055).
   *
   * @param model - модель из `data.model` узла снимка графа (может отсутствовать)
   * @param cacheReadTokens - прочитанные из кэша токены
   * @returns экономия в USD либо `null`, если посчитать нельзя
   */
  private calculateCacheSavings(
    model: unknown,
    cacheReadTokens: number | null,
  ): CacheSavingsUsd {
    return typeof model === 'string'
      ? calculateCacheSavingsUsd(model, cacheReadTokens)
      : null;
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
   * @returns ссылка и срок (исходные, если обновление не удалось/не нужно)
   */
  private async resolveStoredUrlAsync(
    row: NodeRun,
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
          : await this.mediaStorage.refreshStoredUrlByKeyAsync(row.storageKey);

      if (byKey !== null) {
        return byKey;
      }

      // Fallback для строк без `storage_key` (KI-451): ключ из path-style URL.
      const byUrl = await this.mediaStorage.refreshStoredUrlAsync(row.storedUrl);

      if (byUrl !== null) {
        return byUrl;
      }
    } catch (error: unknown) {
      // RULES 4.18: внешняя граница (S3) не должна ронять снимок.
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `Не удалось переподписать stored_url узла ${row.nodeId}: ${message}`,
      );
    }

    return { storedUrl: row.storedUrl, storedExpiresAt: row.storedExpiresAt };
  }
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
