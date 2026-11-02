/**
 * Модуль web-search-провайдеров (v0.10 S1, расширен в v0.15 S3).
 *
 * Регистрирует все реализации ({@link TavilyProvider}, {@link BingProvider},
 * {@link BraveProvider}) и {@link WebSearchRegistryService}. Провайдер по
 * умолчанию выбирается env `WEB_SEARCH_PROVIDER` и публикуется под токеном
 * {@link WEB_SEARCH_PROVIDER}; исполнитель узла `web_search` инжектит реестр и
 * умеет выбрать провайдера из `data.provider` (DESIGN v0.14 § 3.3).
 *
 * `AuthModule` импортируется ради `JwtAuthGuard` ручки
 * `GET /web-search/providers` (как `McpModule`).
 *
 * Провайдеры экспортируются и как классы: тестам и диагностике бывает нужен
 * прямой доступ, а `useFactory` выше отдаёт интерфейс.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BingProvider } from './providers/bing.provider.js';
import { BraveProvider } from './providers/brave.provider.js';
import { TavilyProvider } from './providers/tavily.provider.js';
import { WebSearchController } from './web-search.controller.js';
import type { IWebSearchProvider } from './web-search.interface.js';
import { WebSearchRegistryService } from './web-search.registry.js';

/**
 * DI-токен web-search-провайдера по умолчанию.
 *
 * Символ (а не строка): исключает случайную коллизию с другим провайдером и
 * не создаёт «строковый контракт» между модулями. Оставлен для обратной
 * совместимости (v0.10): исполнитель теперь берёт провайдера из реестра, но
 * токен по-прежнему отдаёт выбранного env-провайдера.
 */
export const WEB_SEARCH_PROVIDER = Symbol('WEB_SEARCH_PROVIDER');

@Module({
  imports: [AuthModule],
  controllers: [WebSearchController],
  providers: [
    TavilyProvider,
    BingProvider,
    BraveProvider,
    WebSearchRegistryService,
    {
      provide: WEB_SEARCH_PROVIDER,
      inject: [WebSearchRegistryService],
      useFactory: (registry: WebSearchRegistryService): IWebSearchProvider =>
        registry.getProvider(),
    },
  ],
  exports: [
    WEB_SEARCH_PROVIDER,
    WebSearchRegistryService,
    TavilyProvider,
    BingProvider,
    BraveProvider,
  ],
})
export class WebSearchModule {}
