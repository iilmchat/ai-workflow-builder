import { Module } from '@nestjs/common';
import { WorkflowService } from './workflow.service.js';
import { WorkflowController } from './workflow.controller.js';

@Module({
  providers: [WorkflowService],
  controllers: [WorkflowController]
})
export class WorkflowModule {}
