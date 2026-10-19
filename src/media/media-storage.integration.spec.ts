import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { SafeHttpClient } from '../common/http/safe-http.client.js';
import * as schema from '../db/schema.js';
import { nodeRuns, workflowRuns, workflows } from '../db/schema.js';
import { AgentService } from '../agent/agent.service.js';
import { ExecutionEngineService } from '../engine/execution-engine.service.js';
import { EngineService } from '../engine/engine.service.js';
import type { GraphDto, NodeDto } from '../engine/dto/index.js';
import { LlmNodeExecutor } from '../llm/llm-node-executor.service.js';
import { LlmRegistryService } from '../llm/llm-registry.service.js';
import { MediaNodeExecutor } from './media-node-executor.service.js';
import { MEDIA_PROVIDERS, MediaRegistryService } from './media-registry.service.js';
import { LocalMediaStorage, MEDIA_STORAGE } from './media-storage.service.js';
import { CostBudgetService } from '../runs/cost-budget.service.js';
import { RunEventsService } from '../runs/run-events.service.js';
// v0.11 S9 (KI-066): heartbeat аренды запуска (в интеграции — заглушка).
import { RunLeaseService } from '../runs/run-lease.service.js';
import { QuickJsRunnerService } from '../sandbox/quickjs-runner.service.js';
import { VectorStoreService } from '../vector/vector-store.service.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import { WEB_SEARCH_PROVIDER } from '../web-search/web-search.module.js';
import type { IMediaProvider } from './media-provider.interface.js';
import { DocumentService } from '../documents/document.service.js';
// v0.11 S4: зависимости template-режима document_gen (в графе не используются).
import { DocumentTemplateService } from '../documents/document-template.service.js';
import { DocumentTemplatesService } from '../documents/document-templates.service.js';
import { FilesystemService } from '../filesystem/filesystem.service.js';

/**
 * Интеграция R7.8 (KI-362): media-генерация → скачивание → локальное
 * хранилище → запись `stored_url` в БД.
 *
 * Запускается только при заданном `DATABASE_URL` (как
 * `vector-store.integration.spec.ts`): без живой БД проверять нечего. В CI шаг
 * `Apply migrations` уже применён, поэтому колонки R7.8 существуют.
 *
 * Внешние границы подменены: провайдер media (реестр) отвечает «задача
 * готова», а HTTP-сервер на `127.0.0.1` отдаёт байты «картинки». Всё
 * остальное — настоящее: `MediaNodeExecutor`, `LocalMediaStorage` (пишет на
 * диск), `ExecutionEngineService` (пишет `node_runs`), PostgreSQL.
 */

/** Байты «PNG»: содержимое не важно, проверяется факт скачивания. */
const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

/** Узел media-генерации. */
const MEDIA_NODE: NodeDto = {
  id: 'img-1',
  type: 'image_generation',
  data: { model: 'flux-schnell', prompt: 'кот в космосе' },
};

/** Граф из одного media-узла. */
const GRAPH: GraphDto = { nodes: [MEDIA_NODE], edges: [] };

