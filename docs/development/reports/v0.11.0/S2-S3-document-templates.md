---
title: "S2+S3: Document Templates Core & API"
date: 2026-10-19
version: v0.11.0
steps: [S2, S3]
status: accepted
related_ki: [KI-479, KI-481, KI-482]
---

# Отчёт S2+S3 — Document Template Core & API

**Статус:** реализовано, не закоммичено (по заданию). `git add -A` не использовался.

> ⚠️ **Параллельная сессия.** В этом же рабочем каталоге с 12:27 работала другая
> dsh-сессия (S6 MCP): она создала `src/mcp/**`, правила `src/agent/*`,
> `src/engine/node-executors.ts`, `src/runs/runs.module.ts`, добавила
> `@modelcontextprotocol/sdk` в `package.json`/lock и KI в docs. Мои правки с ними
> не пересекаются по смыслу, но `package.json`, `pnpm-lock.yaml`,
> `src/engine/node-executors.ts`, `CHANGELOG/KNOWN_ISSUES` — общие. Финальные
> прогоны сделаны после того, как их файлы перестали меняться (последняя запись
> 12:37:37).

---

## 1. Файлы (+/−)

### Новые (S2/S3)

| Файл | Строк |
|---|---:|
| [document-template.constants.ts](../../../../src/documents/document-template.constants.ts) | +67 |
| [document-template.service.ts](../../../../src/documents/document-template.service.ts) | +630 |
| [document-template.service.spec.ts](../../../../src/documents/document-template.service.spec.ts) | +460 |
| [document-templates.service.ts](../../../../src/documents/document-templates.service.ts) | +463 |
| [document-templates.service.spec.ts](../../../../src/documents/document-templates.service.spec.ts) | +462 |
| [document-templates.controller.ts](../../../../src/documents/document-templates.controller.ts) | +171 |
| [document-templates.controller.spec.ts](../../../../src/documents/document-templates.controller.spec.ts) | +290 |
| [document-template.dto.ts](../../../../src/documents/dto/document-template.dto.ts) | +60 |
| [web/src/lib/api.spec.ts](../../../../web/src/lib/api.spec.ts) | +177 |

### Изменённые (мои)

| Файл | +/− |
|---|---|
| [package.json](../../../../package.json) | +4 (docxtemplater, pizzip, @types/multer) |
| [pnpm-lock.yaml](../../../../pnpm-lock.yaml) | +196 (часть строк — `@modelcontextprotocol/sdk` параллельной сессии) |
| [document.errors.ts](../../../../src/documents/document.errors.ts) | +69 (2 исключения + тип кода) |
| [documents.module.ts](../../../../src/documents/documents.module.ts) | +22/−11 |
| [engine/errors.ts](../../../../src/engine/errors.ts) | +50 (перенос `UnsupportedNodeTypeException`/`NodeDataValidationException`) |
| [engine/node-executors.ts](../../../../src/engine/node-executors.ts) | мой вклад: импорт + реэкспорт (−удалены 2 класса); остальной diff — параллельная S6 |
| [api-contract.spec.ts](../../../../src/runs/dto/api-contract.spec.ts) | +17 |
| [web/src/lib/api.ts](../../../../web/src/lib/api.ts) | +32/−1 (KI-479 + `ApiDocumentTemplateSchema`) |
| [web/src/lib/api-contract.spec.ts](../../../../web/src/lib/api-contract.spec.ts) | +3/−1 |
| [api-contract.json](../api-contract.json) | +1 (`DocumentTemplateSummary`) |
| [CHANGELOG.md](../../../CHANGELOG.md) | +33 |
| [KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md) | +50/−10 (KI-479 Fixed, KI-481/482, сводка) |
| [DESIGN_V011_FEATURES.md](../v0.11/DESIGN_V011_FEATURES.md) | +8 (поправка KI-481) |
| [README.md](../../../../README.md) | +6 |
| [.env.example](../../../../.env.example) | +2/−1 |

**Не тронуты:** `execution-engine.service.ts`, `DocumentGenNode.tsx` (S4/S5), миграции/схема Drizzle (S1).

---

## 2. Build / test

`pnpm build` 0 errors / 0 warnings · `pnpm typecheck` 0 errors · `pnpm test`
**1329 passed / 18 skipped** (92 файла) · `pnpm --dir web test` **380 passed**
(49 файлов) · `pnpm --dir web build` ✓ · `pnpm test:parity` **10 passed** ·
`pnpm install --frozen-lockfile` ✓

