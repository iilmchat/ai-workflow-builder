/**
 * MCP-клиент: подключение, каталог и вызов инструментов (v0.11 S6, DESIGN § 3.2.3).
 *
 * Один клиент на сервер на процесс: соединение переиспользуется между
 * запусками, это снижает latency и нагрузку на MCP-сервер. Параллельные узлы
 * не создают N соединений — первый `connect` кладёт Promise в состояние, а
 * остальные ждут его (connect-mutex). Каталог инструментов кэшируется на
 * `MCP_CATALOG_TTL_MS` и инвалидируется уведомлением `tools/list_changed`.
 *
 * **Почему `fetch` SDK не заменяется на `SafeHttpClient`.** MCP-серверы —
 * доверенная конфигурация оператора и часто живут на приватных адресах;
 * SSRF-блокировка сломала бы основной сценарий. Защита — allowlist в env,
 * `redirectPolicy: 'same-origin'` и отсутствие URL из графа (DESIGN § 3.2.3).
 */
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerConfig } from './mcp.config.js';
import { readIntegerConfig } from './mcp.config.js';
import {
  McpConfigurationException,
  McpToolCallException,
  McpUnavailableException,
} from './mcp.errors.js';
import { McpServerRegistry } from './mcp-server.registry.js';
import {
  MCP_CATALOG_MAX_PAGES,
  MCP_CATALOG_TTL_MS_DEFAULT,
  MCP_CLIENT_NAME,
  MCP_CLIENT_VERSION,
  MCP_CONNECT_TIMEOUT_MS_DEFAULT,
  MCP_MAX_TOOLS_PER_SERVER_DEFAULT,
  MCP_REQUEST_TIMEOUT_MS_DEFAULT,
  type McpToolAnnotations,
  type McpToolDescriptor,
} from './mcp.types.js';

/**
 * Состояние одного MCP-сервера в процессе.
 *
 * Мутируется только клиентом и только под его контролем: `client`/`transport`
 * обнуляются при разрыве соединения, чтобы следующий вызов переподключился
 * (транспортный сбой одного вызова не убивает сервер навсегда).
 */
interface ServerState {
  /** Имя сервера из `MCP_SERVERS`. */
  readonly name: string;
  /** Валидированная конфигурация. */
  readonly config: McpServerConfig;
  /** Подключённый клиент либо `null` (нет соединения). */
  client: Client | null;
  /** Активный транспорт (нужен для `close()` и сверки `onclose`). */
  transport: Transport | null;
  /** Кэш каталога инструментов. */
  tools: McpToolDescriptor[] | null;
  /** Момент истечения кэша каталога (мс, `Date.now()`). */
  expiresAt: number;
  /** Текущий connect в полёте (connect-mutex). */
  connecting: Promise<Client> | null;
  /** Текущая загрузка каталога в полёте (чтобы не дублировать пагинацию). */
  loading: Promise<readonly McpToolDescriptor[]> | null;
  /** Последний текст ошибки подключения (для диагностики/логов). */
  lastError: string | null;
}

/**
 * Приводит неизвестную ошибку к тексту.
 *
 * @param error - значение из `catch` (тип `unknown`)
 * @returns текст ошибки
 */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Преобразует инструмент из ответа SDK в нормализованное описание.
 *
 * Поля копируются поштучно с проверкой `undefined`: в `McpToolDescriptor`
 * включены `exactOptionalPropertyTypes`-совместимые опциональные поля, и
 * «поле со значением undefined» не должно попадать в объект.
 *
 * @param tool - инструмент из `tools/list` (валидирован Zod-схемой SDK)
 * @returns описание для агента/UI
 */
