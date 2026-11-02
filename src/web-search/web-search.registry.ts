/**
 * Реестр web-search-провайдеров (v0.15 S3, DESIGN v0.14 § 3.3).
 *
 * В v0.10 модуль отдавал исполнителю один провайдер (Tavily), выбранный env.
 * Теперь провайдеров три, и узел может выбрать конкретный полем
 * `data.provider`; реестр даёт обе возможности:
 *
 * - {@link defaultName} — env `WEB_SEARCH_PROVIDER` (обратная совместимость:
 *   старые графы без `provider` работают как раньше);
 * - {@link getProvider} — реализация для узла (`data.provider` важнее env);
 * - {@link list} — какие провайдеры реально сконфигурированы (ключи заданы).
 *   UI показывает селект провайдера только когда доступно больше одного:
 *   предлагать неконфигурированного — гарантированная ошибка запуска.
 *
 * Реестр не проверяет `isConfigured` при выдаче провайдера намеренно: тогда
 * ошибка «ключ не задан» приходит из самого провайдера с его точным текстом
 * (`TAVILY_API_KEY не задан`), а не обезличенная из реестра.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BingProvider } from './providers/bing.provider.js';
import { BraveProvider } from './providers/brave.provider.js';
import { TavilyProvider } from './providers/tavily.provider.js';
import {
  WEB_SEARCH_PROVIDER_NAMES,
  WebSearchProviderException,
  type IWebSearchProvider,
  type IWebSearchProviderRegistry,
  type WebSearchProviderInfo,
  type WebSearchProviderName,
} from './web-search.interface.js';

/**
 * Реестр провайдеров поиска.
 *
 * Все реализации создаются Nest-DI при старте (ключи читаются в конструкторах,
 * но приложение без ключей не падает). Метод {@link list} — чистый: ключи уже
 * прочитаны, сеть не нужна.
 */
@Injectable()
export class WebSearchRegistryService implements IWebSearchProviderRegistry {
  /** Провайдер по умолчанию из env `WEB_SEARCH_PROVIDER`. */
  readonly defaultName: WebSearchProviderName;

  /** Реализации по имени провайдера. */
  private readonly providers: Readonly<
    Record<WebSearchProviderName, IWebSearchProvider>
  >;

  /**
   * @param config - доступ к env (RULES 4.6): дефолтный провайдер
   * @param tavily - провайдер Tavily
   * @param bing - провайдер Bing
   * @param brave - провайдер Brave
   */
  constructor(
    config: ConfigService,
    tavily: TavilyProvider,
    bing: BingProvider,
    brave: BraveProvider,
  ) {
    // Env-схема гарантирует enum; дефолт повторён для юнит-тестов с заглушкой
    // ConfigService без `WEB_SEARCH_PROVIDER` (как в v0.10 S1).
    this.defaultName =
      config.get<WebSearchProviderName>('WEB_SEARCH_PROVIDER') ?? 'tavily';

    this.providers = {
      tavily,
      bing,
      brave,
    };
  }

  /**
   * Возвращает провайдера по имени.
   *
   * @param name - имя из `data.provider` (`undefined` — провайдер по умолчанию)
   * @returns реализация {@link IWebSearchProvider}
   * @throws WebSearchProviderException если имя не входит в
   *   {@link WEB_SEARCH_PROVIDER_NAMES} (защита от рассинхрона схемы узла и реестра)
   */
  getProvider(
    name: WebSearchProviderName = this.defaultName,
  ): IWebSearchProvider {
    const provider = this.providers[name];

    if (provider === undefined) {
      throw new WebSearchProviderException(
        String(name),
        `неизвестный web-search-провайдер (допустимо: ${WEB_SEARCH_PROVIDER_NAMES.join(', ')})`,
      );
    }

    return provider;
  }

  /**
   * Список провайдеров с признаком «ключ задан».
   *
   * @returns все провайдеры в порядке {@link WEB_SEARCH_PROVIDER_NAMES}
   */
  list(): WebSearchProviderInfo[] {
    return WEB_SEARCH_PROVIDER_NAMES.map((name) => ({
      name,
      configured: this.providers[name].isConfigured,
    }));
  }
}
