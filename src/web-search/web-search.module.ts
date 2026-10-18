/**
 * Модуль web-search-провайдера (v0.10 S1).
 *
 * Провайдер выбирается env `WEB_SEARCH_PROVIDER` (в v0.10 — только `tavily`) и
 * публикуется под токеном {@link WEB_SEARCH_PROVIDER}. Исполнитель узла
 * `web_search` (S2) инжектит токен и не зависит от класса Tavily — как
 * `MEDIA_PROVIDERS`/`LLM_PROVIDERS` в соседних модулях.
 *
 * `TavilyProvider` экспортируется и как класс: тестам и диагностике бывает
 * нужен прямой доступ, а `useFactory` выше отдаёт интерфейс.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TavilyProvider } from './tavily.provider.js';
import type { IWebSearchProvider } from './web-search.interface.js';

/**
 * DI-токен выбранного web-search-провайдера.
 *
 * Символ (а не строка): исключает случайную коллизию с другим провайдером и
 * не создаёт «строковый контракт» между модулями.
 */
export const WEB_SEARCH_PROVIDER = Symbol('WEB_SEARCH_PROVIDER');

@Module({
  providers: [
    TavilyProvider,
    {
      provide: WEB_SEARCH_PROVIDER,
      inject: [ConfigService, TavilyProvider],
      useFactory: (
        config: ConfigService,
        tavily: TavilyProvider,
      ): IWebSearchProvider => {
        // Env-схема гарантирует enum; дефолт повторён для юнит-тестов, где
        // ConfigService — заглушка без `WEB_SEARCH_PROVIDER`.
        const selected =
          config.get<'tavily'>('WEB_SEARCH_PROVIDER') ?? 'tavily';

        switch (selected) {
          case 'tavily':
            return tavily;
          default: {
            // Исчерпывающая проверка: новый провайдер в env без ветки здесь
            // не скомпилируется, а не молча уедет в Tavily.
            const unknownProvider: never = selected;

            throw new Error(
              `Неизвестный WEB_SEARCH_PROVIDER: ${String(unknownProvider)}`,
            );
          }
        }
      },
    },
  ],
  exports: [WEB_SEARCH_PROVIDER, TavilyProvider],
})
export class WebSearchModule {}
