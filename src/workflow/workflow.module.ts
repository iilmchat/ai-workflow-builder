import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowService } from './workflow.service.js';

// DbModule помечен @Global(), поэтому импортировать его здесь не нужно.
@Module({
  imports: [],
  controllers: [WorkflowController],
  providers: [WorkflowService],
})
export class WorkflowModule {}
