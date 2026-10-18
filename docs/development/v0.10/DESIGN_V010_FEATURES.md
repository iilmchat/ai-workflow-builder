# DESIGN v0.10 — Web Search, Document Generation, Safe Filesystem

**Файл:** `docs/development/v0.10/DESIGN_V010_FEATURES.md`
**Версия:** 1.0 (2026-10-19)
**Дата:** 2026-10-19
**Статус:** Released (v0.10.0)
**Закрывает (планируется):** KI-448, KI-449, KI-452, KI-453, KI-454, KI-455
**Связанные:** KI-104, KI-273, KI-415, KI-451, KI-008, KI-333
**RULES:** 2.5, 2.14

---

## 1. Контекст

### 1.1 Точка старта

**Релиз:** `v0.9.5` (HEAD на 2026-10-18).
**Продукт:** визуальный конструктор AI-сценариев, **18 типов узлов**.
**Метрики:** backend **1001** тест, frontend **339** тестов, KI-реестр —
последний номер **KI-451** (439 записей).
**Стек:** NestJS 12, React 19, PostgreSQL 17 + pgvector, BullMQ + Redis,
S3/local media, QuickJS-WASM, OpenTelemetry.

**Что уже умеет продукт:**

- полный цикл «нарисовал → сохранил → запустил → получил результат»;
- LLM (7 провайдеров), медиа (CreativeLab + Replicate/FAL/OpenAI Images),
  vector/memory (pgvector), Agent node (7 tools);
- Share (owner/editor/viewer), Auth, шаблоны, sub-workflows, бюджет;
- SSE-прогресс, S3-presigned, TTL, OTel.

**Чего не хватает для «рабочего ассистента»:**

| Пробел | Следствие | Приоритет |
|---|---|---|
| Нет доступа к внешним знаниям | LLM отвечает только по промпту/памяти; нет актуальных ссылок | 🟠 High |
| Нет генерации документов | Результат нельзя отдать заказчику в DOCX/PDF | 🟠 High |
| Нет безопасной работы с файлами | CSV/JSON нельзя прочитать из workspace и записать обратно | 🟠 High |
| UI-долг | Тёмная тема, «истекла» vs «не сохранён», удаление без подтверждения | 🟡 Medium |

### 1.2 Какие KI закрываем

| KI | Приоритет | Проблема | Что делаем в v0.10 |
|---|---|---|---|
| **KI-452** | 🟠 High | Удаление workflow без подтверждения | Confirm-диалог с именем и необратимостью |
| **KI-453** | 🟢 Low | Устаревший комментарий про `Ctrl+S` | Комментарий приводится к факту; добавляем `Ctrl+S` |
| **KI-454** | 🟡 Medium | Мёртвый `runPlanAsync`, бейдж уровня не работает | Планирование вызывается после load/структурных правок; бейдж заполняется |
| **KI-455** | 🟡 Medium | `PGVECTOR_ENABLED` есть в DESIGN, но не в env | Переменная в `EnvSchema`/`.env.example`, default `true` |
| **KI-448** | 🟡 Medium | Светлые фоны статусных узлов в тёмной теме | Токены темы `--color-status-*` для фона/рамки |
| **KI-449** | 🟡 Medium | UI не различает «истекла» и «не сохранён» | `reason` в `MediaSource` + разные плейсхолдеры |

> KI-452…455 на момент написания — **кандидаты**: в `KNOWN_ISSUES.md` их ещё
> нет. Регистрация — первый подшаг S0 (RULES § 2.4).

### 1.3 Новые фичи

| Фича | Типы узлов | Что делает |
|---|---|---|
| **Web Search** | `web_search` | Поиск в Tavily, топ-N результатов `{ title, url, snippet }`, текст для LLM |
| **Document Generation** | `document_generation` | Markdown/JSON → DOCX/PDF → файл в MediaStorage |
| **Safe Filesystem** | `read_file`, `write_file` | Чтение/запись TXT/CSV/JSON в `./data/workspace/{workflowId}/` |

> Три продуктовые фичи дают **четыре** новых типа узлов: `read_file` и
> `write_file` — одна фича, два узла. Итого узлов: **18 → 22**.

### 1.4 Продуктовые сценарии

1. **Исследование → отчёт:** `web_search` → `llm` (суммаризация) →
   `document_generation` (DOCX) → Share.
2. **Обработка данных:** `read_file` (CSV) → `llm`/`condition` → `write_file`
   (JSON) → `output`.
3. **Контент-пайплайн:** `web_search` → `agent` (проверка фактов) →
   `document_generation` (PDF) → Share.

### 1.5 Цели и критерии успеха

- 4 новых типа узлов работают в графе, исполняются в worker'е и видны в UI.
- Нет регрессий: старые 18 узлов и сохранённые workflow выполняются как раньше.
- Все новые внешние данные валидируются Zod; все новые пути — с таймаутами.
- Filesystem не позволяет выйти за `./data/workspace/{workflowId}/`
  (таблица атак в § 7.1).
- `pnpm test` и `pnpm --dir web test` зелёные; `pnpm build` — 0 warnings.
- Документация: USER_GUIDE, QA Manual, CHANGELOG, KNOWN_ISSUES, README
  обновлены по RULES § 2.16/§ 2.17.

### 1.6 Что НЕ является целью

- замена LLM на поисковик (web_search — источник контекста, не ответчик);
- произвольный доступ к файловой системе хоста;
- шаблоны DOCX от пользователя (`docxtemplater`) — v0.11;
- MCP, multi-tenant, 3D — см. § 6.

---

## 2. Ключевое архитектурное решение

### 2.1 Расширяем существующий конвейер, не создаём новый

Новые узлы — обычные **executor'ы** в `ExecutionEngineService.runNodeAsync`,
а не отдельный «движок». Это сохраняет:

- уровни Кана, `Promise.allSettled`, skip-semantics, retry, SSE, бюджет;
- единый контракт `node_runs` (inputs/outputs/logs/metrics);
- единый UI-реестр `NODE_REGISTRY` и порты `NODE_PORT_CONTRACT`.

