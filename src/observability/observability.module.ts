import { Global, Module } from '@nestjs/common';
import { OtelService } from './otel.service.js';

/**
 * Модуль наблюдаемости (R7.7, KI-365).
 *
 * `@Global()` — потому что трассировка нужна в разных модулях (движок, LLM,
 * media), а тащить импорт в каждый из них ради одного сервиса бессмысленно.
 * Единственный провайдер — {@link OtelService}: он стартует SDK при
 * `OTEL_ENABLED=true` и больше ничего не экспортирует наружу. Бизнес-код
 * работает с адаптером из `tracing.ts`, а не с этим сервисом.
 */
@Global()
@Module({
  providers: [OtelService],
  exports: [OtelService],
})
export class ObservabilityModule {}
