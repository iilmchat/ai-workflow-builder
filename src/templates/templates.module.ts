import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { TemplateLoaderService } from './template-loader.service.js';
import { TemplatesController } from './templates.controller.js';

// AuthModule нужен ради JwtAuthGuard на контроллере (R6.6.1).
// WorkflowModule импортируется ради WorkflowService.importAsync — шаблон
// инстанцируется тем же путём, что и импорт файла (см. TemplatesController).
// DbModule помечен @Global(), поэтому здесь его нет.
@Module({
  imports: [AuthModule, WorkflowModule],
  controllers: [TemplatesController],
  providers: [TemplateLoaderService],
})
export class TemplatesModule {}