Новые подсистемы:

| Подсистема | Модуль | Зависимости |
|---|---|---|
| Web Search | `src/web-search/` | `ConfigService`, HTTP, Zod |
| Documents | `src/documents/` | `docx`, `pdfkit`, `markdown-it`, MediaStorage |
| Workspace | `src/workspace/` | `node:fs/promises`, `node:path` |
| Node executors | `src/engine/node-executors*.ts` | существующий engine |

### 2.2 Провайдер поиска — интерфейс, а не жёсткий Tavily

`IWebSearchProvider` изолирует провайдера. В v0.10 реализация одна —
`TavilyWebSearchProvider`, но `WEB_SEARCH_PROVIDER` уже enum, чтобы позже
добавить Bing/Google/Brave без изменения узла и executor'а.

**Почему Tavily:**

| Критерий | Tavily | Bing Web Search | Google Custom Search |
|---|---|---|---|
| Сниппеты, готовые для LLM | ✅ | ✅ | ✅ |
| Один API-ключ | ✅ | ✅ | ❌ (key + cx) |
| Простая тарификация | ✅ | средняя | средняя |
| Русскоязычная выдача | приемлемо | хорошо | хорошо |

**Решение:** Tavily как первый провайдер; абстракция оставляет выбор.

### 2.3 Документы — `docx` + `pdfkit`, без LibreOffice в runtime

| Вариант | Плюсы | Минусы | Решение |
|---|---|---|---|
| **`docx`** | TypeScript, программная генерация, без шаблонов | layout кодом | ✅ DOCX |
| **`docxtemplater`** | бизнес-шаблоны | нужны .docx-шаблоны, лицензии модулей | v0.11 |
| **`pdfkit`** | без Chromium/LibreOffice, стриминг | ручной layout, нужен TTF для кириллицы | ✅ PDF |
| Puppeteer/HTML→PDF | богатый layout | Chromium в проде, память, безопасность | ❌ |
| LibreOffice headless | лучший DOCX→PDF | внешний бинарник, CI/прод-зависимость | ❌ |

**Почему не `docxtemplater` в v0.10:** пользовательских шаблонов ещё нет;
хранение и валидация бинарных шаблонов — отдельная фича (v0.11). Для
Markdown/JSON достаточно `docx`.

### 2.4 Общий признак retryable-ошибки

Сейчас `executeNodeRunAsync` повторяет только `LlmProviderException` с
`retryable=true` (KI-104). Новые узлы дают transient-ошибки (429/5xx/timeout)
и тоже должны повторяться.

**Решение:** ввести маркерный интерфейс:

```ts
export interface RetryableNodeError extends Error {
  readonly retryable: true;
}
```

`executeNodeRunAsync` проверяет:

```ts
const retryable =
  (error instanceof LlmProviderException && error.retryable) ||
  (isRetryableNodeError(error));
```

`WebSearchProviderException` и `DocumentRenderException` реализуют маркер для
429/5xx/timeout. Это **не** закрывает KI-104 целиком (media-ошибки), но
устраняет жёсткую привязку к LLM и задаёт путь для media.

### 2.5 Хранилище: `saveGeneratedAsync` + `storage_key`

`IMediaStorage` сейчас умеет только скачивать **URL** провайдера. Документы
создаются в памяти, поэтому добавляем метод:

```ts
export interface MediaGeneratedInput {
  runId: string;
  nodeId: string;
  data: Buffer;
  contentType: string;
  extension: string;
}

interface IMediaStorage {
  // ...существующие методы
  saveGeneratedAsync(input: MediaGeneratedInput): Promise<MediaStoredFile>;
}
```

- `LocalMediaStorage`: атомарная запись `./data/media/<runId>/<nodeId>.<ext>`.
- `S3MediaStorage`: `PutObjectCommand`/`Upload`, тот же ключ.
- `NoopMediaStorage`: бросает `DocumentStorageUnavailableException`
  (документ без хранилища отдать нечем).

**`node_runs.storage_key`** (nullable) добавляется миграцией:
сейчас ключ S3 восстанавливается из `stored_url` (KI-451), что ломается на
virtual-hosted/external URL. Для документов и media сохраняем ключ явно;
переподпись идёт по ключу, а не по парсингу URL.

### 2.6 Безопасность — отдельный слой, не «проверка в узле»

Filesystem-узлы не работают с путём напрямую. Только `WorkspaceService`:

- принимает `workflowId` (из `workflow_runs`) и относительный путь;
- канонизирует путь и проверяет, что он внутри workspace;
- отвергает symlink/junction, `..`, absolute, drive/UNC, reserved names;
- проверяет расширение и размер;
- пишет атомарно (temp + rename), сериализует записи по workflow.

Это позволяет покрыть security-тестами **один** сервис, а не каждый узел.

### 2.7 UI-полировка — токены темы и явные причины

- **KI-448:** статусные фоны/рамки — через `--color-status-*` в
  `@theme`/`.dark`, а не литералы `bg-blue-50`/`bg-green-50`/`bg-red-50`.
- **KI-449:** `MediaSource.reason: 'expired' | 'not-stored' | 'invalid' |
  null`; разные тексты и `data-media-reason`.
- **KI-452:** вложенный `alertdialog` с именем workflow; Cancel — дефолт,
  destructive-кнопка — явная.

### 2.8 Альтернативы и почему отвергнуты

| Вопрос | Рассмотрено | Выбор |
|---|---|---|
| Где хранить workspace | Local FS / S3 / БД | **Local FS** (просто, быстро; S3 — риск для v0.10) |
| Формат документа | DOCX / PDF / HTML | **DOCX + PDF**; HTML — нет |
| Парсер Markdown | `markdown-it` / `marked` / свой | **markdown-it** (`html:false`, предсказуемые токены) |
| CSV | ручной split / `csv-parse` | **`csv-parse` + `csv-stringify`** (RFC 4180) |
| Web Search | Tavily / Bing / Google / Brave | **Tavily** через интерфейс |
| PDF | pdfkit / LibreOffice / Puppeteer | **pdfkit** + TTF |