Из 1329 backend-тестов мои — 62: S2 renderer — 28, S3 service — 21, S3 controller —
13 (baseline 1211 + 62 = 1273; остальные +56 добавлены параллельной MCP-сессией).
Web: 375 + 5 моих = 380.

---

## 3. Диагностика

1. **DESIGN § 3.1.3 содержит нерабочий порядок проверок (KI-481).** В псевдокоде
   `asText()` для проверки макросов стоит до подсчёта `_data.uncompressedSize`.
   Проверил на PizZip 3.3.0: до `asText()` `uncompressedSize === 8`, после
   `asText()` — `undefined`. Значит, реализация «строго по псевдокоду» отклонила
   бы **каждый** шаблон по fail-closed-ветке. В коде порядок исправлен: сначала
   записи/размеры (метаданные), затем макросы и DTD (текст). Набор проверок не
   изменён; в DESIGN добавлена поправка.
2. **docxtemplater по умолчанию печатает контекст шаблона (KI-482).** В тестах в
   stdout уходил объект ошибки с `properties.context` (фрагмент пользовательского
   документа). Добавлено `errorLogging: false`; наружу — только `details[]` без
   содержимого (файл-часть + объяснение).
3. **`@types/multer` не подхватывается автоматически**: в `tsconfig.json` задан
   явный `types: ["vitest/globals","node"]`. Использован структурный
   `UploadedFileLike` (DESIGN § 3.1.5 это допускает), пакет установлен по DESIGN
   § 4.4. Не дефект — осознанный выбор.
4. **Первый `pnpm typecheck` падал** на незавершённых файлах параллельной S6
   (`src/mcp/mcp-client.service.ts`: `isCallToolResult` не найден). После их
   правок — 0 ошибок; мои файлы ошибок не давали.
5. **Один прогон `pnpm --dir web build` упал** на моём же `api.spec.ts`
   (`TS6196: FetchCall is declared but never used`, в web включён
   `noUnusedLocals`) — неиспользуемый интерфейс удалён, повторный build зелёный.
6. **413.** В Nest 12 `FileInterceptor` сам вызывает `transformException` и
   превращает `MulterError` с `LIMIT_FILE_SIZE` в `PayloadTooLargeException`.
   Свой фильтр-обёртка была бы мёртвым кодом, поэтому её нет — поведение
   зафиксировано unit-тестом (413) и HTTP-smoke (413).

---

## 4. Smoke (локальный запуск, реальные PostgreSQL 17 + Redis)

Запуск: `PORT=3199 AUTH_DISABLED=true node --env-file=.env dist/main` →
«Nest application successfully started», маршруты
`DocumentTemplatesController {/workflow/:id/document-templates}` замаплены
(GET/POST/GET :templateId/file/DELETE :templateId). Workflow:
`b0a28dcb-7419-4bcc-a0ed-3933aa205bdf` (owner = demo user), шаблон — валидный
`.docx` 1011 байт, плейсхолдеры `{number},{client},{amount},{date}`.

| Кейс | Запрос | Ответ |
|---|---|---|
| GET /templates (регрессия) | `GET /templates` | **200**, 350 байт, 3 шаблона (`http-llm`, `text-llm`, …) |
| POST multipart (KI-479) | `curl -F file=@…docx -F name=…` | **201** `{"id":"29793968-…","name":"Smoke contract","bytes":1011,"placeholders":["amount","client","date","number"],"createdAt":"2026-10-19T09:36:59.000Z"}` |
| GET list | `GET …/document-templates` | **200**, 1 элемент, без `content` |
| GET file | `GET …/:tid/file` | **200**, `Content-Type: application/vnd…wordprocessingml.document`, `Content-Disposition: attachment; filename*=UTF-8''Smoke%20contract`, `Content-Length: 1011`; SHA-256 скачанного = SHA-256 исходника `bf6745de…3b50aa7` |
| DB-сверка | SQL из `document_templates` | `sha256` = SHA-256 файла, `bytes = octet_length(content) = 1011`, `placeholders` = 4 имени |
| Bad file | `.docx` с текстом «not a zip» | **400** `{"message":"Некорректный шаблон: файл не является ZIP","code":"invalid-zip","details":[]}` |
| Invalid uuid | `POST /workflow/not-a-uuid/...` | **400** (ZodValidationPipe) |
| Oversize | 5 242 881 байт | **413** `{"message":"File too large","error":"Payload Too Large","statusCode":413}` |
| No file | multipart только с `name` | **400** `{"message":"Файл шаблона обязателен (поле file)"}` |
| Foreign workflow | валидный uuid без доступа | **404** `{"message":"Workflow … не найден"}` |
| DELETE | `DELETE …/:tid` | **204**; list → `[]`; повторный DELETE → **404** |
| Очистка | строка в БД после smoke | удалена, `document_templates` пуста |

