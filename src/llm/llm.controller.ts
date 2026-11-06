import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { LlmHealthResponse } from './dto/llm-health.dto.js';
import { LlmHealthService } from './llm-health.service.js';
import { LlmRegistryService, type LlmModelInfo } from './llm-registry.service.js';
import { LlmRouterService } from './llm-router.service.js';

/**
 * HTTP-контроллер LLM-модуля (R4.1b; health — v1.2.0 S3, KI-618; auth —
 * v1.3.0 S2, KI-626).
 *
 * Отдаёт список моделей для UI-селекта и состояние локального GPU-бэкенда.
 * Роуты внутренние (для SPA), поэтому успешный ответ — «как есть» объект/массив,
 * без обёртки `{ success, data }`; формат ошибок остаётся глобальным (RULES 1.6).
 *
 * **Модель доступа (v1.3.0 S2, KI-626).** `GET /llm/health` защищён
 * `JwtAuthGuard`: состояние инфраструктуры (настроен ли GPU, участвует ли он в
 * маршрутизации) — не публичные данные, а ответ больше не должен тратить
 * анонимный rate-limit. `GET /llm/models` **сознательно оставлен публичным**:
 * SPA грузит список моделей на старте (`App.tsx`) ещё до того, как сессия
 * подтверждена, и без ответа ломается выбор модели по умолчанию у нового узла.
 * Секретов в ответе нет — только id/метки моделей сконфигурированных
 * провайдеров; риск раскрытия состава провайдеров принят и зафиксирован в
 * KI-626 (остаток — новый KI для моделей, см. отчёт S2).
 */
@Controller('llm')
export class LlmController {
  /**
   * @param registry - реестр провайдеров (источник списка моделей)
   * @param health - healthcheck LM Studio (источник статуса и времени проверки)
   * @param router - роутер «локальный → облачный» (источник флага маршрутизации)
   */
  constructor(
    private readonly registry: LlmRegistryService,
    private readonly health: LlmHealthService,
    private readonly router: LlmRouterService,
  ) {}

  /**
   * `GET /llm/models` — модели, доступные для выбора в UI.
   *
   * Возвращаются только модели сконфигурированных провайдеров (KI-039):
   * предлагать модели без API-ключа нельзя, вызов такой модели гарантированно
   * упадёт. Пустой массив означает, что ключей нет вовсе.
   *
   * Ручка остаётся **публичной** (KI-626): список моделей запрашивается на
   * старте SPA, до подтверждения сессии. Секретов в ответе нет.
   *
   * @returns массив `{ provider, id, label }` в порядке приоритета провайдеров
   */
  @Get('models')
  listModels(): LlmModelInfo[] {
    return this.registry.listModels();
  }

  /**
   * `GET /llm/health` — состояние локального GPU-бэкенда и роутера (KI-618).
   *
   * Состав ответа фиксирован: `{ local: { available, lastCheck },
   * routerEnabled }`. `available` строится из `getStatus()`: только
   * `available` даёт `true`, статусы `unknown`/`unavailable` — `false` (для
   * UI-индикатора «GPU: online/offline» это бинарный признак). `lastCheck` —
   * ISO-строка последней завершённой проверки, `''` пока проверок не было.
   * `routerEnabled` — текущее значение `LLM_ROUTER_ENABLED`: при выключенном
   * роутере статус GPU на маршрутизацию не влияет.
   *
   * Защищён `JwtAuthGuard` (v1.3.0 S2, KI-626): без access-токена — 401.
   * При `AUTH_DISABLED=true` (dev/CI) guard подставляет системного
   * пользователя, поведение ручки не меняется.
   *
   * @returns состояние локального провайдера и флаг роутера
   */
  @Get('health')
  @UseGuards(JwtAuthGuard)
  getHealth(): LlmHealthResponse {
    return {
      local: {
        available: this.health.getStatus() === 'available',
        lastCheck: this.health.getLastCheckAt(),
      },
      routerEnabled: this.router.isEnabled(),
    };
  }
}
