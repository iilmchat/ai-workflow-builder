import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import { AgentService } from '../agent/agent.service.js';
// v0.10 S6: DocumentService для исполнителя узла document_gen.
import { DocumentsModule } from '../documents/documents.module.js';
// v0.10 S7: FilesystemService для исполнителей read_file/write_file (S8).
import { FilesystemModule } from '../filesystem/filesystem.module.js';
import { EngineModule } from '../engine/engine.module.js';
import { ExecutionEngineService } from '../engine/execution-engine.service.js';
import { LlmModule } from '../llm/llm.module.js';
import { MediaModule } from '../media/media.module.js';
// v0.11 S7: MCP-клиент и адаптер инструментов для AgentService.
import { McpModule } from '../mcp/mcp.module.js';
// R7.5 (KI-364): QuickJsRunnerService для режима `sandbox` узла condition.
import { SandboxModule } from '../sandbox/sandbox.module.js';
import { VectorStoreService } from '../vector/vector-store.service.js';
// v0.10 S2: ExecutionEngineService получает WEB_SEARCH_PROVIDER для узла
// web_search. Модуль экспортирует токен, поэтому конкретный провайдер (Tavily)
// остаётся заменяемым.
import { WebSearchModule } from '../web-search/web-search.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { RunEventsService } from './run-events.service.js';
// v0.11 S9 (DESIGN § 3.3.1, KI-066): heartbeat аренды запуска.
import { RunLeaseService } from './run-lease.service.js';
// v0.11 S12 (DESIGN § 3.4.2): единый маппер node_runs для SSE и REST.
import { NodeRunSnapshotMapper } from './node-run-snapshot.mapper.js';
import { WORKFLOW_RUNS_QUEUE } from './runs.constants.js';
import { RunsController } from './runs.controller.js';
import { RunsProcessor } from './runs.processor.js';
import { RunsService } from './runs.service.js';
import { RunsStreamService } from './runs-stream.service.js';
import { RUNS_QUEUE_DB, RUNS_QUEUE_PREFIX } from './runs.worker-options.js';

/**
 * Модуль запусков workflow (R1: очередь BullMQ, R2.2: executor графа).
 *
 * `BullModule.forRootAsync` объявлен в AppModule и является глобальным,
 * поэтому здесь достаточно зарегистрировать конкретную очередь.
 * `DbModule` и `RedisModule` помечены `@Global()` — импортировать их не нужно.
 * `EngineModule` импортируется ради `EngineService`, который использует
 * `ExecutionEngineService` (R2.2).
 *
 * **Изоляция инстансов (KI-387).** Очередь регистрируется асинхронно, чтобы
 * взять `BULLMQ_PREFIX` и `REDIS_QUEUE_DB` из `ConfigService` (RULES 4.6): два
 * backend-а на одном Redis больше не делят задания. `connection.db` и `prefix`
 * попадают в опции очереди, а воркер `@Processor` наследует их из этих же
 * опций (`@nestjs/bullmq` создаёт `Worker` с `connection`/`prefix` очереди),
 * поэтому продюсер и консьюмер всегда смотрят в одно пространство ключей.
 */
@Module({
  imports: [
    EngineModule,
    // JwtAuthGuard на RunsController (R6.1a).
    AuthModule,
    // ExecutionEngineService получает из него LlmNodeExecutor (R3).
    LlmModule,
    // ...а из него MediaNodeExecutor для узлов image_generation (v0.6.0b.2.2).
    MediaModule,
    // R7.5 (KI-364): ExecutionEngineService получает QuickJsRunnerService
    // для режима `sandbox` узла condition.
    SandboxModule,
    // v0.10 S2: WEB_SEARCH_PROVIDER для исполнителя узла web_search.
    WebSearchModule,
    // v0.10 S6: DocumentService для исполнителя узла document_gen.
    DocumentsModule,
    // v0.10 S7: FilesystemService для узлов read_file/write_file (S8).
    FilesystemModule,
    // v0.11 S7: MCP-клиент и McpToolAdapter для AgentService.
    McpModule,
    // R6.7 (KI-200): ExecutionEngineService загружает подграфы узлов
    // sub_workflow через WorkflowService (проверка владельца — 404).
    WorkflowModule,
    BullModule.registerQueueAsync({
      name: WORKFLOW_RUNS_QUEUE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // KI-387: префикс и БД Redis разводят очереди параллельных инстансов.
        prefix: config.get<string>('BULLMQ_PREFIX') ?? RUNS_QUEUE_PREFIX,
        connection: {
          url: config.getOrThrow<string>('REDIS_URL'),
          db: config.get<number>('REDIS_QUEUE_DB') ?? RUNS_QUEUE_DB,
        },
        // KI-016: без attempts/backoff упавший job не ретраится, а без
        // removeOn* завершённые задания копятся в Redis бесконечно.
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 100, age: 24 * 3600 },
          removeOnFail: { count: 500, age: 7 * 24 * 3600 },
        },
      }),
    }),
  ],
  controllers: [RunsController],
  providers: [
    RunsService,
    RunsStreamService,
    // v0.11 S12 (DESIGN § 3.4.2): один маппер `node_runs` для SSE-снимка и
    // `GET /runs/:id/nodes` — проекция не может разойтись между транспортами.
    NodeRunSnapshotMapper,
    RunsProcessor,
    RunEventsService,
    // v0.11 S9 (KI-066): продление lease запуска. ExecutionEngineService
    // (ниже, в этом же модуле) запускает heartbeat, RunsProcessor — читает
    // lease_expires_at для guard'а KI-023.
    RunLeaseService,
    ExecutionEngineService,
    // R7.4a (KI-128): SQL к pgvector для узлов vector_*/memory_*.
    VectorStoreService,
    // R7.4b (DESIGN v0.9 § 3.4): цикл agent-узла. Отдельного Nest-модуля нет
    // осознанно: все зависимости (LlmService, LlmRegistryService, песочница,
    // VectorStoreService) уже в этом графе, а модуль потребовал бы вынести
    // VectorStoreService в экспортируемый модуль — правка R7.4a вне среза.
    AgentService,
  ],
  exports: [RunsService, RunEventsService],
})
export class RunsModule {}
