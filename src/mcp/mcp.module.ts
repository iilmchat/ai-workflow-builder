/**
 * Nest-модуль MCP-адаптера (v0.11 S6/S7, DESIGN § 3.2.2).
 *
 * Модуль **не** `@Global()`: он импортируется в `RunsModule` (для
 * `AgentService`) и, начиная с S8, в `AppModule` (контроллер `GET /mcp/servers`).
 * Экспортирует клиент, реестр и адаптер; `McpServerRegistry` создаётся при
 * старте, поэтому битый `MCP_SERVERS` при `MCP_ENABLED=true` — fail-fast.
 */
import { Module } from '@nestjs/common';
import { McpClientService } from './mcp-client.service.js';
import { McpServerRegistry } from './mcp-server.registry.js';
import { McpToolAdapter } from './mcp-tool.adapter.js';

/** MCP-адаптер: реестр серверов, клиент и адаптер инструментов в `AgentTool`. */
@Module({
  providers: [McpServerRegistry, McpClientService, McpToolAdapter],
  exports: [McpServerRegistry, McpClientService, McpToolAdapter],
})
export class McpModule {}
