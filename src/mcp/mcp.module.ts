/**
 * Nest-модуль MCP-адаптера (v0.11 S6/S7/S8, DESIGN § 3.2.2).
 *
 * Модуль **не** `@Global()`: он импортируется в `RunsModule` (для
 * `AgentService`) и в `AppModule` (контроллер `GET /mcp/servers`).
 * Экспортирует клиент, реестр и адаптер; `McpServerRegistry` создаётся при
 * старте, поэтому битый `MCP_SERVERS` при `MCP_ENABLED=true` — fail-fast.
 *
 * `AuthModule` импортируется ради `JwtAuthGuard` контроллера каталога (v0.11
 * S8): guard инжектит `JwtService`/`ConfigService` из этого модуля.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { McpClientService } from './mcp-client.service.js';
import { McpController } from './mcp.controller.js';
import { McpServerRegistry } from './mcp-server.registry.js';
import { McpToolAdapter } from './mcp-tool.adapter.js';

/** MCP-адаптер: реестр серверов, клиент, адаптер инструментов и ручка каталога. */
@Module({
  imports: [AuthModule],
  controllers: [McpController],
  providers: [McpServerRegistry, McpClientService, McpToolAdapter],
  exports: [McpServerRegistry, McpClientService, McpToolAdapter],
})
export class McpModule {}
