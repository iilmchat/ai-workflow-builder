import { Global, Module } from '@nestjs/common';
import { CostBudgetService } from './cost-budget.service.js';

/**
 * Глобальный модуль бюджета запуска (R7.1, KI-048).
 *
 * `@Global()` — по той же причине, что у `DbModule`/`RedisModule`:
 * предохранитель по стоимости нужен **исполнителям узлов** в разных модулях
 * (`LlmModule`, `MediaModule`) и HTTP-ручке в `RunsModule`. Обычный модуль
 * потребовал бы импортировать его в каждый из них, а `MediaModule`/`LlmModule`
 * импортировать `RunsModule` не могут — `RunsModule` импортирует их (цикл).
 *
 * Сервис зависит только от глобальных `DRIZZLE` (`DbModule`) и `ConfigService`,
 * поэтому экспорт одного провайдера не тянет за собой ничего лишнего.
 */
@Global()
@Module({
  providers: [CostBudgetService],
  exports: [CostBudgetService],
})
export class CostBudgetModule {}
