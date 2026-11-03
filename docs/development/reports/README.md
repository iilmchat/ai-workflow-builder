# Отчёты сессий разработки

| Версия | Шаг | Тема | Дата | Файл |
|---|---|---|---|---|
| v1.0.0 | S5 | Team & Audit UI: `GET /admin/members` + `POST /admin/members/invite`, таблица `organization_invitations` (миграция 0016), «сжигание» приглашения при регистрации, действие `member.invite`, модалка `TeamPage` (вкладки «Участники»/«Аудит», keyset-аудит), кнопка «Команда» в TopBar, `UserPublic` с `organizationId`+`role` | 2026-11-03 | [S5-team-ui.md](v1.0.0/S5-team-ui.md) |
| v1.0.0 | S4 | Prometheus Metrics: `MetricsService` (собственный Registry, 4 метрики), глобальный `MetricsInterceptor`, `GET /metrics` без auth, метрики движка (узлы/стоимость) и агента (LLM-шаги) | 2026-11-03 | [S4-metrics.md](v1.0.0/S4-metrics.md) |
| v1.0.0 | S3 | Audit Logs: `audit_logs`, глобальный `AuditInterceptor` (POST/PATCH/DELETE), `AuditService`, `GET /admin/audit` (owner/admin, keyset), `users.role` | 2026-11-02 | [S3-audit.md](v1.0.0/S3-audit.md) |
| v1.0.0 | S2 | Workflow Isolation: `WorkflowAccess`/`toWorkflowAccess`, org-фильтр во всех выборках workflow/runs/document-templates/`sub_workflow`, кросс-организационные инвайты 404, публичный share без org-фильтра | 2026-11-02 | [S2-isolation.md](v1.0.0/S2-isolation.md) |
| v1.0.0 | S1 | Organizations DB & Auth: таблица `organizations`, `organization_id` в `users`/`workflows`, идемпотентный backfill, `orgId` в JWT, создание организации при регистрации | 2026-11-02 | [S1-orgs-db.md](v1.0.0/S1-orgs-db.md) |
| v0.16.0 | S1 | Tech Debt Sprint: keyset-пагинация истории (KI-542), F5 `?runId=` (KI-541), неймспейс `status.*` (KI-545), web-search контракт (KI-548), MCP allowlist WARN (KI-534) | 2026-11-02 | [S1-tech-debt.md](v0.16.0/S1-tech-debt.md) |
| v0.15.0 | S1 (S3 по DESIGN) | Web Search Expansion: провайдеры Bing и Brave, `searchDepth`/`freshness`, `GET /web-search/providers`, UI-селекты | 2026-11-02 | [S1-web-search.md](v0.15.0/S1-web-search.md) |
| v0.14.0 | S2 | Run History UI: `RunHistoryModal`, кнопка «История» в TopBar, `fetchWorkflowRunsAsync`, i18n | 2026-11-02 | [S2-history-ui.md](v0.14.0/S2-history-ui.md) |
| v0.14.0 | S1 | Run History API: `GET /workflow/:id/runs`, `RunSummary`, паритет-контракт backend/web | 2026-11-02 | [S1-history-api.md](v0.14.0/S1-history-api.md) |
| v0.13.0 | S1 | MCP Hardening & UI: stdio env allowlist, cwd-изоляция, `isPidAlive` EPERM, бейдж `LOCAL` | 2026-11-02 | [S1-mcp-hardening.md](v0.13.0/S1-mcp-hardening.md) |
| v0.12.0 | S1-S2 | PDF Generator: `PdfRenderer` (pdfkit + NotoSans), `document_gen` format, UI | 2026-11-02 | [S1-S2-pdf.md](v0.12.0/S1-S2-pdf.md) |
| v0.12.0 | S3-S4 | SafeHttpClient Binary (KI-525) + MCP stdio Transport (KI-526) | 2026-11-02 | [S3-S4-infra-mcp.md](v0.12.0/S3-S4-infra-mcp.md) |
| v0.11.1 | S1 | Hardening: KI-500 (SDK retries) + KI-418 (image_tool) | 2026-10-19 | [S1-hardening.md](v0.11.1/S1-hardening.md) |
| v0.11.1 | S2 | OpenAI Images: `applyToolAsync` через `/v1/images/edits` | 2026-10-19 | [S2-openai-images.md](v0.11.1/S2-openai-images.md) |
| v0.11.1 | S17 | Release Prep: версии 0.11.1, CHANGELOG, метрики, финальные гейты | 2026-10-19 | [S17-release.md](v0.11.1/S17-release.md) |
| v0.11.0 | S0-S1 | Foundation + миграции | 2026-10-19 | [S0-S1-foundation.md](v0.11.0/S0-S1-foundation.md) |
| v0.11.0 | S2-S3 | Document Template Core & API | 2026-10-19 | [S2-S3-document-templates.md](v0.11.0/S2-S3-document-templates.md) |
| v0.11.0 | S4-S5 | Document Templates Engine & UI | 2026-10-19 | [S4-S5-document-templates-engine.md](v0.11.0/S4-S5-document-templates-engine.md) |
| v0.11.0 | S6-S7 | MCP Adapter Core & Agent | 2026-10-19 | [S6-S7-mcp-adapter.md](v0.11.0/S6-S7-mcp-adapter.md) |
| v0.11.0 | S8 | MCP API & AgentNode UI | 2026-10-19 | [S8-mcp-ui.md](v0.11.0/S8-mcp-ui.md) |
| v0.11.0 | S9 | Run Lease / Heartbeat | 2026-10-19 | [S9-run-lease.md](v0.11.0/S9-run-lease.md) |
| v0.11.0 | S10-S11 | Retry & Agent Metrics | 2026-10-19 | [S10-S11-retry-metrics.md](v0.11.0/S10-S11-retry-metrics.md) |
| v0.11.0 | S12-S13 | History API & UI (F5 restore) | 2026-10-19 | [S12-S13-history.md](v0.11.0/S12-S13-history.md) |
| v0.11.0 | S14-S15 | Security & Infra: SafeHttpClient (SSRF) + Redis Throttler + Nest assets | 2026-10-19 | [S14-S15-security-infra.md](v0.11.0/S14-S15-security-infra.md) |
| v0.11.0 | S16 | Dark theme: токены статусов узлов, UI polish (KI-448) | 2026-10-19 | [S16-dark-theme.md](v0.11.0/S16-dark-theme.md) |
| v0.11.0 | S17 | Docs Sync (README, ARCHITECTURE, GETTING_STARTED, PROMPT v8.1, RELEASES) | 2026-10-19 | [S17-docs-sync.md](v0.11.0/S17-docs-sync.md) |
| v0.11.0 | S17 | Release Prep (версии 0.11.0, USER_GUIDE/QA, CHANGELOG, метрики, гейты) | 2026-10-19 | [S17-release.md](v0.11.0/S17-release.md) |