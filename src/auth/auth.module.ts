import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

/**
 * Модуль аутентификации (R6.1a, KI-106).
 *
 * Секрет подписи берётся из `JWT_SECRET` через ConfigService (RULES 4.6).
 * `JwtModule` экспортируется вместе с guard'ом: гварды других модулей
 * (`WorkflowModule`, `RunsModule`) инжектят `JwtService`/`ConfigService` и
 * должны получать их из этого модуля.
 *
 * Очистка истёкших refresh-токенов (KI-215) живёт в `RunsModule`: там уже
 * зарегистрированы BullMQ-очереди и прочитан `REDIS_URL`, поэтому `AuthModule`
 * не тащит Redis-зависимость в каждый модуль, который импортирует его ради
 * guard'а (например, `WebSearchModule`).
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
