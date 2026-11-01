# DESIGN v0.12 — PDF Generation, MCP stdio & SafeHttpClient Binary

**Файл:** `docs/development/v0.12/DESIGN_V012_FEATURES.md`
**Версия:** 1.0 (2026-11-02)
**Дата:** 2026-11-02
**Статус:** Draft — ожидает ревью
**Закрывает (планируется):** KI-463, KI-525, KI-526
**Связанные:** KI-475, KI-520, KI-523
**RULES:** 2.5, 2.14, 2.15

---

## 1. Контекст

### 1.1 Точка старта
**Релиз:** `v0.11.1` (HEAD на 2026-11-02).
**Продукт:** визуальный конструктор AI-сценариев, **22 типа узлов**.
**Метрики:** backend — **1439** тестов, frontend — **419** тестов;
последний номер KI-реестра — **KI-525**.
**Стек:** NestJS 12, React 19, PostgreSQL 17 + pgvector, BullMQ + Redis,
S3/local media, QuickJS-WASM, OpenTelemetry.

### 1.2 Какие KI закрываем
| KI | Приоритет | Проблема | Что делаем в v0.12 |
|---|---|---|---|
| **KI-463** | 🟢 Low | `document_gen` не поддерживает PDF, только DOCX | `PdfRenderer` (`pdfkit` + NotoSans), режим `format='pdf'` |
| **KI-525** | 🟡 Medium | `OpenAI Images` скачивает входной файл без pinning IP (DNS rebinding) | Расширяем `SafeHttpClient` бинарным методом `fetchBufferAsync` |
| **KI-526** | 🟡 Medium | MCP поддерживает только HTTP/SSE (нет `stdio`) | Добавляем `StdioClientTransport` с защитой от orphan-процессов |

> KI-475 (3D/Motion) и KI-520 (MCP-ссылки вне каталога) остаются на v0.13+.

### 1.3 Что НЕ является целью
- HTML → PDF (Puppeteer/Playwright) — слишком тяжёлый рантайм для Node.js-бэкенда.
- DOCX → PDF (LibreOffice) — требует внешнего бинарника.
- MCP OAuth 2.1 и MCP Resources.
- PDF-шаблоны (пока только генерация из Markdown/JSON).

---

## 2. Ключевое архитектурное решение

Три независимых трека:

    ┌──────────────────────────────────────────────────────────┐
    │ A. PDF Renderer (src/documents/)                         │
    │    pdfkit + NotoSans → Buffer                             │
    ├──────────────────────────────────────────────────────────┤
    │ B. SafeHttpClient Binary (src/common/http/)              │
    │    undici + Buffer + pinned DNS                           │
    ├──────────────────────────────────────────────────────────┤
    │ C. MCP stdio (src/mcp/)                                  │
    │    child_process.spawn + kill on shutdown                 │
    └──────────────────────────────────────────────────────────┘

Треки не пересекаются по файлам, что позволяет делать их **параллельно**.

---

## 3. Технические срезы

### 3.1 Срез 1 — PDF Renderer (KI-463)

#### 3.1.1 Модель данных
Поле `format` в `DocumentGenerationNodeDataSchema` уже существует (`docx | pdf`).
Меняем `superRefine` в `node-executors.ts`: убираем запрет `format: 'pdf'`.

#### 3.1.2 Рендерер
Новый сервис `src/documents/pdf-renderer.service.ts`:
- Использует библиотеку `pdfkit` (лёгкая, MIT).
- Для поддержки кириллицы подключает шрифт `NotoSans-Regular.ttf` (лежит в `src/documents/assets/`).
- Методы:
  - `renderFromMarkdownAsync(markdown: string): Promise<Buffer>`
  - `renderFromJsonAsync(json: unknown): Promise<Buffer>`

**Структура PDF:**
- H1-H3 (жирный, размеры 24/18/14).
- Абзацы (NotoSans 12pt, interline 1.5).
- Списки (буллиты/цифры с отступом).
- Код (Courier, серый фон).
- Ссылки (синий текст).

#### 3.1.3 Интеграция
В `executeDocumentGenerationNodeAsync`:
- Если `format === 'docx'` — работает текущий `DocumentService`.
- Если `format === 'pdf'` — вызов `PdfRenderer`.
- Выходы узла: `mimeType: 'application/pdf'`, `fileUrl`, `storedUrl`.
- В `MediaStorage` сохраняется с расширением `.pdf`.

#### 3.1.4 UI
В `DocumentGenNode.tsx` добавить `<select>` для формата: `DOCX` / `PDF` (по умолчанию DOCX).
i18n: `node.document_gen.format.docx`, `node.document_gen.format.pdf`.

#### 3.1.5 Env
`DOCUMENT_PDF_MAX_BYTES` = 10485760 (10 МБ).

