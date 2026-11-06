import { Controller, Get } from '@nestjs/common';
import type { LlmHealthResponse } from './dto/llm-health.dto.js';
import { LlmHealthService } from './llm-health.service.js';
import { LlmRegistryService, type LlmModelInfo } from './llm-registry.service.js';
import { LlmRouterService } from './llm-router.service.js';

/**
 * HTTP-контроллер LLM-модуля (R4.1b; health — v1.2.0 S3, KI-618).
 *
 * Отдаёт список моделей для UI-селекта и состояние локального GPU-бэкенда.
 * Роуты внутренние (для SPA), поэтому успешный ответ — «как есть» объект/массив,
 * без обёртки `{ success, data }`; формат ошибок остаётся глобальным (RULES 1.6).
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
   * @returns состояние локального провайдера и флаг роутера
   */
  @Get('health')
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
