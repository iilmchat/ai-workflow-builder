import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller.js';
import { MetricsInterceptor } from './metrics.interceptor.js';
import { MetricsService } from './metrics.service.js';

/**
 * Модуль метрик Prometheus (v1.0.0 S4, DESIGN V100 § 3.3).
 *
 * `@Global()` — чтобы `EngineModule` и `AgentModule` инжектили
 * {@link MetricsService} в исполнителей узлов без правок их `imports`
 * (метрики — инфраструктура уровня приложения, как `DbModule`/`CostBudgetModule`).
 *
 * `MetricsInterceptor` — провайдер **и** экспорт модуля: Nest не разрешает
 * экспортировать токен, которого нет в `providers` (`UnknownExportException`),
 * а экспорт нужен, чтобы интерсептор можно было переиспользовать в других
 * модулях. Глобальная регистрация (`APP_INTERCEPTOR`) остаётся в
 * `app.module.ts` — модуль сам интерсептор не регистрирует, чтобы не
 * зависеть от порядка инициализации приложения.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsInterceptor],
  exports: [MetricsService, MetricsInterceptor],
})
export class MetricsModule {}
