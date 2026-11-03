import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MetricsService } from './metrics.service.js';

/**
 * HTTP-контроллер экспозиции метрик Prometheus (v1.0.0 S4, DESIGN V100 § 3.3).
 *
 * `GET /metrics` — единственная ручка, которую читает скрейпер Prometheus.
 * **Без `JwtAuthGuard`**: у скрейпера нет и не должно быть пользовательского
 * токена; защита периметра — сетевая (ручка доступна только изнутри кластера /
 * scrape-сети), а данные метрик не содержат пользовательских секретов
 * (только агрегаты с ограниченными подписями).
 *
 * Заголовки выставляются из сервиса: `Content-Type` берётся из реестра
 * `prom-client` (`text/plain; version=0.0.4; charset=utf-8`), а
 * `Cache-Control: no-store` не даёт прокси/браузеру кэшировать экспозицию —
 * она меняется на каждом запросе. Тело — результат `registry.metrics()`,
 * поэтому формат остаётся на ответственности библиотеки, а не контроллера.
 */
@Controller('metrics')
export class MetricsController {
  /**
   * @param metricsService - сервис метрик (глобальный модуль)
   */
  constructor(private readonly metricsService: MetricsService) {}

  /**
   * `GET /metrics` — отдаёт экспозицию метрик в текстовом формате Prometheus.
   *
   * @param response - HTTP-ответ Express: через него выставляются заголовки
   *   (MIME-тип зависит от реестра сервиса и не может быть статическим)
   * @returns текст экспозиции (`# HELP`/`# TYPE` + серии метрик)
   */
  @Get()
  async getMetricsAsync(@Res({ passthrough: true }) response: Response): Promise<string> {
    response.setHeader('Content-Type', this.metricsService.contentType);
    // Экспозиция меняется на каждом запросе и не является публичным кэшем.
    response.setHeader('Cache-Control', 'no-store');

    return this.metricsService.getMetrics();
  }
}
