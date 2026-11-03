import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminAuditController } from './admin-audit.controller.js';
import { AuditService } from './audit.service.js';
import { OrgOwnerGuard } from './org-owner.guard.js';

/**
 * Модуль журнала аудита (v1.0.0 S3, DESIGN V100 § 3.2).
 *
 * Собирает подсистему аудита в одном месте:
 * - `AdminAuditController` — `GET /admin/audit` (журнал организации);
 * - `AuditService` — запись/чтение `audit_logs`, **экспортируется**: глобальный
 *   `AuditInterceptor` регистрируется в `AppModule` и инжектит сервис из этого
 *   модуля;
 * - `OrgOwnerGuard` — ролевая проверка административной ручки (`owner`/`admin`);
 *   **экспортируется** с v1.0.0 S5: те же правила доступа нужны команде
 *   организации (`POST /admin/members/invite`), и дублировать guard незачем;
 * - `imports: [AuthModule]` — контроллер использует `JwtAuthGuard` и
 *   `JwtService`, которые экспортирует `AuthModule`.
 *
 * Сам интерсептор провайдером модуля **не** является: он глобальный
 * (`APP_INTERCEPTOR` в `app.module.ts`), и Nest инстанцирует его в контексте
 * `AppModule`, куда `AuditService` приходит через `exports`.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminAuditController],
  providers: [AuditService, OrgOwnerGuard],
  exports: [AuditService, OrgOwnerGuard],
})
export class AuditModule {}
