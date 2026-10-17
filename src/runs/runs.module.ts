import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import { EngineModule } from '../engine/engine.module.js';
import { ExecutionEngineService } from '../engine/execution-engine.service.js';
import { LlmModule } from '../llm/llm.module.js';
import { MediaModule } from '../media/media.module.js';
// R7.5 (KI-364): QuickJsRunnerService для режима `sandbox` узла condition.
import { SandboxModule } from '../sandbox/sandbox.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { RunEventsService } from './run-events.service.js';
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
    RunsProcessor,
    RunEventsService,
    ExecutionEngineService,
  ],
  exports: [RunsService, RunEventsService],
})
export class RunsModule {}