---

## 3. Технические срезы

### 3.1 Срез 1 — Web Search (`web_search`)

#### 3.1.1 Данные узла

```ts
const WebSearchNodeDataSchema = z.object({
  /** Запрос, если не пришёл по связи `inputs.prompt`. */
  query: z.string().trim().max(2_000).optional(),
  maxResults: z.number().int().min(1).max(10).default(5),
  searchDepth: z.enum(['basic', 'advanced']).default('basic'),
  includeAnswer: z.boolean().default(false),
  topic: z.enum(['general', 'news']).default('general'),
  /** Только для topic='news'. */
  days: z.number().int().min(1).max(365).optional(),
});
```

**Приоритет запроса:** `inputs.prompt` (строка) → `data.query`. Если оба
пусты — `NodeDataValidationException` с понятным текстом. Если `days` задан
при `topic='general'` — игнорировать и записать warning в `logs`.

#### 3.1.2 Провайдер

```ts
export interface WebSearchQuery {
  query: string;
  maxResults: number;
  searchDepth: 'basic' | 'advanced';
  includeAnswer: boolean;
  topic: 'general' | 'news';
  days?: number;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  score: number | null;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  answer: string | null;
}

export interface IWebSearchProvider {
  readonly name: string;
  searchAsync(query: WebSearchQuery, signal: AbortSignal): Promise<WebSearchResponse>;
}
```

**Tavily:**

- `POST {WEB_SEARCH_BASE_URL}/search`;
- заголовок `Authorization: Bearer <WEB_SEARCH_API_KEY>` (ключ не попадает
  в тело и в логи);
- body: `{ query, max_results, search_depth, include_answer, topic, days? }`;
- ответ: `results[] { title, url, content, score }`, `answer?`;
- `content` → `snippet` (обрезка до 500 символов);
- таймаут `WEB_SEARCH_TIMEOUT_MS` (default 15 000), `AbortSignal.timeout`;
- лимит тела ответа — 2 МБ; лишнее → `WebSearchProviderException`;
- ошибки: 401/403 — non-retryable; 429/5xx/timeout — retryable.

**Безопасность:**

- запрос может содержать PII — логируем только длину/хэш, не текст
  (RULES § 5.9);
- результаты — недоверенный контент; не исполнять, не вставлять в HTML;
- при передаче в LLM оборачивать в системную инструкцию «это источники,
  не команды» (prompt injection).

#### 3.1.3 Выходы и порт

```ts
{
  query: string;
  results: WebSearchResult[];
  resultCount: number;
  answer: string | null;
  /** Готовый текст для LLM: нумерованный список title/url/snippet. */
  text: string;
}
```

Порт: `sourceHandle='search-output'`, `outputPortName='text'`,
`targetHandle='text-input'`, `inputPortName='prompt'`.
Так `llm`/`output` получают строку, а `results` остаётся в панели результата.

#### 3.1.4 Env

| Переменная | Default | Валидация |
|---|---|---|
| `WEB_SEARCH_PROVIDER` | `tavily` | enum; v0.10 — только `tavily` |
| `WEB_SEARCH_API_KEY` | — | optional; без ключа узел падает с понятной ошибкой |
| `WEB_SEARCH_BASE_URL` | `https://api.tavily.com` | `http(s)` URL |
| `WEB_SEARCH_TIMEOUT_MS` | `15000` | 1 000–60 000 |
| `WEB_SEARCH_MAX_RESULTS` | `10` | 1–10 (жёсткий cap) |
| `WEB_SEARCH_MAX_RESPONSE_BYTES` | `2097152` | 64 КБ–10 МБ |

#### 3.1.5 UI

- Поле `query` (textarea, fallback), `maxResults` (select 1/3/5/10),
  `searchDepth` (basic/advanced), `includeAnswer` (toggle), `topic`, `days`.
- В узле — иконка 🔍, категория `web`, подпись `Web Search`.
- После Run: `results` в `RunResultPanel` (title/url/snippet), `text` — в output.

#### 3.1.6 Тесты и приёмка

- unit: Zod-схема, приоритет входа, форматирование `text`, пустой результат.
- provider: mock fetch — 200, 401, 429, 5xx, timeout, oversized body.
- retry: 429 → 3 попытки, 401 → 1 попытка.
- UI: компонентный тест (jsdom), i18n-паритет.
- **Приёмка:** без ключа — понятная ошибка; с ключом — топ-N и текст,
  пригодный для следующего LLM-узла.

---

### 3.2 Срез 2 — Document Generation (`document_generation`)

#### 3.2.1 Данные узла

```ts
const DocumentGenerationNodeDataSchema = z.object({
  format: z.enum(['docx', 'pdf']).default('docx'),
  source: z.enum(['markdown', 'json']).default('markdown'),
  title: z.string().trim().max(200).optional(),
  /** Markdown или JSON-строка; связь `inputs.prompt` важнее. */
  content: z.string().max(1_000_000).optional(),
  fileName: z.string().trim().max(120).optional(),
});
```

**Приоритет контента:** `inputs.prompt` (строка) → `data.content`.
Пустой контент — `NodeDataValidationException`.

#### 3.2.2 Конвейер

```text
Markdown/JSON
   │  parse (markdown-it / JSON.parse)
   ▼
DocumentModel { title, blocks[] }
   │  renderer
   ├── DocxRenderer  → Buffer (docx)
   └── PdfRenderer   → Buffer (pdfkit + TTF)
   │  MediaStorage.saveGeneratedAsync
   ▼
{ fileUrl, storedUrl, storedExpiresAt, fileName, bytes, mimeType }
```

```ts
type DocumentBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; text: string }
  | { type: 'pageBreak' };

interface DocumentModel {
  title: string;
  blocks: DocumentBlock[];
}
```

