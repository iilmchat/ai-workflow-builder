import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OrgMembersController } from './org-members.controller.js';
import { OrgMembersService } from './org-members.service.js';

/**
 * Модуль команды организации (v1.0.0 S5, KI-555/KI-563).
 *
 * Отдаёт HTTP-ручки `GET /admin/members` и `POST /admin/members/invite`.
 * `AuthModule` нужен ради `JwtAuthGuard`/`JwtModule` (проверка access-токена),
 * `AuditModule` — ради `OrgOwnerGuard` (роль `owner`/`admin` из БД); guard
 * переиспользуется, а не дублируется, чтобы политика доступа к
 * административным ручкам оставалась в одном месте.
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [OrgMembersController],
  providers: [OrgMembersService],
})
export class OrgMembersModule {}
