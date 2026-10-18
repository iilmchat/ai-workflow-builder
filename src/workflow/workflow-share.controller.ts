import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { SHARE_THROTTLE } from '../common/http-throttle.constants.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { SharedWorkflow } from './dto/share-workflow.dto.js';
import { WorkflowService } from './workflow.service.js';

/** Zod-схема share-токена (uuid v4). */
const ShareTokenParamSchema = z.object({
  token: z.uuid('token должен быть валидным UUID'),
});

/** Валидированный path-параметр `:token`. */
type ShareTokenParamDto = z.infer<typeof ShareTokenParamSchema>;

/**
 * Публичный контроллер share-ссылок (R6.2.1).
 *
 * Отдельный класс, а не метод `WorkflowController`, по двум причинам:
 * 1) `WorkflowController` целиком закрыт `JwtAuthGuard`, а эта ручка должна
 *    работать без токена;
 * 2) маршрут `workflow/share/:token` не должен пересекаться с
 *    `workflow/:id` — разные сегменты пути, но и разные контроллеры читаются
 *    однозначнее.
 *
 * Никакой аутентификации: доступ даёт сам токен (capability-модель).
 * Токен не логируется (RULES 5.9) — в логах приложения его нет.
 */
@Controller('workflow/share')
export class WorkflowShareController {
  constructor(private readonly workflowService: WorkflowService) {}

  /**
   * `GET /workflow/share/:token` — публичное read-only представление графа.
   *
   * @param params - path-параметр `token` (uuid)
   * @returns граф без владельца и служебных полей
   * @throws NotFoundException если токена нет (отозван или невалиден)
   */
  @Get(':token')
  // KI-234: публичная ручка без аутентификации — 5 запросов в минуту с одного
  // IP. Перебор uuid v4 нереален, но сканирование/DoS иначе не ограничены.
  @Throttle({ default: SHARE_THROTTLE })
  async getShared(
    @Param(ZodValidationPipe.create(ShareTokenParamSchema))
    params: ShareTokenParamDto,
  ): Promise<SharedWorkflow> {
    return this.workflowService.findSharedAsync(params.token);
  }
}