function toToolDescriptor(tool: Tool): McpToolDescriptor {
  const annotations: McpToolAnnotations | undefined =
    tool.annotations === undefined
      ? undefined
      : {
          ...(tool.annotations.title === undefined
            ? {}
            : { title: tool.annotations.title }),
          ...(tool.annotations.readOnlyHint === undefined
            ? {}
            : { readOnlyHint: tool.annotations.readOnlyHint }),
          ...(tool.annotations.destructiveHint === undefined
            ? {}
            : { destructiveHint: tool.annotations.destructiveHint }),
          ...(tool.annotations.idempotentHint === undefined
            ? {}
            : { idempotentHint: tool.annotations.idempotentHint }),
          ...(tool.annotations.openWorldHint === undefined
            ? {}
            : { openWorldHint: tool.annotations.openWorldHint }),
        };

  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.description === undefined
      ? {}
      : { description: tool.description }),
    inputSchema: tool.inputSchema,
    ...(annotations === undefined ? {} : { annotations }),
  };
}

/**
 * Проверяет, что ответ `tools/call` — структурированный результат SDK.
 *
 * Ответ сервера — внешние данные (RULES 1.17), поэтому форма проверяется до
 * передачи в нормализатор: compatibility-вариант с `toolResult` не содержит
 * `content` и не может быть безопасно превращён в текст транскрипта.
 *
 * @param result - ответ `client.callTool` (тип `unknown` на границе)
 * @returns `true`, если ответ содержит массив `content`
 */
function isCallToolResult(result: unknown): result is CallToolResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    Array.isArray((result as { content?: unknown }).content)
  );
}

/**
 * Клиент MCP: жизненный цикл соединений, каталог и вызовы инструментов.
 *
 * Сервисы-потребители: `AgentService` (preflight, вызовы) и `McpToolAdapter`
 * (сборка `AgentTool`). Ошибки подключения не кэшируются навсегда: следующий
 * вызов пробует переподключиться.
 */
@Injectable()
export class McpClientService implements OnApplicationShutdown {
  private readonly logger = new Logger(McpClientService.name);

  /** Состояния серверов, к которым уже обращались (ленивое создание). */
  private readonly states = new Map<string, ServerState>();

  /** Таймаут подключения, мс. */
  private readonly connectTimeoutMs: number;

  /** Таймаут одного запроса (`listTools`/`callTool`), мс. */
  private readonly requestTimeoutMs: number;

  /** TTL кэша каталога, мс. */
  private readonly catalogTtlMs: number;

  /** Максимум инструментов от одного сервера. */
  private readonly maxToolsPerServer: number;

  /** Остановлен ли сервис (после `onApplicationShutdown`). */
  private shuttingDown = false;

  /**
   * @param config - конфигурация приложения (таймауты и лимиты из env)
   * @param registry - реестр серверов (единственный источник конфигурации)
   */
  constructor(
    private readonly config: ConfigService,
    private readonly registry: McpServerRegistry,
  ) {
    this.connectTimeoutMs = readIntegerConfig(
      config,
      'MCP_CONNECT_TIMEOUT_MS',
      MCP_CONNECT_TIMEOUT_MS_DEFAULT,
      1_000,
      60_000,
    );
    this.requestTimeoutMs = readIntegerConfig(
      config,
      'MCP_REQUEST_TIMEOUT_MS',
      MCP_REQUEST_TIMEOUT_MS_DEFAULT,
      1_000,
      300_000,
    );
    this.catalogTtlMs = readIntegerConfig(
      config,
      'MCP_CATALOG_TTL_MS',
      MCP_CATALOG_TTL_MS_DEFAULT,
      5_000,
      600_000,
    );
    this.maxToolsPerServer = readIntegerConfig(
      config,
      'MCP_MAX_TOOLS_PER_SERVER',
      MCP_MAX_TOOLS_PER_SERVER_DEFAULT,
      1,
      500,
    );
  }

  /**
   * Включён ли MCP-адаптер.
   *
   * @returns `true`, если `MCP_ENABLED=true`
   */
  isEnabled(): boolean {
    return this.registry.isEnabled();
  }