**Markdown:** `markdown-it` с `html:false`, `linkify:false`; поддержка
H1–H3, абзацев, списков, fenced code, bold/italic/inline-code/links.
Таблицы и изображения — **не в v0.10** (см. § 6).

**JSON:**

```json
{
  "title": "Отчёт по рынку",
  "sections": [
    { "heading": "Выводы", "body": "Текст…", "bullets": ["Пункт 1", "Пункт 2"] }
  ]
}
```

Zod-схема JSON-режима: `title` optional, `sections[]` с `heading`/`body`/
`bullets?`; неизвестные поля игнорируются.

#### 3.2.3 Рендереры

| Формат | Библиотека | Особенности |
|---|---|---|
| DOCX | `docx` | `Document`/`Paragraph`/`TextRun`/`HeadingLevel`, `Packer.toBuffer` |
| PDF | `pdfkit` | A4, поля 2 см, `NotoSans-Regular/Bold` для кириллицы, `Buffer` |

**PDF-шрифты.** `pdfkit` не имеет встроенной кириллицы. В репозиторий
добавляются `src/assets/fonts/NotoSans-Regular.ttf` и `NotoSans-Bold.ttf`;
`nest-cli.json` получает `assets: [{ include: "assets/**/*", outDir: "dist" }]`
(та же ловушка, что KI-292 с шаблонами). Если шрифт не найден — старт
приложения/рендер падает с понятной ошибкой, а не молча рисует «квадраты».

**Ограничения рендера:**

- контент ≤ 1 000 000 символов (Zod) и ≤ `DOCUMENT_MAX_CONTENT_BYTES`
  (1 МБ) в UTF-8; блоков ≤ 500; итоговый файл ≤ 10 МБ;
- одна колонка, без колонтитулов и оглавления;
- ссылки — текстом (PDF) / гиперссылкой (DOCX);
- code — монопространственный шрифт, без подсветки синтаксиса.

#### 3.2.4 Хранилище

`MediaStorage.saveGeneratedAsync` (см. § 2.5):

- local: `<runId>/<nodeId>.<ext>`, атомарная запись;
- S3: `<runId>/<nodeId>.<ext>`, `PutObject`/`Upload`, presigned URL;
- MIME: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
  для DOCX, `application/pdf` для PDF;
- `MediaStoredFile.storageKey` пишется в `node_runs.storage_key` (новая
  колонка) и используется для переподписи.

**Если `MEDIA_STORAGE_BACKEND=none`** — узел падает с
`DocumentStorageUnavailableException`: без хранилища отдать файл нечем.

#### 3.2.5 Выходы и порт

```ts
{
  fileUrl: string;        // = storedUrl (local или presigned)
  storedUrl: string;
  storedExpiresAt: string | null;
  fileName: string;
  mimeType: string;
  bytes: number;
  format: 'docx' | 'pdf';
}
```

Порт: `sourceHandle='document-output'`, `outputPortName='fileUrl'`,
`targetHandle='text-input'`, `inputPortName='prompt'`.
`output`-узел принимает `fileUrl` как строку; downstream может использовать
`http`/`output`.

#### 3.2.6 UI

- Select формата (DOCX/PDF), select источника (Markdown/JSON), `title`,
  textarea `content`, `fileName`.
- В узле — иконка 📄, категория `documents`.
- После Run — ссылка «Открыть/Скачать» в `RunResultPanel` и в узле.
- Валидация: JSON-режим — `JSON.parse` на клиенте до Run (понятная ошибка).

#### 3.2.7 Тесты и приёмка

- unit: Markdown → blocks (H1–H3, списки, code, inline), JSON → blocks.
- renderer: DOCX открывается (`Packer.toBuffer` → unzip →
  `[Content_Types].xml`), PDF начинается с `%PDF-`, кириллица не «квадраты»
  (визуальный smoke).
- storage: local/S3 mock, presigned refresh, `storage_key`.
- limits: >1 МБ, >500 блоков, >10 МБ — понятные ошибки.
- **Приёмка:** Markdown → DOCX и PDF; файл доступен по ссылке; после
  истечения presigned URL переподписывается.

---

### 3.3 Срез 3 — Safe Filesystem (`read_file` / `write_file`)

#### 3.3.1 Workspace

```text
./data/workspace/
└── {workflowId}/
    ├── input.csv
    ├── report.json
    └── notes/2026-10-18.txt
```

- корень — `WORKSPACE_ROOT` (default `./data/workspace`);
- `workflowId` берётся из `workflow_runs.workflow_id`, **не** из `data` узла;
- файлы переживают перезапуск backend'а (вне `dist/`);
- **local only**: S3-workspace не в v0.10; multi-instance требует общего
  volume (см. § 7.1).

#### 3.3.2 Данные узлов

```ts
const ReadFileNodeDataSchema = z.object({
  path: z.string().trim().min(1).max(255),
  format: z.enum(['auto', 'txt', 'csv', 'json']).default('auto'),
});

const WriteFileNodeDataSchema = z.object({
  path: z.string().trim().min(1).max(255),
  format: z.enum(['txt', 'csv', 'json']).default('txt'),
  overwrite: z.boolean().default(false),
  /** Контент, если не пришёл по связи `inputs.prompt`. */
  content: z.string().max(1_000_000).optional(),
});
```

**Приоритет:**

- `read_file`: **путь только из `data.path`**. Узел — source-only
  (`canBeInsertedOnEdge:false`), `inputs.prompt` не используется: LLM не должен
  управлять путём чтения, иначе prompt injection сможет вычитать чужие файлы
  внутри workspace.
- `write_file`: контент — `inputs.prompt` (строка) → `data.content`; **путь
  только из `data.path`** (не из входа — нельзя дать LLM управлять путём).

#### 3.3.3 Path traversal: алгоритм

`WorkspaceService.resolveAsync(workflowId, relativePath)`:

