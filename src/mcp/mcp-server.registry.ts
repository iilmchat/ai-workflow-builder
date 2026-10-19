/**
 * Реестр MCP-серверов: имя → конфигурация (v0.11 S6, DESIGN § 3.2.2).
 *
 * Реестр — единственный источник правды о том, какие MCP-серверы разрешены.
 * Узел `agent` хранит **имена** серверов и инструментов, а не URL: это
 * исключает SSRF «через граф» и утечку токена в JSON workflow (DESIGN § 2.3,
 * § 3.2.8). Реестр не ходит в сеть — подключением занимается
 * `McpClientService`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseMcpServersConfig,
  readBooleanConfig,
  type McpServerConfig,
  type McpServersConfig,
} from './mcp.config.js';
import { McpDisabledException, McpUnavailableException } from './mcp.errors.js';

/** Запись реестра: имя сервера и его валидированная конфигурация. */
export interface McpServerEntry {
  /** Имя сервера (ключ в `MCP_SERVERS`). */
  readonly name: string;
  /** Конфигурация сервера. */
  readonly config: McpServerConfig;
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
 * Реестр MCP-серверов из env `MCP_SERVERS`.
 *
 * Создаётся при старте приложения (через `McpModule`): битый JSON при
 * `MCP_ENABLED=true` роняет старт с понятным текстом (fail-fast, RULES 4.5),
 * а при `false` — предупреждение и пустой реестр: выключенная фича не должна
 * ломать приложение (DESIGN § 4.3).
 */
@Injectable()
export class McpServerRegistry {
  private readonly logger = new Logger(McpServerRegistry.name);

  /** Включён ли MCP-адаптер (`MCP_ENABLED`). */
  private readonly enabledFlag: boolean;

  /** Валидированные серверы в порядке объявления в JSON. */
  private readonly servers: ReadonlyMap<string, McpServerConfig>;

  /**
   * @param config - конфигурация приложения (RULES 4.6: env только через DI)
   * @throws Error если `MCP_ENABLED=true`, а `MCP_SERVERS` невалиден
   */
  constructor(config: ConfigService) {
    this.enabledFlag = readBooleanConfig(config.get<unknown>('MCP_ENABLED'));

    let parsed: McpServersConfig = {};

    try {
      parsed = parseMcpServersConfig(config.get<unknown>('MCP_SERVERS'));
    } catch (error: unknown) {
      const message = toMessage(error);

      if (this.enabledFlag) {
        throw new Error(`Некорректная конфигурация MCP: ${message}`);
      }

      this.logger.warn(
        `MCP-реестр проигнорирован, MCP_ENABLED=false: ${message}`,
      );
    }

    this.servers = new Map(Object.entries(parsed));

    if (this.enabledFlag) {
      this.logger.log(`MCP включён: серверов в реестре — ${this.servers.size}`);
    }
  }

  /**
   * Включён ли MCP-адаптер.
   *
   * @returns `true`, если `MCP_ENABLED=true`
   */
  isEnabled(): boolean {
    return this.enabledFlag;
  }

  /**
   * Проверяет, что MCP включён, иначе бросает понятную ошибку.
   *
   * @throws McpDisabledException если `MCP_ENABLED=false`
   */
  assertEnabled(): void {
    if (!this.enabledFlag) {
      throw new McpDisabledException();
    }
  }

  /**
   * Возвращает конфигурацию сервера по имени.
   *
   * @param name - имя сервера из узла (`data.mcpTools[].server`)
   * @returns конфигурация либо `undefined`, если сервер не описан в env
   */
  getServer(name: string): McpServerConfig | undefined {
    return this.servers.get(name);
  }

  /**
   * Возвращает конфигурацию сервера или бросает ошибку.
   *
   * @param name - имя сервера из узла
   * @returns конфигурация сервера
   * @throws McpUnavailableException если сервер не описан в `MCP_SERVERS`
   */
  getServerOrThrow(name: string): McpServerConfig {
    const config = this.servers.get(name);

    if (config === undefined) {
      throw new McpUnavailableException(
        name,
        'сервер не описан в реестре MCP_SERVERS (URL задаётся только оператором)',
      );
    }

    return config;
  }

  /**
   * Список всех серверов реестра.
   *
   * @returns записи «имя → конфигурация» в порядке объявления
   */
  listServers(): readonly McpServerEntry[] {
    return [...this.servers.entries()].map(([name, config]) => ({
      name,
      config,
    }));
  }
}
