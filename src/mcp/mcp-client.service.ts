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
 *
 * **`stdio`-транспорт (v0.12 S4, KI-526).** Сервер с `transport: 'stdio'`
 * запускается как локальный процесс через `StdioClientTransport` (внутри —
 * `child_process.spawn` с `shell: false`, `stdio: ['pipe','pipe','pipe']`).
 * Такой сервер включается только при `MCP_ENABLE_STDIO=true`, команда
 * проверяется denylist'ом ({@link assertStdioCommandAllowed}), а на остановке
 * приложения процесс получает `SIGTERM`, затем `SIGKILL` — orphan-процесс не
 * должен переживать backend (DESIGN § 3.3.2/§ 3.3.3).
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  StdioClientTransport,
  type StdioServerParameters,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  assertStdioCommandAllowed,
  isStdioServerConfig,
  parseStdioEnvAllowlist,
  readBooleanConfig,
  readIntegerConfig,
  readStringConfig,
  stdioCommandBase,
  type McpServerConfig,
  type McpStdioServerConfig,
} from './mcp.config.js';
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
  MCP_STDIO_CWD_DEFAULT,
  type McpToolAnnotations,
  type McpToolDescriptor,
} from './mcp.types.js';

/**
 * Максимальная длина строки `stderr` в логе, символов (v0.12 S4, KI-526).
 *
 * MCP-сервер пишет в `stderr` что угодно: прогресс `npx`, стек ошибки, дамп
 * аргументов. Длинные строки обрезаются, поэтому лог не раздувается и не
 * уносит пользовательские данные целиком (RULES 5.9). Уровень — `debug`:
 * `stderr` полезен при разборе «почему сервер не стартовал», но не должен
 * забивать INFO-лог штатной работы.
 */