  /**
   * Описан ли сервер в операторском реестре `MCP_SERVERS`.
   *
   * Нужен валидации данных узла: ссылка на неизвестный сервер — ошибка графа,
   * её надо отличить от сетевого сбоя до preflight (DESIGN § 3.2.5).
   *
   * @param serverName - имя сервера из `data.mcpTools[].server`
   * @returns `true`, если сервер есть в реестре
   */
  hasServer(serverName: string): boolean {
    return this.registry.getServer(serverName) !== undefined;
  }

  /**
   * Preflight узла агента: подключает серверы и прогревает каталог.
   *
   * Вызывается **до** первого LLM-вызова: если сервер недоступен, узел падает
   * без платного цикла (DESIGN § 3.2.5). Повторные имена серверов схлопываются,
   * серверы подключаются параллельно (RULES 4.17).
   *
   * @param serverNames - имена серверов из `data.mcpTools[].server`
   * @returns Promise, завершающийся после получения каталогов
   * @throws McpDisabledException если MCP выключен
   * @throws McpUnavailableException если сервер не описан или недоступен
   */
  async prepareAsync(serverNames: readonly string[]): Promise<void> {
    const unique = [...new Set(serverNames)];

    if (unique.length === 0) {
      return;
    }

    this.registry.assertEnabled();

    await Promise.all(unique.map((name) => this.listToolsAsync(name)));
  }

  /**
   * Возвращает каталог инструментов сервера (из кэша или по сети).
   *
   * Пагинация: SDK отдаёт `nextCursor`, клиент дочитывает страницы до лимита
   * `MCP_MAX_TOOLS_PER_SERVER` (DESIGN § 3.2.3). Внутри TTL сеть не трогается.
   *
   * @param serverName - имя сервера из `MCP_SERVERS`
   * @returns описание инструментов в порядке сервера
   * @throws McpDisabledException если MCP выключен
   * @throws McpUnavailableException если сервер не описан/недоступен
   */
  async listToolsAsync(
    serverName: string,
  ): Promise<readonly McpToolDescriptor[]> {
    const state = this.getState(serverName);

    if (state.tools !== null && Date.now() < state.expiresAt) {
      return state.tools;
    }

    if (state.loading !== null) {
      return state.loading;
    }

    const loading = this.loadCatalogAsync(state);

    state.loading = loading;

    try {
      return await loading;
    } finally {
      if (state.loading === loading) {
        state.loading = null;
      }
    }
  }

