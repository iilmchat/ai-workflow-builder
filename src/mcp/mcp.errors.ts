/**
 * Ошибки MCP-адаптера (v0.11 S6, DESIGN § 3.2.2, § 3.2.3).
 *
 * Все классы наследуются от `Error`, а не от Nest `HttpException`: клиент
 * работает в worker'е, а не в HTTP-запросе, и ошибка должна перевести узел
 * `agent` в `failed` с понятным текстом (RULES 1.7). Отдельные классы нужны,
 * чтобы вызывающий код мог различать «фича выключена», «сервер недоступен»,
 * «инструмент не найден» и «вызов инструмента упал» — и не гасить стек.
 */

/**
 * Ошибка: MCP-адаптер выключен администратором (`MCP_ENABLED=false`).
 *
 * Отдельный класс, а не `McpUnavailableException`: это не сбой сети, а
 * состояние окружения. Узел с `mcpTools` падает до первого LLM-вызова с
 * текстом, который объясняет, почему инструменты недоступны (DESIGN § 4.7).
 */
export class McpDisabledException extends Error {
  /** Создаёт ошибку «MCP выключен конфигурацией». */
  constructor() {
    super(
      'MCP-адаптер отключён: MCP_ENABLED=false. ' +
        'Включите MCP и задайте MCP_SERVERS, чтобы использовать MCP-инструменты',
    );
    this.name = 'McpDisabledException';
  }
}

/**
 * Ошибка конфигурации MCP-сервера.
 *
 * Возникает, когда сервер описан в `MCP_SERVERS`, но использовать его нельзя:
 * например, не задана env-переменная из `tokenEnv`. Это ошибка оператора, а не
 * пользователя графа, поэтому сообщение не содержит значений секретов
 * (DESIGN § 3.2.1).
 */
export class McpConfigurationException extends Error {
  /** Имя сервера из `MCP_SERVERS`. */
  readonly server: string;

  /**
   * @param server - имя MCP-сервера
   * @param reason - что именно не так в конфигурации
   */
  constructor(server: string, reason: string) {
    super(`MCP-сервер '${server}': ${reason}`);
    this.name = 'McpConfigurationException';
    this.server = server;
  }
}

/**
 * Ошибка: MCP-сервер недоступен (сеть, таймаут, неизвестное имя сервера).
 *
 * Узел `agent` падает preflight'ом **до** первого платного LLM-вызова: платить
 * за цикл, который не сможет вызвать запрошенный инструмент, незачем
 * (DESIGN § 3.2.5).
 */
export class McpUnavailableException extends Error {
  /** Имя сервера из `MCP_SERVERS`. */
  readonly server: string;

  /**
   * @param server - имя MCP-сервера
   * @param reason - причина недоступности (текст для пользователя)
   * @param options - стандартные опции `Error` (в первую очередь `cause`)
   */
  constructor(server: string, reason: string, options?: ErrorOptions) {
    super(`MCP-сервер '${server}' недоступен: ${reason}`, options);
    this.name = 'McpUnavailableException';
    this.server = server;
  }
}

/**
 * Ошибка: инструмент, выбранный в узле, отсутствует в каталоге сервера.
 *
 * Каталог мог измениться после сохранения графа (сервер обновился), поэтому
 * это не битые данные узла, а расхождение с реальным сервером.
 */
export class McpToolNotFoundException extends Error {
  /** Имя сервера из `MCP_SERVERS`. */
  readonly server: string;
  /** Имя инструмента, которого нет в каталоге. */
  readonly tool: string;

  /**
   * @param server - имя MCP-сервера
   * @param tool - имя запрошенного инструмента
   */
  constructor(server: string, tool: string) {
    super(`MCP-инструмент '${tool}' не найден на сервере '${server}'`);
    this.name = 'McpToolNotFoundException';
    this.server = server;
    this.tool = tool;
  }
}

/**
 * Ошибка вызова MCP-инструмента.
 *
 * Сюда попадают транспортные сбои `tools/call` и `isError: true` в ответе
 * сервера. Для агента это **tool-ошибка**, а не падение узла: текст уходит в
 * транскрипт, и модель может сменить стратегию (DESIGN § 3.2.4).
 */
export class McpToolCallException extends Error {
  /** Имя сервера, если известно. */
  readonly server?: string;
  /** Имя инструмента, если известно. */
  readonly tool?: string;

  /**
   * @param message - текст ошибки (для `isError` — текст от сервера)
   * @param options - стандартные опции `Error` + имена сервера/инструмента
   */
  constructor(
    message: string,
    options: { cause?: unknown; server?: string; tool?: string } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'McpToolCallException';

    if (options.server !== undefined) {
      this.server = options.server;
    }

    if (options.tool !== undefined) {
      this.tool = options.tool;
    }
  }
}
