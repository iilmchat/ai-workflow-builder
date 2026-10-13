import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { validateEnv } from './config/env.schema.js';
import { DbModule } from './db/db.module.js';
import { WorkflowModule } from './workflow/workflow.module.js';
import { EngineModule } from './engine/engine.module.js';
import { NodesModule } from './nodes/nodes.module.js';
import { RunsModule } from './runs/runs.module.js';

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
    WorkflowModule,
    EngineModule,
    NodesModule,
    RunsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
