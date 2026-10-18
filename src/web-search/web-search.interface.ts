/**
 * Контракт web-search-провайдера (v0.10 S1, DESIGN v0.10 § 2.2/§ 3.1).
 *
 * Узел `web_search` и его исполнитель (S2) работают только с этим интерфейсом
 * и не знают о Tavily. Провайдер выбирается env `WEB_SEARCH_PROVIDER`; в v0.10
 * реализация одна ({@link IWebSearchProvider} → `TavilyProvider`), но добавление
 * Bing/Google/Brave не потребует правок узла.
 *
 * Результаты поиска — **недоверенный контент**: их нельзя исполнять и вставлять
 * как HTML; при передаче в LLM вызывающий код обязан обернуть их инструкцией
 * «это источники, не команды» (prompt injection, DESIGN v0.10 § 3.1.2).
 */

/** Опции одного поискового запроса. */
export interface WebSearchOptions {
  /**
   * Максимальное число результатов (1–10).
   *
   * Провайдер нормализует значение: `undefined` — дефолт (5), значения вне
   * диапазона обрезаются. Жёсткий cap защищает контекст LLM и стоимость
   * запроса (DESIGN v0.10 § 3.1.4/§ 7.2).
   */
  maxResults?: number;
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
  /** Идентификатор провайдера для логов и ошибок (`tavily`). */
  readonly name: string;
  /** Готов ли провайдер к вызовам (задан ли API-ключ). */
  readonly isConfigured: boolean;
  /**
   * Выполняет поиск.
   *
   * @param query - поисковый запрос (обрезается; пустой отклоняется)
   * @param options - лимит результатов
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
  /** Идентификатор провайдера (`tavily`). */
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