1. Проверить тип/длину/`\0`/control chars; пустой путь — ошибка.
2. Заменить `\` на `/`; reject absolute (`/`, `\`, `C:`, `//server/share`).
3. Разобрать на сегменты; reject `.`/`..`/пустые; reject Windows-reserved
   (`CON`, `PRN`, `AUX`, `NUL`, `COM1…9`, `LPT1…9`), trailing dot/space.
4. `path.posix.normalize`; повторно проверить отсутствие `..`.
5. `resolve(root, workflowId, relativePath)`.
6. Проверить `target === workflowRoot || target.startsWith(workflowRoot + sep)`.
7. `realpath(workflowRoot)` (создать при первом write). Для write отсутствующие
   каталоги создаются **по одному сегменту**, после каждого шага
   `realpath` нового каталога проверяется на принадлежность root; для read
   `realpath(parent)` должен быть внутри root.
8. Если target существует — `lstat`; symlink/junction → ошибка.
9. Для write — открыть temp в проверенном parent, записать, `rename`; проверка
   `overwrite` и `rename` выполняются в одной критической секции per-workflow
   mutex'а. `overwrite=false` — отказ, если target уже существует.
10. Для read — `open` с `O_NOFOLLOW` (где доступно), `fstat` — regular file,
    лимит размера, чтение UTF-8.

**Дополнительно:**

- расширения: `.txt`, `.csv`, `.json` (case-insensitive), иначе ошибка;
- `format='auto'` — по расширению, иначе `txt`;
- лимит файла: `WORKSPACE_MAX_FILE_BYTES` (default 1 МБ);
- лимит workspace: `WORKSPACE_MAX_TOTAL_BYTES` (default 50 МБ),
  `WORKSPACE_MAX_FILES` (default 1 000) — проверка рекурсивным обходом;
- запись — только через temp + `rename`; `overwrite=false` по умолчанию;
- сериализация записей в рамках workflow (in-process mutex);
- никакого `child_process`, shell, `eval`.

#### 3.3.4 Форматы

| Формат | read_file | write_file |
|---|---|---|
| TXT | `text` (UTF-8, BOM срезается) | строка как есть |
| JSON | `text` + `json` (parse; ошибка при invalid) | `JSON.stringify` с 2 пробелами; invalid — ошибка |
| CSV | `text` + `rows` (`csv-parse`, RFC 4180) | `csv-stringify`; защита от formula injection (`=`, `+`, `-`, `@` → префикс `'`) |

**Выходы:**

```ts
// read_file
{ text, path, bytes, format, json?: unknown, rows?: string[][] }
// write_file
{ path, bytes, format }
```

Порты:

- `read_file`: `sourceHandle='file-output'`, `outputPortName='text'`;
  source-only, `canBeInsertedOnEdge:false`;
- `write_file`: `sourceHandle='file-output'`, `outputPortName='result'`,
  `targetHandle='text-input'`, `inputPortName='prompt'`.

#### 3.3.5 Env

| Переменная | Default | Валидация |
|---|---|---|
| `WORKSPACE_ROOT` | `./data/workspace` | непустой путь |
| `WORKSPACE_MAX_FILE_BYTES` | `1048576` | 1 КБ–10 МБ |
| `WORKSPACE_MAX_TOTAL_BYTES` | `52428800` | 1 МБ–1 ГБ |
| `WORKSPACE_MAX_FILES` | `1000` | 1–10 000 |

#### 3.3.6 UI и тесты

- `read_file` — путь, формат; `write_file` — путь, формат, overwrite.
- Иконки 📂/📥, категория `files`.
- Security-тесты (табличные):
  `../`, `..\\`, `%2e%2e`, absolute, drive, UNC, NUL, reserved, symlink,
  oversized, invalid UTF-8, invalid JSON, CSV mismatch.
- **Приёмка:** чтение CSV/JSON/TXT, запись с overwrite=false, попытка
  выйти из workspace — 100% отказ.

---

### 3.4 Срез 4 — UI Polish (KI-448, KI-449, KI-452)

#### 3.4.1 KI-448 — статусные фоны в тёмной теме

`BaseNode.tsx` использует литералы `bg-blue-50`, `bg-green-50`, `bg-red-50`;
в тёмной теме это светлые пятна. Решение — токены:

```css
/* web/src/styles/theme.css */
@theme {
  --color-status-running-bg: theme(colors.blue.50);
  --color-status-running-border: theme(colors.blue.500);
  --color-status-completed-bg: theme(colors.green.50);
  --color-status-completed-border: theme(colors.green.500);
  --color-status-failed-bg: theme(colors.red.50);
  --color-status-failed-border: theme(colors.red.500);
}

.dark {
  --color-status-running-bg: theme(colors.blue.950);
  --color-status-running-border: theme(colors.blue.400);
  --color-status-completed-bg: theme(colors.green.950);
  --color-status-completed-border: theme(colors.green.400);
  --color-status-failed-bg: theme(colors.red.950);
  --color-status-failed-border: theme(colors.red.400);
}
```

`STATUS_BACKGROUND`/`STATUS_BORDER` маппятся на `bg-status-*-bg` и
`border-status-*-border`; `skipped` — `bg-muted/30` + `border-dashed`.
Текст остаётся `text-foreground`; контраст проверяется smoke-скриншотами
в двух темах. RULES § 4.32: не использовать `color-mix()` с `var()` в
правилах — только готовые токены.

#### 3.4.2 KI-449 — «истекла» vs «не сохранён»

`MediaSource` получает `reason`:

```ts
export type MediaUnavailableReason = 'expired' | 'not-stored' | 'invalid';

export interface MediaSource {
  src: string | null;
  expired: boolean;      // совместимость
  invalid: boolean;      // совместимость
  reason: MediaUnavailableReason | null;
}
```

Правила:

| Ситуация | `reason` | Текст |
|---|---|---|
| `storedUrl` есть, TTL прошёл | `expired` | «Срок хранения истёк — запустите сценарий заново» |
| `storedUrl` нет, результат провайдера есть | `not-stored` | «Результат не сохранён в хранилище — ссылка провайдера может истечь» |
| URL небезопасен | `invalid` | «Некорректная ссылка на файл» |
| результата нет | `null` | плейсхолдера нет |

