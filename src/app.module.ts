import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { validateEnv } from './config/env.schema.js';
import { DbModule } from './db/db.module.js';
import { LlmModule } from './llm/llm.module.js';
import { MediaModule } from './media/media.module.js';
import { WorkflowModule } from './workflow/workflow.module.js';
import { EngineModule } from './engine/engine.module.js';
import { NodesModule } from './nodes/nodes.module.js';
import { RedisModule } from './redis/redis.module.js';
// R7.1 (KI-048): бюджет запуска — @Global(), нужен исполнителям узлов
// (LlmModule/MediaModule) и HTTP-ручке в RunsModule.
import { CostBudgetModule } from './runs/cost-budget.module.js';
import { RunsModule } from './runs/runs.module.js';
import { TemplatesModule } from './templates/templates.module.js';

@Module({
  imports: [
    // ConfigModule обязателен первым: на него завязан BullModule.forRootAsync.
    // validateEnv() — fail-fast проверка .env через Zod (RULES 4.5).
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    // BullMQ — корневая конфигурация подключения к Redis через ConfigService,
    // без хардкода URL (RULES 4.9). Очереди регистрируют фича-модули.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('REDIS_URL') },
      }),
    }),
    DbModule,
    RedisModule,
    AuthModule,
    LlmModule,
    MediaModule,
    WorkflowModule,
    EngineModule,
    NodesModule,
    CostBudgetModule,
    RunsModule,
    // R6.6.1: шаблоны (GET /templates, POST /templates/:id/instantiate).
    // Импортирует WorkflowModule ради WorkflowService.importAsync.
    TemplatesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
