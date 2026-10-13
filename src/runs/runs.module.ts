import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { WORKFLOW_RUNS_QUEUE } from './runs.constants.js';
import { RunsController } from './runs.controller.js';
import { RunsProcessor } from './runs.processor.js';
import { RunsService } from './runs.service.js';

/**
 * Модуль запусков workflow (R1: инфраструктура очереди BullMQ).
 *
 * `BullModule.forRootAsync` объявлен в AppModule и является глобальным,
 * поэтому здесь достаточно `registerQueue` для конкретной очереди.
 * `DbModule` помечен `@Global()` — импортировать его не нужно.
 */
@Module({
  imports: [BullModule.registerQueue({ name: WORKFLOW_RUNS_QUEUE })],
  controllers: [RunsController],
  providers: [RunsService, RunsProcessor],
  exports: [RunsService],
})
export class RunsModule {}