describe.skipIf(!process.env.DATABASE_URL)(
  'Media storage + БД: генерация → скачивание → stored_url (R7.8)',
  () => {
    let pool: Pool | undefined;
    let db: NodePgDatabase<typeof schema> | undefined;
    let database: Database | undefined;
    let server: Server | undefined;
    let sourceUrl = '';
    let mediaDir = '';
    let workflowId = '';
    let runId = '';

    beforeAll(async () => {
      const url = process.env.DATABASE_URL;

      if (!url) {
        throw new Error('DATABASE_URL не задан — интеграционный тест пропущен');
      }

      pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5_000 });
      db = drizzle(pool, { schema });
      // `Database` = клиент + `$client`; drizzle() в типах `$client` не выводит.
      database = db as unknown as Database;
      mediaDir = await mkdtemp(join(tmpdir(), 'wb-media-integration-'));

      // HTTP-сервер вместо CreativeLab: отдаёт байты по /image.png.
      server = createServer((request, response) => {
        if (request.url === '/image.png') {
          response.writeHead(200, {
            'content-type': 'image/png',
            'content-length': String(PNG_BYTES.byteLength),
          });
          response.end(PNG_BYTES);

          return;
        }

        response.writeHead(404).end();
      });

      await new Promise<void>((resolve) => {
        server?.listen(0, '127.0.0.1', resolve);
      });

      const address = server.address() as AddressInfo;

      sourceUrl = `http://127.0.0.1:${address.port}/image.png`;

      workflowId = randomUUID();
      runId = randomUUID();

      await db.insert(workflows).values({
        id: workflowId,
        userId: randomUUID(),
        name: `R7.8 media storage ${Date.now()}`,
        nodes: [MEDIA_NODE],
        edges: [],
      });

      await db.insert(workflowRuns).values({
        id: runId,
        workflowId,
        status: 'running',
        inputs: {},
        snapshot: GRAPH,
      });
    }, 30_000);

    afterAll(async () => {
      if (db !== undefined) {
        // CASCADE снимает node_runs.
        await db.delete(workflows).where(eq(workflows.id, workflowId));
      }

      if (server !== undefined) {
        await new Promise<void>((resolve) => {
          server?.close(() => resolve());
        });
      }

      if (pool !== undefined) {
        await pool.end();
      }

      if (mediaDir.length > 0) {
        await rm(mediaDir, { recursive: true, force: true });
      }
    });

    it('скачивает результат, сохраняет локально и пишет stored_url/stored_expires_at', async () => {
      const dbClient = db;
      const dbHandle = database;

      if (!dbClient || !dbHandle) {
        throw new Error('БД не инициализирована');
      }

      const registry = {
        createTaskAsync: vi.fn(() =>
          Promise.resolve({
            taskId: 'task-integration-1',
            model: 'flux-schnell',
            status: 'done' as const,
            resultUrls: [sourceUrl],
            costRub: 0,
            error: null,
          }),
        ),
        findModelAsync: vi.fn(() => Promise.resolve(null)),
        // Параметров у модели нет — executor отправляет запрос как есть.
        findParamsAsync: vi.fn(() => Promise.resolve(null)),
        listModelsAsync: vi.fn(() => Promise.resolve([])),
        getTaskAsync: vi.fn(),
      };

      const moduleRef = await Test.createTestingModule({
        providers: [
          ExecutionEngineService,
          {
            provide: DocumentService,
            useValue: { 
              generateDocxFromMarkdownAsync: vi.fn(), 
              generateDocxFromJsonAsync: vi.fn() 
            },
          },          
          EngineService,
          MediaNodeExecutor,
          { provide: DRIZZLE, useValue: dbHandle },
          // v0.11 S14: HTTP-клиент узла `http` в этом графе не используется.
          {
            provide: SafeHttpClient,
            useValue: { fetchAsync: vi.fn() },
          },
          // v0.11 S9 (KI-066): движок запускает heartbeat аренды. В интеграции
          // проверяется media-пайплайн, поэтому достаточно заглушки.
          {
            provide: RunLeaseService,
            useValue: {
              leaseTtlMs: 90_000,
              startAsync: vi.fn(() => Promise.resolve()),
              stop: vi.fn(),
            },
          },
          { provide: MediaRegistryService, useValue: registry },
          // Провайдеры инструментов не нужны: узел — генерация.
          { provide: MEDIA_PROVIDERS, useValue: [] as IMediaProvider[] },
          {
            provide: CostBudgetService,
            useValue: {
              assertWithinBudgetAsync: vi.fn(() => Promise.resolve()),
              getBudgetAsync: vi.fn(),
            },
          },
          // Настоящее локальное хранилище: проверяем запись на диск.
          {
            provide: MEDIA_STORAGE,
            useValue: new LocalMediaStorage(mediaDir, 30),
          },
          {
            provide: RunEventsService,
            useValue: { publishAsync: vi.fn(() => Promise.resolve()) },
          },
          { provide: LlmNodeExecutor, useValue: { executeAsync: vi.fn() } },
          {
            provide: QuickJsRunnerService,
            useValue: { evaluateSandboxedAsync: vi.fn() },
          },
          { provide: WorkflowService, useValue: { getOwnedAsync: vi.fn() } },
          { provide: LlmRegistryService, useValue: { resolveByModel: vi.fn() } },
          {
            provide: VectorStoreService,
            useValue: {
              findWorkflowIdByRunAsync: vi.fn(() => Promise.resolve(workflowId)),
              insertVectorAsync: vi.fn(),
              queryVectorsAsync: vi.fn(),
              readMemoryAsync: vi.fn(),
              writeMemoryAsync: vi.fn(),
            },
          },
          {
            provide: AgentService,
            useValue: { runAgentAsync: vi.fn() },
          },
          // v0.10 S2: web_search в этом графе не выполняется, но
          // зависимость должна резолвиться при сборке TestingModule.
          {
            provide: WEB_SEARCH_PROVIDER,
            useValue: {
              name: 'fake',
              isConfigured: false,
              searchAsync: vi.fn(),
            },
          },
          {
            provide: FilesystemService,
            useValue: {
              readFileAsync: vi.fn(),
              writeFileAsync: vi.fn(),
            },
          },
          // v0.11 S4: зависимости template-режима document_gen. В этом графе
          // шаблоны не используются; заглушки нужны для сборки DI-графа.
          {
            provide: DocumentTemplateService,
            useValue: { renderAsync: vi.fn() },
          },
          {
            provide: DocumentTemplatesService,
            useValue: { loadAsync: vi.fn() },
          },
          // v0.10 S0 (KI-455): движок читает PGVECTOR_ENABLED через ConfigService.
          {
            provide: ConfigService,
            useValue: { get: (): unknown => undefined },
          },
        ],
      }).compile();

      const engine = moduleRef.get(ExecutionEngineService);
      const result = await engine.executeAsync(runId, GRAPH);

      expect(result.status).toBe('completed');
      expect(result.executedNodes).toBe(1);

      // 1) Файл реально скачан и лежит в локальном хранилище.
      const file = await readFile(join(mediaDir, runId, 'img-1.png'));
      expect([...file]).toEqual([...PNG_BYTES]);

      // 2) Строка node_runs содержит свою ссылку и TTL.
      const [row] = await dbClient
        .select()
        .from(nodeRuns)
        .where(and(eq(nodeRuns.runId, runId), eq(nodeRuns.nodeId, 'img-1')));

      expect(row?.status).toBe('completed');
      expect(row?.storedUrl).toBe(`/media/file/${runId}/img-1.png`);
      expect(row?.storedExpiresAt).toBeInstanceOf(Date);
      expect(row?.storedExpiresAt?.getTime()).toBeGreaterThan(Date.now());
      // Выходы узла не переписаны: `mediaUrl` остаётся ссылкой провайдера.
      expect(row?.outputs).toMatchObject({
        mediaUrl: sourceUrl,
        mediaType: 'IMAGE',
        taskId: 'task-integration-1',
      });
    });
  },
);