`ExpiredMediaPlaceholder` → `MediaPlaceholder` с `reason`, `data-media-reason`,
разными иконками/цветами; обновить 5 media-узлов и `media-source.spec.ts`.
i18n — оба файла.

#### 3.4.3 KI-452 — подтверждение удаления

В `LoadModal`:

- состояние `pendingDelete: { id, name } | null`;
- клик «Удалить» только открывает `alertdialog` (не вызывает API);
- диалог: заголовок, имя workflow, предупреждение «Удалятся история запусков
  и результаты. Действие необратимо», кнопки «Отмена» (autofocus) и
  «Удалить» (danger);
- подтверждение вызывает существующий `handleDelete`;
- `Escape`/клик по фону — отмена; во время запроса кнопки disabled;
- `data-delete-confirm` / `data-delete-workflow` для smoke;
- i18n: `loadModal.delete.confirm.title/body/warning`, `common.cancel/delete`.

Тесты (Testing Library): клик не вызывает API; подтверждение вызывает;
отмена — нет; ошибка API оставляет диалог и показывает текст.
**QA:** обновить `MANUAL_TESTING_GUIDE.md`, кейс CANVAS-18 — сейчас он
фиксирует удаление без подтверждения как ожидаемое поведение v0.9.1.

---

### 3.5 Срез 5 — техдолг KI-453, KI-454, KI-455

#### 3.5.1 KI-453 — `Ctrl+S`

Комментарий в `saveWorkflowAsync` утверждает, что `Ctrl+S` живёт в `Canvas`,
но биндинга нет. Решение:

- добавить в карту `useHotkeys` Canvas:
  `'ctrl+s': { preventDefault: true, handler: () => void saveWorkflowAsync() }`;
- `saveWorkflowAsync` уже содержит guard для `viewer` — поведение корректно;
- обновить комментарий: Save вызывается из TopBar, auto-save и `Ctrl+S`;
- тест: `hotkeys-utils` уже покрывает разбор; добавить проверку, что
  `Ctrl+S` не срабатывает как одиночный `S` (есть), и smoke сохранения.
- Это закрывает KI-453 и часть KI-273 (`Ctrl+S`).

#### 3.5.2 KI-454 — уровни и бейдж

`runPlanAsync` не вызывается; `executionLevels` пуст; бейдж `BaseNode` не
появляется. Решение:

- переименовать в `refreshExecutionPlanAsync(options?: { silent?: boolean })`;
- `silent: true` — не трогать `isLoading`/`notice`, только `executionLevels`;
  ошибка планирования — `console.warn` + очистка уровней;
- вызывать после `loadWorkflowAsync` и после **структурных** изменений графа
  (id узлов + рёбра), debounce 500 мс; не на каждое изменение текста;
- в `Canvas` — `useDebouncedEffect` по `structureKey`;
- Run не ждёт план: `/engine/plan` — вспомогательный запрос;
- тест: silent-режим не показывает toast; уровни заполняются; бейдж виден.

#### 3.5.3 KI-455 — `PGVECTOR_ENABLED`

Добавить в `MediaStorageEnvSchema`-подобную секцию `VectorEnvSchema` или в
`EnvSchema`:

```ts
PGVECTOR_ENABLED: z.preprocess(
  emptyToUndefined,
  z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
).default(true),
```

- default **true** — сохраняет текущее поведение (vector уже работает);
- `.env.example` — `PGVECTOR_ENABLED=true` с комментарием;
- при `false`: `vector_*`/`memory_*` узлы падают с
  `NodeDataValidationException`/`VectorDisabledException` с понятным текстом;
  agent-инструменты `vector_*`/`memory_*` возвращают «disabled»;
- DESIGN v0.9 § 4.3 (где было `false`) помечается как устаревший в CHANGELOG;
- тесты: env-схема, default, disabled-путь.

---

## 4. Совместимость и миграция

### 4.1 Старые workflow

- `NodeSchema.type` — свободная строка; старые графы не ломаются.
- Новые `data`-схемы валидируются **внутри** исполнителя; `NodeDto.data`
  остаётся `Record<string, unknown>` (forward-compat, RULES 1.17).
- `nodeDataFromApi`/`toApiNode` расширяются новыми ветками; неизвестные поля
  сохраняются.
- Старые 18 узлов не меняют контракты; `text`/`llm`/media не затрагиваются.

### 4.2 База данных

| Миграция | Что | Обратимость |
|---|---|---|
| `0011_node_runs_storage_key.sql` | `node_runs.storage_key text NULL` | `DROP COLUMN` (данные не теряются) |

- Backfill не обязателен: старые media-строки продолжат работать через
  парсинг URL; новые — по `storage_key`.
- Индекс не нужен (точечное чтение по `node_id`/`run_id`).
- `workflow_files` **не добавляем** в v0.10: квоты считаются обходом
  workspace; таблица — при появлении списка файлов (v0.11).

### 4.3 Env

Добавить в `.env.example`:

```dotenv
# Web Search (v0.10)
WEB_SEARCH_PROVIDER=tavily
WEB_SEARCH_API_KEY=
WEB_SEARCH_BASE_URL=https://api.tavily.com
WEB_SEARCH_TIMEOUT_MS=15000
WEB_SEARCH_MAX_RESULTS=10
WEB_SEARCH_MAX_RESPONSE_BYTES=2097152

# Documents (v0.10)
DOCUMENT_MAX_CONTENT_BYTES=1048576
DOCUMENT_MAX_BLOCKS=500
DOCUMENT_MAX_OUTPUT_BYTES=10485760

# Workspace (v0.10)
WORKSPACE_ROOT=./data/workspace
WORKSPACE_MAX_FILE_BYTES=1048576
WORKSPACE_MAX_TOTAL_BYTES=52428800
WORKSPACE_MAX_FILES=1000

# Vector (KI-455)
PGVECTOR_ENABLED=true
```

