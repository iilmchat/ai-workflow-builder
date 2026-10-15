import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowService } from './workflow.service.js';
import { WorkflowShareController } from './workflow-share.controller.js';

// DbModule помечен @Global(), поэтому импортировать его здесь не нужно.
// AuthModule нужен ради JwtAuthGuard на контроллере (R6.1a).
// WorkflowShareController — публичный (share-ссылка), ему auth не нужен.
// WorkflowService экспортируется для TemplatesModule (R6.6.1): инстанцирование
// шаблона — это тот же импорт артефакта, второй путь записи не нужен.
@Module({
  imports: [AuthModule],
  controllers: [WorkflowController, WorkflowShareController],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
