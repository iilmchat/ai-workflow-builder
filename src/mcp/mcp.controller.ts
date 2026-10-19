/**
 * HTTP-ручка каталога MCP-серверов (v0.11 S8, DESIGN § 3.2.6).
 *
 * Ручка нужна UI узла `agent`: пользователь выбирает MCP-инструменты
 * чекбоксами, а не редактирует JSON сценария. Ответ собирается из
 * существующего `McpClientService` (каталог уже кэширован с TTL), поэтому
 * отдельного сервиса нет — контроллер остаётся тонким: прочитать конфиг,
 * спросить клиент, отдать DTO.
 *
 * **Секреты не отдаются** (RULES 5.1, DESIGN § 3.2.6/§ 3.2.8): в ответе нет
 * ни URL, ни заголовков, ни `tokenEnv`. Текст ошибки тоже обобщён: причина
 * подключения может содержать host из `ECONNREFUSED 127.0.0.1:9999`, а это
 * фактически URL сервера. Детали остаются в WARN-логе процесса.
 */
import { Controller, Get, Logger, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import {
  McpServersResponseSchema,
  type McpServerSummary,
  type McpServersResponse,
  type McpToolSummary,
} from './dto/mcp-servers.dto.js';
import { McpClientService } from './mcp-client.service.js';
import { readIntegerConfig } from './mcp.config.js';
import {
  McpServerRegistry,
  type McpServerEntry,
} from './mcp-server.registry.js';
import {
  MCP_MAX_TOOLS_PER_NODE_LIMIT,
  type McpToolDescriptor,
} from './mcp.types.js';

/**
 * Безопасный текст ошибки сервера для API.
 *
 * Причина подключения не отдаётся наружу: в ней бывает host/порт сервера, а
 * DESIGN § 3.2.6 запрещает отдавать URL (RULES 5.1). Полный текст причины
 * пишется в WARN-лог контроллера.
 */
const MCP_SERVER_ERROR_TEXT = 'не удалось получить каталог инструментов';

/**
 * Приводит неизвестную ошибку к тексту (для server-side лога).
 *
 * @param error - значение из `catch` (тип `unknown`)
 * @returns текст ошибки
 */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Преобразует каталог клиента в DTO для UI.
 *
 * В ответ намеренно не попадает `inputSchema`: UI не собирает аргументы
 * вызова, а JSON Schema десятков инструментов раздула бы ответ (DESIGN § 3.2.6).
 * Опциональные поля копируются только при наличии значения, чтобы в JSON не
 * появлялись ключи со `undefined` (KI-129 — тот же принцип на фронтенде).
 *
 * @param tool - нормализованное описание инструмента из `McpClientService`
 * @returns краткое описание инструмента для UI
 */
function toToolSummary(tool: McpToolDescriptor): McpToolSummary {
  const annotations = tool.annotations;

  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.description === undefined
      ? {}
      : { description: tool.description }),
    ...(annotations?.readOnlyHint === undefined
      ? {}
      : { readOnlyHint: annotations.readOnlyHint }),
    ...(annotations?.destructiveHint === undefined
      ? {}
      : { destructiveHint: annotations.destructiveHint }),
    ...(annotations?.idempotentHint === undefined
      ? {}
      : { idempotentHint: annotations.idempotentHint }),
  };
}

/**
 * Каталог MCP-серверов для UI (`GET /mcp/servers`).
 *
 * Контроллер закрыт `JwtAuthGuard`: список серверов — операторская
 * конфигурация, и отдавать её анонимным запросам незачем (DESIGN § 3.2.6).
 */
@UseGuards(JwtAuthGuard)
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  /**
   * @param registry - реестр серверов из env (единственный источник имён)
   * @param client - MCP-клиент (кэш каталога, подключение по требованию)
   * @param config - конфигурация приложения (действующий лимит на узел)
   */
  constructor(
    private readonly registry: McpServerRegistry,
    private readonly client: McpClientService,
    private readonly config: ConfigService,
  ) {}

  /**
   * `GET /mcp/servers` — серверы реестра и их инструменты.
   *
   * `Promise.allSettled`: недоступность одного сервера не роняет ручку —
   * остальные серверы и их инструменты всё равно попадают в ответ, а у
   * недоступного выставляется `status: 'error'` (DESIGN § 3.2.6). Если
   * `MCP_ENABLED=false`, возвращается пустой список со статусом 200: это не
   * ошибка, а выключенная фича.
   *
   * @returns включённость фичи, лимит инструментов и серверы с инструментами
   */
  @Get('servers')
  async listServersAsync(): Promise<McpServersResponse> {
    const maxToolsPerNode = readIntegerConfig(
      this.config,
      'MCP_MAX_TOOLS_PER_NODE',
      MCP_MAX_TOOLS_PER_NODE_LIMIT,
      1,
      MCP_MAX_TOOLS_PER_NODE_LIMIT,
    );

    if (!this.registry.isEnabled()) {
      return McpServersResponseSchema.parse({
        enabled: false,
        maxToolsPerNode,
        servers: [],
      });
    }

    const entries = this.registry.listServers();
    const settled = await Promise.allSettled(
      entries.map((entry) => this.describeServerAsync(entry)),
    );

    const servers = settled.map((result, index): McpServerSummary => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      // Сюда попадает только непредвиденный throw: штатная ошибка подключения
      // обрабатывается внутри describeServerAsync. Текст причины — в лог,
      // наружу — обобщённое сообщение без host/порта.
      const entry = entries[index];

      this.logger.warn(
        `MCP-сервер '${entry.name}': каталог не получен — ${toMessage(result.reason)}`,
      );

      return {
        name: entry.name,
        transport: entry.config.transport,
        status: 'error',
        error: MCP_SERVER_ERROR_TEXT,
        tools: [],
      };
    });

    return McpServersResponseSchema.parse({
      enabled: true,
      maxToolsPerNode,
      servers,
    });
  }

  /**
   * Описывает один сервер реестра для ответа API.
   *
   * Выключенный сервер (`enabled=false`) не подключается: его статус —
   * `disabled`. Для включённого каталог берётся из `McpClientService` (кэш или
   * сеть); любая ошибка подключения превращается в `status: 'error'` без
   * деталей причины наружу.
   *
   * @param entry - запись реестра «имя → конфигурация»
   * @returns описание сервера для UI
   */
  private async describeServerAsync(
    entry: McpServerEntry,
  ): Promise<McpServerSummary> {
    const base = { name: entry.name, transport: entry.config.transport };

    if (!entry.config.enabled) {
      return { ...base, status: 'disabled', tools: [] };
    }

    try {
      const tools = await this.client.listToolsAsync(entry.name);

      return { ...base, status: 'ok', tools: tools.map(toToolSummary) };
    } catch (error: unknown) {
      this.logger.warn(
        `MCP-сервер '${entry.name}': подключение/каталог упали — ${toMessage(error)}`,
      );

      return {
        ...base,
        status: 'error',
        error: MCP_SERVER_ERROR_TEXT,
        tools: [],
      };
    }
  }
}
