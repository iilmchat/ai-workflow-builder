import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowService } from './workflow.service.js';

// DbModule помечен @Global(), поэтому импортировать его здесь не нужно.
// AuthModule нужен ради JwtAuthGuard на контроллере (R6.1a).
@Module({
  imports: [AuthModule],
  controllers: [WorkflowController],
  providers: [WorkflowService],
})
export class WorkflowModule {}
