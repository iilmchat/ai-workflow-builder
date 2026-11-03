import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EmailModule } from '../email/email.module.js';
import { OrgMembersController } from './org-members.controller.js';
import { OrgMembersService } from './org-members.service.js';
import { OrgOwnerOnlyGuard } from './org-owner-only.guard.js';

/**
 * Модуль команды организации (v1.0.0 S5, KI-555/KI-563; управление составом —
 * v1.1.0 S2, KI-586).
 *
 * Отдаёт HTTP-ручки `GET /admin/members`, `POST /admin/members/invite`,
 * `PATCH /admin/members/:userId`, `DELETE /admin/members/:userId`.
 * `AuthModule` нужен ради `JwtAuthGuard`/`JwtModule` (проверка access-токена),
 * `AuditModule` — ради `OrgOwnerGuard` (роль `owner`/`admin` из БД) для инвайта;
 * `OrgOwnerOnlyGuard` (только `owner`) — provider этого модуля, он привязан к
 * управлению составом и не нужен аудиту. `EmailModule` (v1.1.0 S1) даёт
 * `EmailService` для письма-приглашения (fallback при ненастроенном SMTP).
 */
@Module({
  imports: [AuthModule, AuditModule, EmailModule],
  controllers: [OrgMembersController],
  providers: [OrgMembersService, OrgOwnerOnlyGuard],
})
export class OrgMembersModule {}
