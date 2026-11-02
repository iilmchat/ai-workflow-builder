## [0.12.0] — 2026-11-02

**Minor-релиз: PDF Generation, MCP stdio & SafeHttpClient Binary.**

### Added

- **PDF Generation (S1+S2, KI-463):** `PdfRenderer` на `pdfkit` + `NotoSans`. Узел `document_gen` теперь поддерживает формат `pdf` в inline-режиме (Markdown/JSON → PDF). Кириллица, списки, ссылки, заголовки. Fallback на Helvetica, если шрифт не найден.
- **MCP stdio (S4, KI-526):** `StdioClientTransport` для запуска локальных MCP-серверов (через `child_process.spawn`). Защита от orphan-процессов (`SIGTERM` → `SIGKILL`), denylist команд. Env `MCP_ENABLE_STDIO` (default `false`).
- **SafeHttpClient Binary (S3, KI-525):** Метод `fetchBufferAsync` для безопасного скачивания бинарных файлов (pinned DNS, лимит байт). Провайдер `OpenAI Images` переведен на него.

### Fixed

- **KI-528:** `SafeHttpClient.discardAsync` ронял процесс (`undici` 8) на редиректе из-за uncaught `RequestAbortedError`. Исправлено.

### Documented

- **KI-527:** PDF-таблицы выводятся плоским текстом (в отличие от DOCX).
- **KI-529..532:** Ограничения MCP stdio (env, изоляция) и UI.