- `WEB_SEARCH_API_KEY` без значения — узел доступен, но Run падает с
  понятной ошибкой конфигурации.
- `PGVECTOR_ENABLED` default `true` (backward compat).
- Все новые переменные — в `EnvSchema` (Zod), fail-fast при старте.

### 4.4 Зависимости

| Пакет | Где | Зачем |
|---|---|---|
| `docx` | backend | DOCX |
| `pdfkit` | backend | PDF |
| `markdown-it` | backend | Markdown → tokens |
| `csv-parse` | backend | CSV read |
| `csv-stringify` | backend | CSV write |
| `@types/pdfkit`, `@types/markdown-it` | dev | типы |

Frontend новых зависимостей не получает (кроме i18n-ключей).

### 4.5 API/SSE-контракты

- Новых HTTP-ручек нет: всё через `node_runs.outputs` и существующие
  `POST /runs`, `GET /runs/:id/stream`.
- `sse-contract.json` не меняется: события те же.
- `api-contract.json` не меняется: новые outputs — JSONB, не DTO.
- `docs/KNOWN_ISSUES.md` — зарегистрировать KI-452…455 и закрыть
  KI-448/449/452/453/454/455 по факту.

### 4.6 Node registry / i18n

- `NodeType` +4: `web_search`, `document_generation`, `read_file`, `write_file`.
- `NODE_CATEGORIES` +3: `web`, `documents`, `files`.
- `NODE_REGISTRY` +4 lazy-компонента, `NODE_PORT_CONTRACT` +4.
- `en.json`/`ru.json` — все новые ключи в обоих файлах (RULES 1.14).
- `node-registry.spec.ts` — 22 типа; i18n-паритет.

### 4.7 Rollback

- Откат релиза — redeploy предыдущего тега; новые узлы в старых workflow
  останутся `data`, но старый frontend их не отрисует (unknown type).
- `PGVECTOR_ENABLED=false` — аварийное отключение vector-узлов без отката.
- `WEB_SEARCH_PROVIDER`/`DOCUMENT_*`/`WORKSPACE_*` — env-only, без миграций.
- `storage_key` nullable — старый код её игнорирует.

---

## 5. План работ

**Единица оценки:** 1 сессия dsh = 1 пакет (2–3 задачи, один CI-прогон,
один docs-коммит). Оценки — с запасом на тесты и ревью.

| # | Подшаг | ~сессий | Зависит от | Выход / критерий |
|---|---|---:|---|---|
| **S0** | Foundation: 4 NodeType, категории, порты, i18n, `RetryableNodeError`, регистрация KI-452…455 | 1.0 | — | registry/ports/i18n тесты; KI в реестре |
| **S1** | Web Search provider + `WebSearchModule` + env + тесты | 1.0 | S0 | mock-тесты 200/401/429/5xx/timeout |
| **S2** | `web_search` executor + UI + порт + тесты | 1.0 | S1 | узел работает end-to-end |
| **S3** | Document model + Markdown/JSON parse + DOCX | 2.0 | S0 | unit + DOCX round-trip |
| **S4** | PDF renderer + TTF + `nest-cli` assets | 1.5 | S3 | PDF с кириллицей |
| **S5** | `saveGeneratedAsync` + `storage_key` миграция | 1.5 | S0 | local/S3 mock, миграция |
| **S6** | `document_generation` executor + UI + outputs | 1.0 | S3, S4, S5 | DOCX/PDF через Run |
| **S7** | `WorkspaceService` + path security + тесты | 2.0 | S0 | таблица атак 100% |
| **S8** | `read_file` / `write_file` executors + UI | 1.5 | S7 | TXT/CSV/JSON, overwrite |
| **S9** | UI polish: KI-448/449/452 | 1.5 | S0 | component-тесты, smoke 2 темы |
| **S10** | Техдолг: KI-453/454/455 | 1.0 | S0 | Ctrl+S, уровни, env |
| **S11** | Интеграция, smoke, docs, релизные гейты | 2.0 | все | CI, USER_GUIDE, QA, CHANGELOG |
| **Итого** | | **~16** | | |

**Порядок и параллельность:**

1. **S0** — один последовательный шаг (иначе конфликты в `graph.ts`,
   `node-registry.ts`, `node-ports.ts`).
2. После S0 — три параллельных трека:
   - **A:** S1 → S2 (web search);
   - **B:** S3 → S4 → S6 (documents, S5 можно параллельно);
   - **C:** S7 → S8 (filesystem).
3. **S9/S10** — параллельно с A/B/C после S0 (не пересекаются по файлам,
   кроме `LoadModal`/`BaseNode`).
4. **S11** — после всех; freeze фич, только фиксы.

**Прогноз:** 14–18 сессий dsh; при 3 сессиях в неделю — **5–6 недель**,
при 4 — **4–5 недель**. Критический путь: S0 → S3 → S4 → S6 → S11.

**Риск-буфер:** S7 (filesystem security) может вырасти до 3 сессий; S4 (PDF
кириллица) — до 2. При нехватке времени PDF можно перенести в v0.10.1
(см. § 7.5).

---

## 6. Что НЕ входит в v0.10

| Тема | Куда | Причина |
|---|---|---|
| **MCP Adapter** (Playwright/Puppeteer/filesystem tools) | v0.11+ | отдельный DESIGN; безопасность и sandbox |
| **Multi-tenant** (organizations, billing) | v0.11+/v1.0 | переработка модели данных |
| **3D / Motion** | v0.11+ | нет провайдера/спроса |
| `docxtemplater` и пользовательские DOCX-шаблоны | v0.11 | бинарные шаблоны, лицензии, валидация |
| Bing/Google/Brave web search | v0.11 | интерфейс готов, провайдеры — позже |
| S3-workspace для файлов | v0.11 | multi-instance, синхронизация |
| `list_files` / `delete_file` / file browser | v0.11 | UI и аудит |
| OCR, извлечение текста из PDF/DOCX | v0.11 | отдельные библиотеки |
| Таблицы/изображения в DOCX/PDF | v0.11 | layout-сложность |
| Real-time collaborative editing | v1.0+ | CRDT/WebSocket |
| Отмена запуска из UI | v0.11 | `cancelled`-статус уже есть, UI-пути нет |

