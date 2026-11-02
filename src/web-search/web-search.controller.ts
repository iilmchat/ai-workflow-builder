/**
 * HTTP-контроллер web-search-провайдеров (v0.15 S3, DESIGN v0.14 § 3.3).
 *
 * Узел `web_search` показывает селект провайдера только когда доступно больше
 * одного: список и провайдер по умолчанию отдаёт `GET /web-search/providers`.
 * Ключи наружу не отдаются — только имя и флаг «сконфигурирован» (RULES 5.1).
 *
 * Контроллер закрыт `JwtAuthGuard`, как `GET /mcp/servers`: список провайдеров —
 * операторская конфигурация, анонимным запросам она не нужна.
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { WebSearchProvidersResponse } from './web-search.interface.js';
import { WebSearchRegistryService } from './web-search.registry.js';

/** HTTP-ручка конфигурации web-search. */
@UseGuards(JwtAuthGuard)
@Controller('web-search')
export class WebSearchController {
  /**
   * @param registry - реестр провайдеров (имена и `isConfigured`)
   */
  constructor(private readonly registry: WebSearchRegistryService) {}

  /**
   * `GET /web-search/providers` — провайдеры поиска для UI узла.
   *
   * Успешный ответ — «как есть» объект, без обёртки `{ success, data }`:
   * роут внутренний для SPA (как `GET /llm/models`); формат ошибок остаётся
   * глобальным (RULES 1.6).
   *
   * @returns провайдер по умолчанию и список с флагом «ключ задан»
   */
  @Get('providers')
  listProviders(): WebSearchProvidersResponse {
    return {
      defaultProvider: this.registry.defaultName,
      providers: this.registry.list(),
    };
  }
}