#### 3.1.6 Тесты
- Рендер простого Markdown (абзацы, кириллица).
- Рендер JSON (списки, ссылки).
- Отсутствие шрифта → fallback на встроенный Helvetica (с warning).
- Интеграция с `document_gen` (mode=`inline`, format=`pdf`).

### 3.2 Срез 2 — SafeHttpClient Binary (KI-525)

#### 3.2.1 Проблема
`OpenAI Images` использует `fetch` напрямую для скачивания входного файла. Это позволяет злоумышленнику подсунуть DNS, который меняет IP между проверкой и скачиванием.

#### 3.2.2 Решение
Добавить в `SafeHttpClient` метод `fetchBufferAsync(request: SafeHttpRequest): Promise<{ buffer: Buffer; contentType: string }>`.
- Использует тот же `undici.Agent` с `connect.lookup` (pinning IP).
- Возвращает `Buffer` (не `string`), чтобы не портить бинарные данные.
- Проверяет лимит байт (`maxResponseBytes`).
- Поддерживает `redirect: 'manual'`.

#### 3.2.3 Интеграция
В `openai-images.provider.ts` заменить прямой `fetch` на `SafeHttpClient.fetchBufferAsync`.

### 3.3 Срез 3 — MCP stdio Transport (KI-526)

#### 3.3.1 Env
`MCP_ENABLE_STDIO` = false (default, строгий boolean).
Если `true`, разрешаем в `MCP_SERVERS` конфиги без `url`, но с `command` и `args`.

#### 3.3.2 Клиент
В `src/mcp/mcp-client.service.ts`:
- При создании клиента проверяем `config.transport === 'stdio'`.
- Используем `StdioClientTransport` из `@modelcontextprotocol/sdk/client/stdio.js`.
- Запускаем `spawn` с `stdio: ['pipe', 'pipe', 'pipe']`.
- **Защита от orphan-процессов:** `onApplicationShutdown` убивает все процессы `SIGTERM`, затем `SIGKILL`.
- Логи `stderr` пишем в `pino` с пометкой сервера.

#### 3.3.3 Безопасность
- Запрещаем запуск `sh -c` / `cmd /c`. Используем только массив `args`.
- Проверяем, что `command` не `rm -rf` и не `mkfs` (простейший denylist).
- Рекомендуем оператору использовать `docker run` вместо `npx` для изоляции.

---

## 4. Совместимость и миграция
- Старые графы `document_gen` без `format` выполняются как DOCX.
- Старые MCP-конфиги (с `url`) продолжают работать, `stdio` не затрагивает их.
- `SafeHttpClient.fetchBufferAsync` — новый метод, старые вызовы `fetchAsync` не меняются.

---

## 5. План работ

| # | Подшаг | ~сессий | Зависит от | Выход |
|---|---|---:|---|---|
| S1 | PDF Renderer: сервис, шрифты, тесты | 1.5 | — | `renderFromMarkdownAsync`, `renderFromJsonAsync` |
| S2 | PDF Integration: node-executor, UI, storage | 1.0 | S1 | Генерация PDF из графа |
| S3 | SafeHttpClient Binary: метод, тесты | 1.0 | — | `fetchBufferAsync` с pinning |
| S4 | MCP stdio: конфиг, клиент, shutdown | 1.5 | — | Запуск локальных MCP-серверов |
| S5 | Интеграция, smoke, docs (CHANGELOG, KI, USER_GUIDE) | 1.0 | S2, S3, S4 | CI зелёный, релиз v0.12.0 |
| **Итого** | | **~6** | | |

**Порядок:**
1. S1 (PDF Core) и S3 (SafeHttpClient) и S4 (MCP stdio) — можно параллельно.
2. S2 (PDF UI) — после S1.
3. S5 (Docs/Release) — после всех.

---

## 6. Что НЕ входит в v0.12
- MCP OAuth, Resources, Prompts.
- 3D/Motion (KI-475).
- Web Search расширение (Bing/Google).
- История запусков (Browser).
- `SafeHttpClient` для потокового видео > 100 МБ.

---

## 7. Риски и открытые вопросы

| Риск | Вероятность | Митигация |
|---|---|---|
| `pdfkit` не поддерживает кириллицу без шрифта | Высокая | Подключить `NotoSans-Regular.ttf` (OFL) в репозиторий |
| `stdio` spawn процессов → RCE | Средняя | `MCP_ENABLE_STDIO=false` по умолчанию; denylist команд; документация для Docker |
| `SafeHttpClient` вернет Buffer, но сломает `truncateToBytes` | Низкая | Проверить, что `maxResponseBytes` отсекает поток при превышении |

**Открытые вопросы к ревью:**
1. Нужен ли `NotoSans` в репозитории или качать при старте? (Решение: в репозитории, `src/documents/assets/`).
2. Разрешать ли `MCP_ENABLE_STDIO` только в `NODE_ENV=development`? (Решение: нет, self-hosted prod тоже может).

---

## 8. Решения
*Ожидает ревью. Заполняется после утверждения.*