**KI-479:** backend принимает multipart (POST выше), фронтенд-тест подтверждает,
что для `FormData` `Content-Type` не ставится, а после refresh тело (`FormData`)
уходит повторно без JSON-заголовка.

**Логи:** в stdout — только метаданные (`«Smoke contract»`, 1011 байт,
плейсхолдеров 4), содержимого документа и контекста docxtemplater нет (проверка
KI-482).

---

## 5. Что не так / ограничения

1. **Не закоммичено** — по заданию. `git add -A` не выполнялся.
2. **403 vs 404.** В репозитории принято «чужой = 404» (KI-202). Задание требует
   и 403, и 404: сделано двухшаговое решение — нет доступа уровня `viewer` → 404
   (workflow неотличим от несуществующего), доступ `viewer` есть, а нужен
   `editor` → 403 (пользователь и так видит workflow). Покрыто service-тестами и
   controller-тестами.
3. **`node-executors.ts` тронут**, хотя правки движка объявлены вне S2/S3:
   перенесены два класса исключений в `src/engine/errors.ts` (реэкспорт
   сохранён). Причина — иначе `documents` → `engine/node-executors` даёт цикл
   `engine → documents → engine` в S4. Поведение исполнителей не изменилось;
   `execution-engine.service.ts` не тронут.
4. **`@types/multer` установлен, но не используется** как глобальный тип (см.
   диагностику 3).
5. **S4/S5 не реализованы**: executor `document_gen` (mode=template), переменные
   из входа узла, UI загрузки/выбора шаблона. `resolveTemplateVariables` и
   `DocumentTemplatesService.loadAsync` готовы к подключению в S4.
6. **Публичный API — без пагинации списка**: лимит 50 шаблонов на workflow (env),
   список целиком. Для 50 элементов это нормально; пагинация — S5+ при
   необходимости.
7. **`inspect` не проверяет лимит 500 плейсхолдеров** — это делает S3-загрузчик
   (400), чтобы рендерер оставался чистым и не зависел от политики загрузки.
8. **`process.env` в `document-template.constants.ts`** — осознанное отклонение от
   RULES 4.6: значение нужно декоратору `FileInterceptor` вне DI; значение
   проверяется по тем же границам, что env-схема, и при некорректном значении
   берётся дефолт (fail-fast всё равно даёт `validateEnv`).
9. В `package.json`/lock, кроме моих 3 зависимостей, есть
   `@modelcontextprotocol/sdk` параллельной сессии — при коммите учитывать
   разделение пакетов (RULES 3.2).
10. Контракт-черновик `docs/development/v0.11/api-contract-drafts.json` не
    менялся: `DocumentTemplateSummary` в нём уже был (S0), S3 его активировал в
    основном `api-contract.json`.

---

## 6. Новые KI

- **KI-481 (Low, Fixed):** DESIGN § 3.1.3 — порядок
  `asText()`/`uncompressedSize` делает fail-closed неработоспособным; исправлено
  в коде + поправка в DESIGN.
- **KI-482 (Low, Fixed):** docxtemplater печатает контекст шаблона в stdout при
  ошибке (нарушение RULES 5.9); отключено `errorLogging`.
- **KI-479 (Medium): переход `Open` → `Fixed`** (v0.11.0, файлы
  `web/src/lib/api.ts`, `web/src/lib/api.spec.ts`), со ссылкой на DESIGN § 3.1.8.
- Реестр после правок: 470 записей — Fixed 217, Open 241, Documented 6, Planned 1,
  Deferred 1, Won't Fix 4 (пересчитано grep'ом по RULES 3.20; сводка в файле
  обновлена).

---

## 7. Обоснование решений

1. **Два сервиса, как в DESIGN § 3.1.7.** `DocumentTemplateService`
   (docxtemplater/pizzip) не знает о БД; `DocumentTemplatesService`
   (права/CRUD/`loadAsync`) не знает о рендерере. Это позволяет тестировать
   ZIP-защиту без Nest-графа и PostgreSQL, а S4 подключает только `loadAsync` +
   `renderAsync`.
