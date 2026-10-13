import { Module } from '@nestjs/common';
import { EngineService } from './engine.service.js';
import { EngineController } from './engine.controller.js';

@Module({
  providers: [EngineService],
  controllers: [EngineController],
  // EngineService нужен ExecutionEngineService (провайдится в RunsModule) — R2.2.
  exports: [EngineService],
})
export class EngineModule {}
