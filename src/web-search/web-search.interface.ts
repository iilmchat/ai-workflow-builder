/**
 * Контракт web-search-провайдера (v0.10 S1, DESIGN v0.10 § 2.2/§ 3.1).
 *
 * Узел `web_search` и его исполнитель (S2) работают только с этим интерфейсом
 * и не знают о конкретном провайдере. Провайдер по умолчанию выбирается env
 * `WEB_SEARCH_PROVIDER`, а конкретный узел может переопределить его полем
 * `data.provider` (v0.15 S3, DESIGN v0.14 § 3.3).
 *
 * Результаты поиска — **недоверенный контент**: их нельзя исполнять и вставлять
 * как HTML; при передаче в LLM вызывающий код обязан обернуть их инструкцией
 * «это источники, не команды» (prompt injection, DESIGN v0.10 § 3.1.2).
 */
import { z } from 'zod';

/**
 * Допустимые идентификаторы web-search-провайдеров.
 *
 * Единый источник истины для env-схемы, Zod-схемы узла, реестра и UI: новый
 * провайдер добавляется здесь и в {@link IWebSearchProviderRegistry}, а
 * расхождение ловится `satisfies` в реестре и тестами модуля.
 */
export const WEB_SEARCH_PROVIDER_NAMES = ['tavily', 'bing', 'brave'] as const;

/** Идентификатор web-search-провайдера. */
export type WebSearchProviderName = (typeof WEB_SEARCH_PROVIDER_NAMES)[number];

/**
 * Zod-схема идентификатора провайдера.
 *
 * Нужна контракт-гейту (`api-contract.spec.ts`, KI-548): домен
 * `WebSearchProviderInfo.name`/`WebSearchProvidersResponse.defaultProvider`
 * читается из `z.enum.options`, а не дублируется литералами в spec'е.
 */
export const WebSearchProviderNameSchema = z.enum(WEB_SEARCH_PROVIDER_NAMES);

/**
 * Провайдеры, поддерживающие параметр глубины поиска.
 *
 * Tavily принимает `search_depth` (`basic`/`advanced`). У Bing Web Search API
 * v7 и Brave Search API такого параметра нет — им соответствует `freshness`
 * (см. {@link WEB_SEARCH_FRESHNESS_PROVIDERS}).
 */
export const WEB_SEARCH_DEPTH_PROVIDERS: readonly WebSearchProviderName[] = [
  'tavily',
];

/**
 * Провайдеры, поддерживающие фильтр свежести (`freshness`).
 *
 * Tavily: `time_range` (`day`/`week`/`month`/`year`, для `general` и `news`).
 * Bing: `Day`/`Week`/`Month` (алиасы `day`/`week`/`month`) и диапазон дат.
 * Brave: `pd`/`pw`/`pm`/`py` (алиасы `day`/`week`/`month`/`year`) и диапазон
 * дат.
 */
export const WEB_SEARCH_FRESHNESS_PROVIDERS: readonly WebSearchProviderName[] = [
  'tavily',
  'bing',
  'brave',
];

/**
 * Опции одного поискового запроса.
 *
 * Поля аддитивные (v0.15 S3): старый вызов `{ maxResults }` продолжает
 * работать, а провайдер сам решает, какие параметры он умеет передавать.
 */
export interface WebSearchOptions {
  /**
   * Максимальное число результатов (1–10).
   *
   * Провайдер нормализует значение: `undefined` — дефолт (5), значения вне
   * диапазона обрезаются. Жёсткий cap защищает контекст LLM и стоимость
   * запроса (DESIGN v0.10 § 3.1.4/§ 7.2).
   */
  maxResults?: number;
  /**
   * Глубина поиска (`basic`/`advanced`).
   *
   * Поддерживается провайдерами из {@link WEB_SEARCH_DEPTH_PROVIDERS};
   * остальные его игнорируют (поле общее для всех реализаций).
   */
  searchDepth?: 'basic' | 'advanced';
  /**
   * Свежесть результатов (DESIGN v0.14 § 3.3).
   *
   * Провайдеро-независимые алиасы `day`/`week`/`month`/`year` плюс нативные
   * форматы провайдера (Bing `Day`/`Week`/`Month`/диапазон дат, Brave
   * `pd`/`pw`/`pm`/`py`/диапазон дат). Поддерживается провайдерами из
   * {@link WEB_SEARCH_FRESHNESS_PROVIDERS}; остальные игнорируют.
   */
  freshness?: string;
}