  /**
   * Вызывает MCP-инструмент.
   *
   * @param serverName - имя сервера из `MCP_SERVERS`
   * @param toolName - имя инструмента на сервере (без префикса `mcp__…`)
   * @param args - аргументы вызова (JSON-объект)
   * @returns сырой ответ SDK; нормализация — в `mcp-tool.adapter.ts`
   * @throws McpDisabledException если MCP выключен
   * @throws McpUnavailableException если сервер не описан/недоступен
   * @throws McpToolCallException если `tools/call` упал на транспорте
   */
  async callToolAsync(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const state = this.getState(serverName);
    const client = await this.ensureClientAsync(state);
    const startedAt = Date.now();

    try {
      const result = await client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { timeout: this.requestTimeoutMs },
      );

      // SDK возвращает один из двух вариантов (структурированный результат или
      // compatibility-форму с `toolResult`). Нормализатор работает с первым,
      // поэтому compatibility-ответ — явная ошибка вызова, а не «тихий» null.
      if (!isCallToolResult(result)) {
        throw new McpToolCallException(
          `MCP-инструмент '${toolName}' сервера '${serverName}' вернул ` +
            'неподдерживаемый формат результата',
          { server: serverName, tool: toolName },
        );
      }

      // RULES 5.9: в лог — только имена и длительность, без аргументов/результатов.
      this.logger.log(
        `MCP ${serverName}/${toolName}: вызов выполнен за ${Date.now() - startedAt} мс`,
      );

      return result;
    } catch (error: unknown) {
      // Уже классифицированную ошибку формата не оборачиваем повторно.
      if (error instanceof McpToolCallException) {
        throw error;
      }

      // DESIGN § 3.2.3: транспортный сбой одного вызова не убивает клиент
      // навсегда. Сбрасываем соединение, чтобы следующий вызов переподключился,
      // даже если транспорт не прислал `onclose`/`onerror`.
      this.markDisconnected(state);

      const message = toMessage(error);

      this.logger.warn(
        `MCP ${serverName}/${toolName}: вызов упал за ${Date.now() - startedAt} мс — ${message}`,
      );

      throw new McpToolCallException(
        `MCP-инструмент '${toolName}' сервера '${serverName}' упал: ${message}`,
        { cause: error, server: serverName, tool: toolName },
      );
    }
  }

  /**
   * Инвалидирует каталог сервера.
   *
   * Используется обработчиком `tools/list_changed` и разрывом соединения:
   * сервер мог изменить набор инструментов, поэтому старый кэш не годится.
   *
   * @param serverName - имя сервера
   */
  invalidateCatalog(serverName: string): void {
    const state = this.states.get(serverName);

    if (state === undefined) {
      return;
    }

    state.tools = null;
    state.expiresAt = 0;
  }

  /**
   * Помечает соединение сервера неготовым после сбоя вызова.
   *
   * `onclose`/`onerror` транспорта — не единственный путь разрыва: запрос
   * может упасть (таймаут, сброс сокета), не закрыв транспорт. Следующий вызов
   * тогда бесконечно бил бы в мёртвый клиент, поэтому сбой вызова явно
   * сбрасывает соединение — новый вызов переподключится (DESIGN § 3.2.3).
   *
   * @param state - состояние сервера
   */
  private markDisconnected(state: ServerState): void {
    const client = state.client;

    state.client = null;
    state.transport = null;
    state.tools = null;
    state.expiresAt = 0;

    if (client !== null) {
      // Клиент уже непригоден; закрываем без ожидания и без шума.
      void client.close().catch(() => undefined);
    }
  }

  /**
   * Закрывает все транспорты при остановке приложения (RULES 4.12).
   *
   * @returns Promise, завершающийся после закрытия всех клиентов
   */
  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;

    const states = [...this.states.values()];

    await Promise.all(
      states.map(async (state) => {
        const client = state.client;

        state.client = null;
        state.transport = null;
        state.tools = null;
        state.expiresAt = 0;

        if (client === null) {
          return;
        }

        try {
          await client.close();
        } catch (error: unknown) {
          this.logger.warn(
            `MCP-сервер '${state.name}': ошибка закрытия клиента — ${toMessage(error)}`,
          );
        }
      }),
    );
  }

  /**
   * Возвращает состояние сервера, создавая его лениво.
   *
   * @param serverName - имя сервера
   * @returns мутируемое состояние сервера
   * @throws McpDisabledException если MCP выключен
   * @throws McpUnavailableException если сервер не описан или выключен
   */
  private getState(serverName: string): ServerState {
    this.registry.assertEnabled();

    if (this.shuttingDown) {
      throw new McpUnavailableException(
        serverName,
        'приложение останавливается, MCP-клиент закрыт',
      );
    }

    const existing = this.states.get(serverName);

    if (existing !== undefined) {
      return existing;
    }

    const config = this.registry.getServerOrThrow(serverName);

    if (!config.enabled) {
      throw new McpUnavailableException(
        serverName,
        'сервер выключен в конфигурации (enabled=false)',
      );
    }

    const state: ServerState = {
      name: serverName,
      config,
      client: null,
      transport: null,
      tools: null,
      expiresAt: 0,
      connecting: null,
      loading: null,
      lastError: null,
    };

    this.states.set(serverName, state);

    return state;
  }

  /**
   * Возвращает подключённый клиент, подключаясь при необходимости.
   *
   * Connect-mutex: параллельные вызовы ждут один и тот же Promise, а не
   * создают N соединений (DESIGN § 3.2.3).
   *
   * @param state - состояние сервера
   * @returns подключённый клиент
   * @throws McpUnavailableException если подключиться не удалось
   */
  private async ensureClientAsync(state: ServerState): Promise<Client> {
    if (state.client !== null) {
      return state.client;
    }

    if (state.connecting !== null) {
      return state.connecting;
    }

    const connecting = this.connectAsync(state);

    state.connecting = connecting;

    try {
      return await connecting;
    } finally {
      if (state.connecting === connecting) {
        state.connecting = null;
      }
    }
  }

  /**
   * Создаёт клиент и транспорт, выполняет MCP-инициализацию.
   *
   * @param state - состояние сервера
   * @returns подключённый клиент
   * @throws McpConfigurationException если не задан токен из `tokenEnv`
   * @throws McpUnavailableException если подключение не удалось/истёк таймаут
   */
  private async connectAsync(state: ServerState): Promise<Client> {
    const config = state.config;
    let client: Client | null = null;

    try {
      const headers = this.buildHeaders(state);
      client = new Client(
        { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
        {
          capabilities: {},
          listChanged: {
            tools: {
              // Каталог обновляем сами: SDK не должен ходить в сеть повторно
              // внутри обработчика уведомления.
              autoRefresh: false,
              onChanged: (error: Error | null): void => {
                if (error !== null) {
                  this.logger.warn(
                    `MCP-сервер '${state.name}': ошибка tools/list_changed — ${error.message}`,
                  );
                }

                this.invalidateCatalog(state.name);
                this.logger.log(
                  `MCP-сервер '${state.name}': каталог инвалидирован (tools/list_changed)`,
                );
              },
            },
          },
        },
      );

      const transport = this.createTransport(config, headers);
      const serverName = state.name;

      transport.onclose = (): void => {
        this.handleTransportClosed(state, transport);
      };
      transport.onerror = (error: Error): void => {
        if (this.shuttingDown) {
          // При остановке приложения SDK штатно рвёт SSE-поток (AbortError):
          // это не ошибка сервера, не шумим WARN'ом.
          this.logger.debug(
            `MCP-сервер '${serverName}': поток закрыт при остановке — ${error.message}`,
          );

          return;
        }

        this.logger.warn(
          `MCP-сервер '${serverName}': ошибка транспорта — ${error.message}`,
        );
        this.handleTransportClosed(state, transport);
      };

      await client.connect(transport, { timeout: this.connectTimeoutMs });

      state.client = client;
      state.transport = transport;
      state.lastError = null;

      this.logger.log(
        `MCP-сервер '${serverName}' подключён (транспорт: ${config.transport})`,
      );

      return client;
    } catch (error: unknown) {
      state.client = null;
      state.transport = null;
      state.tools = null;
      state.expiresAt = 0;
      state.lastError = toMessage(error);

      if (client !== null) {
        try {
          await client.close();
        } catch {
          // Клиент мог не успеть подключиться — закрывать нечего.
        }
      }

      if (error instanceof McpConfigurationException) {
        throw error;
      }

      throw new McpUnavailableException(
        state.name,
        `не удалось подключиться: ${toMessage(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * Собирает HTTP-заголовки подключения.
   *
   * Токен читается из env **по имени** `tokenEnv` в момент подключения: сам
   * секрет не хранится в `MCP_SERVERS` и не попадает в логи (RULES 5.1/5.2).
   *
   * @param state - состояние сервера
   * @returns заголовки запроса
   * @throws McpConfigurationException если переменная из `tokenEnv` не задана
   */
  private buildHeaders(state: ServerState): Record<string, string> {
    const config = state.config;
    const headers: Record<string, string> = { ...config.headers };

    if (config.tokenEnv !== undefined) {
      const token = this.config.get<unknown>(config.tokenEnv);

      if (typeof token !== 'string' || token.length === 0) {
        throw new McpConfigurationException(
          state.name,
          `не задана переменная ${config.tokenEnv} (tokenEnv)`,
        );
      }

      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

  /**
   * Создаёт транспорт по конфигурации сервера.
   *
   * `redirectPolicy: 'same-origin'` не даёт серверу увести клиента на другой
   * origin (DESIGN § 3.2.1).
   *
   * @param config - конфигурация сервера
   * @param headers - заголовки (включая bearer-токен)
   * @returns транспорт SDK
   */
  private createTransport(
    config: McpServerConfig,
    headers: Record<string, string>,
  ): Transport {
    const url = new URL(config.url);
    const options = {
      requestInit: { headers },
      redirectPolicy: 'same-origin' as const,
    };

    return config.transport === 'http'
      ? new StreamableHTTPClientTransport(url, options)
      : new SSEClientTransport(url, options);
  }

  /**
   * Реакция на разрыв соединения.
   *
   * Клиент помечается неподключённым, каталог — невалидным; следующий вызов
   * переподключится. Сверка транспорта защищает от `onclose` старого
   * транспорта после успешного переподключения.
   *
   * @param state - состояние сервера
   * @param transport - транспорт, сообщивший о закрытии
   */
  private handleTransportClosed(
    state: ServerState,
    transport: Transport,
  ): void {
    if (state.transport !== transport) {
      return;
    }

    state.client = null;
    state.transport = null;
    state.tools = null;
    state.expiresAt = 0;

    // При остановке приложения транспорт закрывается штатно — WARN не нужен.
    if (!this.shuttingDown) {
      this.logger.warn(
        `MCP-сервер '${state.name}': соединение закрыто, переподключение при следующем вызове`,
      );
    }
  }

  /**
   * Загружает каталог инструментов с пагинацией.
   *
   * @param state - состояние сервера
   * @returns описание инструментов (не больше `MCP_MAX_TOOLS_PER_SERVER`)
   * @throws McpUnavailableException если `listTools` не удался
   */
  private async loadCatalogAsync(
    state: ServerState,
  ): Promise<readonly McpToolDescriptor[]> {
    const client = await this.ensureClientAsync(state);
    const tools: McpToolDescriptor[] = [];
    let cursor: string | undefined;
    let truncated = false;

    try {
      for (let page = 1; page <= MCP_CATALOG_MAX_PAGES; page += 1) {
        const result = await client.listTools(
          cursor === undefined ? undefined : { cursor },
          { timeout: this.requestTimeoutMs },
        );

        for (const tool of result.tools) {
          if (tools.length >= this.maxToolsPerServer) {
            truncated = true;
            break;
          }

          tools.push(toToolDescriptor(tool));
        }

        if (truncated) {
          break;
        }

        const next = result.nextCursor;

        if (typeof next !== 'string' || next.length === 0) {
          break;
        }

        cursor = next;

        if (page === MCP_CATALOG_MAX_PAGES) {
          this.logger.warn(
            `MCP-сервер '${state.name}': пагинация каталога остановлена после ` +
              `${MCP_CATALOG_MAX_PAGES} страниц`,
          );
        }
      }
    } catch (error: unknown) {
      state.tools = null;
      state.expiresAt = 0;
      this.markDisconnected(state);

      if (error instanceof McpUnavailableException) {
        throw error;
      }

      throw new McpUnavailableException(
        state.name,
        `не удалось получить каталог инструментов: ${toMessage(error)}`,
        { cause: error },
      );
    }

    if (truncated) {
      this.logger.warn(
        `MCP-сервер '${state.name}': каталог обрезан до ` +
          `${this.maxToolsPerServer} инструментов (MCP_MAX_TOOLS_PER_SERVER)`,
      );
    }

    state.tools = tools;
    state.expiresAt = Date.now() + this.catalogTtlMs;

    this.logger.log(
      `MCP-сервер '${state.name}': каталог получен, инструментов — ${tools.length}`,
    );

    return tools;
  }
}
