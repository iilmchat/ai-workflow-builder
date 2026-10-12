import { Module } from '@nestjs/common';
import { EngineService } from './engine.service.js';
import { EngineController } from './engine.controller.js';

@Module({
  providers: [EngineService],
  controllers: [EngineController]
})
export class EngineModule {}