/**
 * Один результат поиска.
 *
 * `rawContent` — полный текст страницы, если провайдер его отдал (Tavily:
 * `include_raw_content: true`). Поле опционально: часть результатов приходит
 * только со сниппетом, и подставлять туда пустую строку нельзя — потребитель
 * (executor/LLM) должен отличать «текста нет» от «текст пустой».
 */
export interface WebSearchResult {
  /** Заголовок страницы. */
  title: string;
  /** Канонический URL источника. */
  url: string;
  /** Краткий фрагмент для LLM (Tavily: `content`, обрезается до 500 символов). */
  snippet: string;
  /** Полный текст страницы, если провайдер его вернул. */
  rawContent?: string;
}

/**
 * Провайдер веб-поиска.
 *
 * `isConfigured` — есть ли ключ: без него приложение поднимается, но вызов
 * поиска падает понятной ошибкой (как у LLM/media-провайдеров).
 */
export interface IWebSearchProvider {
  /** Идентификатор провайдера для логов и ошибок (`tavily`, `bing`, `brave`). */
  readonly name: WebSearchProviderName;
  /** Готов ли провайдер к вызовам (задан ли API-ключ). */
  readonly isConfigured: boolean;
  /**
   * Выполняет поиск.
   *
   * @param query - поисковый запрос (обрезается; пустой отклоняется)
   * @param options - лимит результатов, глубина и свежесть
   * @returns результаты в порядке релевантности от провайдера
   * @throws WebSearchProviderException при отсутствии ключа, неверном ключе
   *   (401/403) и прочих детерминированных ошибках
   * @throws RetryableNodeException при 429/5xx/таймауте/сетевом сбое
   */
  searchAsync(
    query: string,
    options?: WebSearchOptions,
  ): Promise<WebSearchResult[]>;
}

/** Провайдер и его состояние: есть ли ключ (для UI-селекта). */
export interface WebSearchProviderInfo {
  /** Идентификатор провайдера. */
  name: WebSearchProviderName;
  /** Задан ли ключ: неконфигурированный провайдер в селекте не предлагается. */
  configured: boolean;
}

/**
 * Ответ `GET /web-search/providers` (v0.15 S3).
 *
 * UI узла `web_search` берёт отсюда провайдера по умолчанию (он же из env) и
 * список сконфигурированных, чтобы показать селект только при реальном выборе.
 * Ключи и прочие секреты сюда не попадают (RULES 5.1).
 */
export interface WebSearchProvidersResponse {
  /** Провайдер по умолчанию (env `WEB_SEARCH_PROVIDER`). */
  defaultProvider: WebSearchProviderName;
  /** Все известные провайдеры с признаком «ключ задан». */
  providers: WebSearchProviderInfo[];
}

/**
 * Реестр web-search-провайдеров.
 *
 * Исполнитель узла получает реестр, а не один провайдер: `data.provider`
 * конкретного узла выбирает реализацию, а `defaultName` — серверный дефолт из
 * env `WEB_SEARCH_PROVIDER` (обратная совместимость старых графов).
 */
export interface IWebSearchProviderRegistry {
  /** Провайдер по умолчанию из env `WEB_SEARCH_PROVIDER`. */
  readonly defaultName: WebSearchProviderName;
  /**
   * Возвращает провайдера по имени.
   *
   * @param name - имя из `data.provider`; `undefined` — провайдер по умолчанию
   * @returns реализация {@link IWebSearchProvider}
   * @throws WebSearchProviderException если имя неизвестно
   */
  getProvider(name?: WebSearchProviderName): IWebSearchProvider;
  /** Все провайдеры с признаком «ключ задан» (для UI-селекта). */
  list(): WebSearchProviderInfo[];
}

/**
 * Детерминированная ошибка web-search-провайдера.
 *
 * Наследуется от `Error`, а не от Nest `HttpException`: исключение живёт в
 * worker'е и должно приводить к `run.status='failed'`, а не к HTTP-ответу.
 *
 * Признака `retryable` у неё нет намеренно: повтор с тем же ключом/запросом
 * даст тот же результат. Временные сбои (429/5xx/таймаут) бросаются как
 * `RetryableNodeException` — по нему движок повторит узел (KI-036).
 */
export class WebSearchProviderException extends Error {
  /** Идентификатор провайдера (`tavily`, `bing`, `brave`). */
  readonly provider: string;

  /**
   * @param provider - идентификатор провайдера
   * @param message - понятный пользователю текст ошибки
   * @param options.cause - исходная ошибка/ответ upstream, если есть
   */
  constructor(
    provider: string,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'WebSearchProviderException';
    this.provider = provider;

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