const MCP_STDIO_STDERR_LINE_MAX = 512;

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
  /**
   * PID дочернего процесса для `stdio`-сервера либо `null`.
   *
   * SDK не отдаёт `ChildProcess` наружу, только `pid`; по нему и выполняется
   * эскалация `SIGTERM` → `SIGKILL` при остановке приложения (DESIGN § 3.3.2).
   */
  stdioPid: number | null;
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
 * Проверяет, жив ли процесс с заданным PID.
 *
 * `process.kill(pid, 0)` не отправляет сигнал, а только проверяет право на
 * него. Коды различаются (v0.13 S1, KI-532):
 * - `ESRCH` — процесса нет → `false`;
 * - `EPERM` — процесс существует, но сигнал ему отправить нельзя (чужой
 *   пользователь/ограничение ОС) → `true`: процесс жив, и попытку `SIGKILL`
 *   надо сделать, а не пропустить;
 * - любая другая ошибка — консервативно `false` (не рискуем убить чужой PID).
 *
 * Нужен перед `SIGKILL`, чтобы не убить чужой процесс, получивший тот же PID
 * после завершения нашего (PID-reuse, KI-526).
 *
 * @param pid - идентификатор процесса
 * @returns `true`, если процесс ещё существует
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error: unknown) {
    // RULES 4.15: `unknown` в catch, без `any`.
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as NodeJS.ErrnoException).code === 'EPERM'
    );
  }
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

  /**
   * Разрешён ли `stdio`-транспорт (`MCP_ENABLE_STDIO`, v0.12 S4).
   *
   * Реестр уже отвергает такие серверы на старте, но клиент проверяет флаг
   * ещё раз: конфигурация могла быть подменена, а запуск процесса — не та
   * операция, где уместно полагаться на одну проверку (DESIGN § 3.3.3).
   */
  private readonly stdioEnabled: boolean;

  /**
   * Базовый каталог изоляции `stdio`-процессов (`MCP_STDIO_CWD`, v0.13 S1).
   *
   * Для каждого сервера создаётся подкаталог `<stdioCwd>/<serverName>` и
   * передаётся транспорту как `cwd` (KI-530).
   */
  private readonly stdioCwd: string;

  /**
   * Имена env-переменных, которые разрешено передать `stdio`-процессу
   * (`MCP_STDIO_ENV_ALLOWLIST`, v0.13 S1, KI-529).
   *
   * Всё, чего нет в этом множестве, не попадает в дочерний процесс — даже
   * если задано в `env` сервера в `MCP_SERVERS`.
   */
  private readonly stdioEnvAllowlist: ReadonlySet<string>;

  /**
   * Серверы, по которым уже предупредили о запуске не через Docker.
   *
   * WARN нужен один раз на сервер, а не на каждое переподключение: иначе
   * реконнект после сетевого сбоя забивал бы лог одинаковой строкой.
   */
  private readonly warnedNonDocker = new Set<string>();

  /**
   * Серверы, по которым уже предупредили о ненайденных именах allowlist
   * (v0.16 S1, KI-534).
   *
   * Переподключение не должно повторять ту же строку: набор имён allowlist —
   * операторская конфигурация, она не меняется без перезапуска приложения.
   * Значения переменных в WARN не попадают (RULES 5.1).
   */
  private readonly warnedMissingAllowlist = new Set<string>();

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
    this.stdioEnabled = readBooleanConfig(
      config.get<unknown>('MCP_ENABLE_STDIO'),
    );
    this.stdioCwd = readStringConfig(
      config,
      'MCP_STDIO_CWD',
      MCP_STDIO_CWD_DEFAULT,
    );
    this.stdioEnvAllowlist = parseStdioEnvAllowlist(
      config.get<unknown>('MCP_STDIO_ENV_ALLOWLIST'),
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
    // SDK закрывает дочерний процесс вместе с транспортом; повторно убивать
    // его по старому PID нельзя — он мог достаться другому процессу.
    state.stdioPid = null;
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
   * Порядок для `stdio`-серверов (v0.12 S4, KI-526):
   * 1. `SIGTERM` — просим процесс завершиться штатно;
   * 2. `client.close()` — SDK закрывает `stdin` и, если процесс не вышел за
   *    2 с, сам шлёт `SIGTERM`, затем `SIGKILL`;
   * 3. `SIGKILL` — добиваем всё, что ещё живо: orphan-процесс MCP-сервера не
   *    должен переживать приложение (он держит порты/файлы и мешает
   *    перезапуску).
   *
   * @returns Promise, завершающийся после закрытия всех клиентов
   */
  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;

    const states = [...this.states.values()];

    // 1) SIGTERM до закрытия потоков: сервер успевает снять свои ресурсы.
    for (const state of states) {
      this.signalStdioProcess(state, 'SIGTERM');
    }

    // 2) Штатное закрытие клиентов (для stdio — ещё и эскалация силами SDK).
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

    // 3) SIGKILL выжившим. `isPidAlive` защищает от PID-reuse: за время
    // закрытия pid мог достаться чужому процессу.
    for (const state of states) {
      const pid = state.stdioPid;

      if (pid !== null && isPidAlive(pid)) {
        this.signalStdioProcess(state, 'SIGKILL');
        this.logger.warn(
          `MCP-сервер '${state.name}': stdio-процесс ${pid} не завершился по SIGTERM, отправлен SIGKILL`,
        );
      }

      state.stdioPid = null;
    }
  }

  /**
   * Отправляет сигнал `stdio`-процессу сервера, не пробрасывая ошибки.
   *
   * `ESRCH` («процесса уже нет») — нормальный исход остановки, а `EPERM` не
   * повод ронять shutdown: клиент всё равно попробует `close()`.
   *
   * @param state - состояние сервера
   * @param signal - сигнал (`SIGTERM` или `SIGKILL`)
   */
  private signalStdioProcess(state: ServerState, signal: NodeJS.Signals): void {
    const pid = state.stdioPid;

    if (pid === null) {
      return;
    }

    try {
      process.kill(pid, signal);
      this.logger.debug(
        `MCP-сервер '${state.name}': stdio-процесс ${pid} — ${signal}`,
      );
    } catch (error: unknown) {
      this.logger.debug(
        `MCP-сервер '${state.name}': ${signal} процессу ${pid} не отправлен — ${toMessage(error)}`,
      );
    }
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
      stdioPid: null,
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
      // stdio-серверу HTTP-заголовки не нужны: он не ходит по сети. `tokenEnv`
      // для него и не задаётся (схема запрещает смешивать транспорты).
      const headers = isStdioServerConfig(config)
        ? {}
        : this.buildHeaders(state);
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

      const transport = await this.createTransport(state, headers);
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
      // PID запоминается сразу после connect: shutdown должен уметь убить
      // процесс, даже если клиент к этому моменту уже отвалился.
      state.stdioPid = isStdioServerConfig(config)
        ? (transport as StdioClientTransport).pid
        : null;
      state.lastError = null;

      this.logger.log(
        `MCP-сервер '${serverName}' подключён (транспорт: ${config.transport})`,
      );

      return client;
    } catch (error: unknown) {
      state.client = null;
      state.transport = null;
      state.stdioPid = null;
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

    // stdio-сервер не ходит по HTTP: заголовков и токена у него нет.
    if (isStdioServerConfig(config)) {
      return {};
    }

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
   * `redirectPolicy: 'same-origin'` не даёт HTTP-серверу увести клиента на
   * другой origin (DESIGN § 3.2.1). Для `stdio` (v0.12 S4) — локальный
   * процесс без оболочки: `StdioClientTransport` вызывает
   * `child_process.spawn(command, args, { shell: false, ... })`, поэтому
   * метасимволы в аргументах не интерпретируются (DESIGN § 3.3.3).
   *
   * @param state - состояние сервера (нужны имя для логов и конфигурация)
   * @param headers - HTTP-заголовки (для `stdio` не используются)
   * @returns транспорт SDK
   * @throws McpConfigurationException если stdio запрещён флагом или команда
   *   попала в denylist
   */
  private async createTransport(
    state: ServerState,
    headers: Record<string, string>,
  ): Promise<Transport> {
    const config = state.config;

    if (isStdioServerConfig(config)) {
      return this.createStdioTransport(state, config);
    }

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
   * Создаёт `stdio`-транспорт, каталог изоляции и env по allowlist.
   *
   * Порядок: проверка флага и denylist'а → WARN о не-Docker команде →
   * создание `<MCP_STDIO_CWD>/<serverName>` → сборка env → транспорт. Каталог
   * создаётся **до** `start()` (его делает `client.connect`): SDK передаёт
   * `cwd` в `spawn`, и несуществующий путь уронил бы запуск процесса.
   *
   * @param state - состояние сервера
   * @param config - `stdio`-конфигурация (команда, аргументы, env)
   * @returns транспорт SDK
   * @throws McpConfigurationException если `MCP_ENABLE_STDIO=false` или команда
   *   запрещена denylist'ом
   */
  private async createStdioTransport(
    state: ServerState,
    config: McpStdioServerConfig,
  ): Promise<StdioClientTransport> {
    if (!this.stdioEnabled) {
      throw new McpConfigurationException(
        state.name,
        'stdio-транспорт выключен (MCP_ENABLE_STDIO=false)',
      );
    }

    // Повторная проверка (первая — при разборе реестра): конфигурация могла
    // измениться после старта, а запуск процесса — не та операция, где
    // уместно верить одной проверке (DESIGN § 3.3.3).
    assertStdioCommandAllowed(config.command);

    this.warnIfNotDocker(state.name, config);

    const cwd = await this.prepareStdioCwdAsync(state.name);
    const env = this.buildStdioEnv(state.name, config);

    const params: StdioServerParameters = {
      command: config.command,
      args: [...config.args],
      // Только разрешённые имена; SDK добавит к ним безопасный набор
      // (PATH/HOME/...), а не весь `process.env` (DESIGN v0.13 § 3.1).
      env,
      cwd,
      // `stderr: 'pipe'`: SDK отдаёт PassThrough сразу, поэтому ранние строки
      // (ошибка `npx`, отсутствующий файл) не теряются до `start()`.
      stderr: 'pipe',
    };
    const transport = new StdioClientTransport(params);

    this.attachStderrLogging(transport, state.name);
    // Значения env не логируются (RULES 5.1) — только количество имён.
    this.logger.log(
      `MCP-сервер '${state.name}': stdio-процесс ${config.command} ` +
        `(аргументов: ${config.args.length}, cwd: ${cwd}, ` +
        `env-переменных: ${Object.keys(env).length})`,
    );

    return transport;
  }

  /**
   * Предупреждает, если `stdio`-процесс запускается не через Docker.
   *
   * Denylist (DESIGN v0.12 § 3.3.3) — эвристика, а процесс получает права
   * backend'а. Реальная изоляция — `docker run`; WARN напоминает об этом
   * оператору при первом подключении сервера (v0.13 S1, KI-530). Повторные
   * переподключения не дублируют строку — см. {@link warnedNonDocker}.
   *
   * @param serverName - имя сервера (ключ в `MCP_SERVERS`)
   * @param config - `stdio`-конфигурация
   */
  private warnIfNotDocker(
    serverName: string,
    config: McpStdioServerConfig,
  ): void {
    // Basename без `.exe`: `/usr/bin/docker` и `C:\...\docker.exe` — Docker.
    if (stdioCommandBase(config.command) === 'docker') {
      return;
    }

    if (this.warnedNonDocker.has(serverName)) {
      return;
    }

    this.warnedNonDocker.add(serverName);
    this.logger.warn(
      `MCP-сервер '${serverName}': stdio-команда '${config.command}' ` +
        'запускается без Docker. Рекомендуется docker run: процесс получает ' +
        'права backend-процесса (DESIGN v0.13 § 3.2, KI-530)',
    );
  }

  /**
   * Собирает env для `stdio`-процесса строго по allowlist.
   *
   * Источники значения: явный `env` сервера в `MCP_SERVERS` (приоритет) и
   * окружение backend'а, прочитанное через `ConfigService` (RULES 4.6).
   * Ключи вне `MCP_STDIO_ENV_ALLOWLIST` не передаются даже при явном `env` —
   * иначе allowlist перестал бы быть границей. Значения не логируются
   * (RULES 5.1).
   *
   * **Диагностика allowlist (v0.16 S1, KI-534).** Если имя из allowlist не
   * найдено ни в `env` сервера, ни в окружении backend'а, пишется WARN с
   * перечнем имён (без значений): опечатка в имени иначе приводила бы к
   * молчаливо пустому env дочернего процесса. WARN — один раз на сервер.
   *
   * @param serverName - имя сервера из `MCP_SERVERS` (для лога)
   * @param config - `stdio`-конфигурация
   * @returns объект env только с разрешёнными именами
   */
  private buildStdioEnv(
    serverName: string,
    config: McpStdioServerConfig,
  ): Record<string, string> {
    const env: Record<string, string> = {};
    const missing: string[] = [];

    for (const name of this.stdioEnvAllowlist) {
      const explicit = config.env?.[name];
      const inherited = this.config.get<unknown>(name);
      const value =
        explicit ?? (typeof inherited === 'string' ? inherited : undefined);

      if (value !== undefined) {
        env[name] = value;
      } else {
        missing.push(name);
      }
    }

    if (missing.length > 0 && !this.warnedMissingAllowlist.has(serverName)) {
      this.warnedMissingAllowlist.add(serverName);
      // Только имена: значения переменных даже не читаются в этой ветке.
      this.logger.warn(
        `MCP-сервер '${serverName}': имена из MCP_STDIO_ENV_ALLOWLIST не ` +
          `найдены ни в env сервера, ни в окружении: ${missing.join(', ')} — ` +
          'переменные не будут переданы stdio-процессу (KI-534)',
      );
    }

    return env;
  }

  /**
   * Создаёт каталог изоляции сервера и возвращает его путь.
   *
   * `<MCP_STDIO_CWD>/<serverName>` — отдельный cwd на сервер: относительные
   * пути процесса не указывают в каталог backend'а, а серверы не делят файлы
   * друг с другом (v0.13 S1, KI-530). Имя сервера уже прошло регулярку
   * реестра (`^[a-z][a-z0-9_-]{0,23}$`), поэтому `..`/разделители путей в
   * него попасть не могут.
   *
   * @param serverName - имя сервера (ключ в `MCP_SERVERS`)
   * @returns абсолютный или относительный путь каталога (как задан в env)
   * @throws Error если каталог создать нельзя (нет прав, путь занят файлом)
   */
  private async prepareStdioCwdAsync(serverName: string): Promise<string> {
    const cwd = join(this.stdioCwd, serverName);

    await mkdir(cwd, { recursive: true });

    return cwd;
  }

  /**
   * Пишет `stderr` дочернего процесса в Pino (Nest `Logger`) с пометкой сервера.
   *
   * Строки режутся по `\n`; остаток длиннее {@link MCP_STDIO_STDERR_LINE_MAX}
   * сбрасывается принудительно — бесконечная строка без переводов не должна
   * съесть память. Уровень `debug`: см. комментарий к константе.
   *
   * @param transport - `stdio`-транспорт SDK
   * @param serverName - имя сервера для пометки в логе
   */
  private attachStderrLogging(
    transport: StdioClientTransport,
    serverName: string,
  ): void {
    const stderr = transport.stderr;

    if (stderr === null) {
      return;
    }

    let pending = '';

    const flushLine = (line: string): void => {
      const text = line.trimEnd();

      if (text.length === 0) {
        return;
      }

      const shown =
        text.length > MCP_STDIO_STDERR_LINE_MAX
          ? `${text.slice(0, MCP_STDIO_STDERR_LINE_MAX)}…`
          : text;

      this.logger.debug(`MCP-сервер '${serverName}' stderr: ${shown}`);
    };

    stderr.on('data', (chunk: Buffer | string): void => {
      pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8');

      let newline = pending.indexOf('\n');

      while (newline >= 0) {
        flushLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }

      if (pending.length > MCP_STDIO_STDERR_LINE_MAX) {
        flushLine(pending);
        pending = '';
      }
    });

    stderr.on('error', (error: Error): void => {
      this.logger.debug(
        `MCP-сервер '${serverName}' stderr: ошибка потока — ${error.message}`,
      );
    });

    stderr.on('end', (): void => {
      flushLine(pending);
      pending = '';
    });
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
    // Процесс завершился вместе с транспортом (или будет убит SDK при
    // `close()`), поэтому PID больше не наш: см. `markDisconnected`.
    state.stdioPid = null;
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
