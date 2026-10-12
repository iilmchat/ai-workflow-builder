import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { WorkflowModule } from './workflow/workflow.module.js';
import { EngineModule } from './engine/engine.module.js';
import { NodesModule } from './nodes/nodes.module.js';

@Module({
  imports: [WorkflowModule, EngineModule, NodesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
