import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module.js';
import { ExecutionEngineService } from '../engine/execution-engine.service.js';
import { LlmModule } from '../llm/llm.module.js';
import { RunEventsService } from './run-events.service.js';
import { WORKFLOW_RUNS_QUEUE } from './runs.constants.js';
import { RunsController } from './runs.controller.js';
import { RunsProcessor } from './runs.processor.js';
import { RunsService } from './runs.service.js';

/**
 * Модуль запусков workflow (R1: очередь BullMQ, R2.2: executor графа).
 *
 * `BullModule.forRootAsync` объявлен в AppModule и является глобальным,
 * поэтому здесь достаточно `registerQueue` для конкретной очереди.
 * `DbModule` и `RedisModule` помечены `@Global()` — импортировать их не нужно.
 * `EngineModule` импортируется ради `EngineService`, который использует
 * `ExecutionEngineService` (R2.2).
 */
@Module({
  imports: [
    EngineModule,
    // ExecutionEngineService получает из него LlmNodeExecutor (R3).
    LlmModule,
    BullModule.registerQueue({
      name: WORKFLOW_RUNS_QUEUE,
      // KI-016: без attempts/backoff упавший job не ретраится, а без
      // removeOn* завершённые задания копятся в Redis бесконечно.
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 100, age: 24 * 3600 },
        removeOnFail: { count: 500, age: 7 * 24 * 3600 },
      },
    }),
  ],
  controllers: [RunsController],
  providers: [RunsService, RunsProcessor, RunEventsService, ExecutionEngineService],
  exports: [RunsService, RunEventsService],
})
export class RunsModule {}