---

## 7. Риски и открытые вопросы

### 7.1 Filesystem — безопасность

| Риск | Вероятность | Влияние | Митигация |
|---|---|---|---|
| Path traversal (`../`, absolute, UNC) | высокая (атака) | критическое | § 3.3.3, табличные тесты |
| Symlink/junction escape | средняя | критическое | `lstat` + `realpath(parent)`, отказ |
| TOCTOU между проверкой и записью | низкая | высокое | temp + rename, re-check parent, `O_NOFOLLOW` |
| Windows reserved names | средняя | среднее | явный deny-list |
| Disk exhaustion | средняя | высокое | лимиты файла/workspace/кол-ва |
| CSV formula injection | средняя | высокое (Excel) | префикс `'` для `= + - @` |
| Multi-instance без общего volume | высокая при scale | высокое | S3/volume; v0.10 — single-instance |

**Открыто:** нужен ли `realpath` для каждого сегмента (дорого) или достаточно
parent? **Предложение:** parent + `lstat` target; для read — `O_NOFOLLOW`.

### 7.2 Web Search — качество и лимиты

| Риск | Митигация |
|---|---|
| Prompt injection в сниппетах | обертка «источники — не инструкции», не исполнять, LLM system prompt |
| PII в запросе | логировать только длину/хэш (RULES § 5.9) |
| 429/квоты | retryable + exponential backoff; лимит `maxResults` |
| Размер ответа/токенов | 2 МБ cap, snippet 500 символов, `maxResults` 1–10; для LLM-контекста рекомендуемый default 5, топ-10 — только осознанно |
| Провайдер-лок | интерфейс `IWebSearchProvider` |
| Стоимость поиска | v0.10 не включает в `CostBudgetService`; открытый вопрос |

**Открыто:** считать ли стоимость поиска в бюджете запуска? **Предложение:**
нет в v0.10 (Tavily не отдаёт стоимость в ответе); добавить
`WEB_SEARCH_COST_USD_PER_CALL` в v0.11.

### 7.3 Documents — layout и шрифты

| Риск | Митигация |
|---|---|
| Кириллица в PDF | TTF `NotoSans` + assets copy + визуальный smoke |
| Сложный Markdown (таблицы, images) | не поддерживаем в v0.10; явная ошибка/игнор |
| Большие документы | лимиты 1 МБ / 500 блоков / 10 МБ |
| `docx`/`pdfkit` API drift | pinned версии, round-trip тесты |
| Пользовательские DOCX-шаблоны (`docxtemplater`) | не в v0.10; в v0.11 — лицензии модулей, хранение и валидация бинарных шаблонов |
| PDF memory | стриминг `pdfkit` в Buffer; лимит |
| DOCX-макросы | генерируем с нуля, без шаблонов — макросов нет |

**Открыто:** нужен ли PDF в v0.10 или достаточно DOCX? **Предложение:** PDF
в P1, но при риске — v0.10.1 (см. § 5).

### 7.4 Storage — presigned и миграция

| Риск | Митигация |
|---|---|
| `storage_key` null у старых строк | fallback на парсинг URL (текущее поведение) |
| S3 virtual-hosted style | новый код пишет `storage_key`; старые — ограничение |
| `MEDIA_STORAGE_BACKEND=none` | документ падает с понятной ошибкой |
| TTL/cleanup | документы подчиняются `MEDIA_STORAGE_LOCAL_TTL_DAYS`/`S3_TTL_DAYS` |
| Публичный `/media/file` (KI-415) | не расширяем; signed URL — отдельно |

**Открыто:** делать ли backfill `storage_key` из URL? **Предложение:** нет;
nullable + fallback, backfill — при следующей ревизии.

### 7.5 Scope / расписание

| Риск | Митигация |
|---|---|
| 16 сессий — большой релиз | S0 фиксирует контракты; PDF можно вынести |
| 4 узла + UI + security | параллельные треки A/B/C |
| Bundle size | новые узлы lazy; PDF/DOCX только backend |
| i18n-долг | ключи в обоих файлах + тест паритета |

### 7.6 UI

| Риск | Митигация |
|---|---|
| Тёмная тема: контраст | токены + smoke в двух темах |
| `alertdialog` и focus | autofocus Cancel, Escape, `aria-modal` |
| 5 media-узлов обновить | общий `MediaPlaceholder` + spec |
| `Ctrl+S` конфликт с браузером | `preventDefault` + viewer guard |

### 7.7 Открытые вопросы к ревью

| # | Вопрос | Варианты | Нужно до |
|---|---|---|---|
| 1 | PDF в v0.10 или v0.10.1? | P1 / P2 | S3 |
| 2 | Tavily или Bing как первый? | Tavily / Bing | S1 |
| 3 | `storage_key` в v0.10? | да / fallback URL | S5 |
| 4 | Стоимость web search в бюджете? | нет / фикс. цена | S1 |
| 5 | `Ctrl+S` или только комментарий? | реализовать / комментарий | S10 |
| 6 | Workspace: local или S3? | local / S3 | S7 |
| 7 | `PGVECTOR_ENABLED` default? | true / false | S10 |

---

## 8. Решения

**Статус:** не заполнено — ожидает ревью (RULES § 2.14, п. 8).

| # | Решение | Дата | Автор |
|---|---|---|---|
| 1 | — | — | — |
| 2 | — | — | — |
| 3 | — | — | — |

**После ревью:** зафиксировать выбор по каждому вопросу § 7.7, обновить
`Статус` документа на `Approved` и добавить ссылку на протокол ревью.

---

**Конец документа.**