2. **Проверки до docxtemplater.** Библиотека распаковывает ZIP и парсит XML,
   поэтому zip bomb/макросы/DTD отсекаются по заголовкам и метаданным **до**
   компиляции. Fail-closed при нечитаемом `uncompressedSize` сохранён.
3. **Порядок проверок архива** — исправлен против псевдокода DESIGN из-за мутации
   `_data` в PizZip (KI-481); иначе fail-closed отклонял бы все шаблоны.
4. **`nullGetter` + `missingVariables`** — отсутствующая переменная не роняет
   запуск (DESIGN § 3.1.4), имя попадает в ответ для warning в узле (S4).
5. **`resolveTemplateVariables` вынесен в `documents`** (не в engine), потому что
   по заданию тестируется в S2, а S4 только вызывает.
   `NodeDataValidationException` импортируется из лёгкого `engine/errors.ts` — без
   цикла.
6. **Права:** переиспользован `workflowAccessFilter` с разделением 404/403 (см.
   п. 5.2) — не появилось параллельной проверки владельца.
7. **413** — доверие штатному `transformException` Nest 12 вместо дублирующего
   фильтра; проверено тестом и curl.
8. **Лимиты** — env через `ConfigService` (RULES 4.6), кроме декораторного
   значения multer (см. п. 5.8); значения по умолчанию совпадают с
   `DocumentTemplateEnvSchema` (S0).
9. **`errorLogging: false`** — RULES 5.9: содержимое документов/промптов не
   логируется; подробности ошибки отдаются структурированно и без текста
   документа.
10. **KI-479:** заголовок не ставится при `FormData` и не перезаписывается, если
    задан явно; повтор после refresh безопасен, т.к. тело не потребляется.
11. **Контракт:** `DocumentTemplateSummary` добавлен в `api-contract.json` и в оба
    spec-гейта (backend читает TS-интерфейс компилятором, web сверяет
    Zod-зеркало) — иначе гейт KI-352 падал бы.
12. **JSDoc/имена:** методы названы строго по DESIGN (`inspect`, `renderAsync`,
    `createDocument`, `assertDocxArchive`, `resolveTemplateVariables`,
    `sanitizeVariables`, `createAsync/listAsync/loadAsync/deleteAsync/getFileAsync`);
    `inspect` синхронный, как в DESIGN, несмотря на RULES 1.4 (CPU-bound, не I/O).

---

## Черновик commit message (не коммитил)

```
feat(v0.11.0): S2+S3 — Document Template Core and API

S2 (template core):
- DocumentTemplateService (docxtemplater 3.71 + pizzip 3.3): inspect,
  renderAsync с nullGetter/missingVariables, extractPlaceholders.
- fail-closed проверка OOXML до компиляции: ZIP-сигнатура, обязательные
  [Content_Types].xml/word/document.xml, запрет vbaProject.bin/macroEnabled,
  лимиты распакованного размера/записей/сжатия (env DOCUMENT_TEMPLATE_*),
  скан XML/rels на <!DOCTYPE>/<!ENTITY.
- DocumentTemplateInvalidException (invalid-zip|invalid-docx|syntax|render),
  DocumentTemplateNotFoundException; resolveTemplateVariables/sanitizeVariables.
- KI-481: порядок проверок размера и asText (PizZip мутирует _data).
- KI-482: errorLogging=false — контекст шаблона не попадает в логи (RULES 5.9).

S3 (template API):
- DocumentTemplatesService: create/list/load/delete/getFile, права
  viewer/editor через workflowAccessFilter (403/404), лимит шаблонов,
  sha256/bytes/placeholders/content в document_templates.
- DocumentTemplatesController: GET/POST /workflow/:id/document-templates,
  GET :templateId/file, DELETE :templateId; FileInterceptor (5 МБ, 413),
  Zod-валидация body/path; DocumentTemplateSummary в api-contract.json
  и в обоих contract-spec.
- documents.module: экспорт сервисов для S4; AuthModule для JwtAuthGuard.

KI-479: web/src/lib/api.ts — не ставить Content-Type: application/json для
FormData и не перезаписывать явный заголовок; тест в web/src/lib/api.spec.ts.

Docs: CHANGELOG, KNOWN_ISSUES (KI-479 Fixed, KI-481/482), README, DESIGN § 3.1.3,
.env.example. Tests: backend 1329 passed / 18 skipped, web 380 passed,
build/typecheck 0 errors, 0 warnings.
```
