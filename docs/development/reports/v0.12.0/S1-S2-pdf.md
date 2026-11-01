---
title: "S1-S2: PDF Generator (document_gen)"
date: 2026-11-02
version: v0.12.0
steps: [S1, S2]
status: accepted
related_ki: [KI-463, KI-527]
related_adr: []
---

# Отчёт S1-S2 — PDF Generator (`document_gen`)

Пакет работ: поддержка `format='pdf'` в узле `document_gen` по DESIGN v0.12
§ 3.1 (KI-463): `PdfRenderer` на `pdfkit` с кириллицей, интеграция в
исполнитель, селект формата в UI и тесты. Изменения **не коммитились**
(запрет из задания); `git add -A` не использовался.

## 1. Файлы (+/-)

Учтены только файлы этого пакета. В рабочем дереве одновременно лежат
незакоммиченные изменения параллельных срезов v0.12 (SafeHttpClient binary,
MCP stdio) — они в таблицу не входят (см. § 5).

| Файл | +/- | Что сделано |
|---|---|---|
| `src/documents/pdf-renderer.service.ts` | +598 (новый) | `PdfRenderer`: Markdown/JSON → PDF, Noto Sans, fallback, H1–H3, абзацы, списки, код, ссылки, таблицы плоским текстом |
| `src/documents/pdf-renderer.service.spec.ts` | +148 (новый) | 6 тестов: кириллица/NotoSans, ссылки, пустой документ, JSON, битый JSON, fallback Helvetica |
| `src/documents/document.service.ts` | +8 / −3 | Экспорт `InlineSegment` и `splitInlineMarkdown` для единого разбора инлайн-разметки DOCX/PDF |
| `src/documents/documents.module.ts` | +11 / −1 | `PdfRenderer` в `providers`/`exports` |
| `src/engine/node-executors.ts` | +125 / −36 | `PdfGenerator`, `pdfRenderer` в deps, ветка `format='pdf'`, `.pdf` в ключе, MIME, нормализация `fileName`, снят запрет PDF |
| `src/engine/document-generation-executor.spec.ts` | +150 / −18 | PDF-тесты исполнителя (Markdown, JSON, fileName, DOCX-регресс) и мок `PdfRenderer` |
| `src/engine/execution-engine.service.ts` | +5 | Инжект `PdfRenderer` и передача в deps исполнителя |
| `src/engine/execution-engine.service.spec.ts` | +11 | Заглушка `PdfRenderer` для DI-графа |
| `src/media/media-storage.integration.spec.ts` | +9 | Заглушка `PdfRenderer` для DI-графа интеграционного спека |
| `web/src/components/nodes/DocumentGenNode.tsx` | +68 / −9 | Селект DOCX/PDF, `readFormat`, сброс формата при переходе в template, подпись и `download` по формату |
| `web/src/components/nodes/DocumentGenNode.spec.tsx` | +78 (новые тесты) | Формат по умолчанию, выбор PDF, сброс в template, PDF-ссылка и `document.pdf` |
| `web/src/i18n/en.json` | +4 | `format`, `format.docx`, `format.pdf`, `downloadPdf` |
| `web/src/i18n/ru.json` | +4 | То же на русском |
| `nest-cli.json` | +5 | Копирование `documents/assets/**/*` в `dist` |
| `package.json` | +2 | `pdfkit`, `@types/pdfkit` |
| `pnpm-lock.yaml` | +128 | Разрешённые зависимости `pdfkit` |
| `src/documents/assets/NotoSans-Regular.ttf` | 621 572 байт | Шрифт Noto Sans Regular (OFL) |
| `src/documents/assets/OFL.txt` | 4 396 байт | Лицензия SIL Open Font License 1.1 |
| `docs/CHANGELOG.md` | +14 | Запись в `[Unreleased]` со ссылкой на отчёт |
| `docs/KNOWN_ISSUES.md` | +26 / −7 | KI-463 → Fixed, новый KI-527, сводка 514 |
| `docs/development/reports/README.md` | +1 (наша строка; вторая — параллельный срез S3-S4) | Строка v0.12.0 S1-S2 |
| `docs/development/reports/v0.12.0/S1-S2-pdf.md` | новый | Этот отчёт |

Итого по нашим файлам: **+650 / −74** в отслеживаемых файлах,
**+746** строк новых TS-файлов и два бинарных/лицензионных ассета
(шрифт и OFL).

## 2. Build / test

`pnpm build` — **0 errors / 0 warnings**; `pnpm typecheck` — **0**;
`pnpm test` — **1472 passed / 18 skipped** (102 файла passed, 3 skipped);
`pnpm --dir web test` — **423 passed / 423** (50 файлов);
`pnpm --dir web build` — **OK** (700 мс); `pnpm lint` — **0 errors,
2 warnings** (оба — в `openai-images.provider.spec.ts` параллельного среза
S2, не в файлах PDF). Наши спеки: 6 + 23 backend, 24 frontend-теста узла,
i18n-тест — зелёные.

## 3. Диагностика

1. **`pdfkit` 0.20.2 + `@types/pdfkit` 0.17.7 под NodeNext.** Пакет отдаёт
   ESM-вход `js/pdfkit.node.mjs` с `default = PDFDocument`; типы объявляют
   `export =` с конструктором внутри интерфейса. `import PDFDocument from
   'pdfkit'` + `new PDFDocument()` компилируется и работает в Vitest/Node 24.
2. **Шрифт не попадал бы в `dist`.** `nest build` копирует ассеты только по
   списку `nest-cli.json`. Добавлена запись `documents/assets/**/*`;
   проверено: `dist/documents/assets/NotoSans-Regular.ttf` — 621 572 байта,
   `OFL.txt` — 4 396 байт. Путь в сервисе строится от `import.meta.url`, т.е.
   работает и из `src` (Vitest), и из `dist`.
3. **Стандартные шрифты PDFKit не содержат кириллицы.** Основной текст —
   встроенный Noto Sans; код — стандартный Courier (латиница/цифры). В
   спеке проверяется наличие `NotoSans` в FontDescriptor PDF.
4. **Жирный без Bold-файла.** В assets только Regular (по заданию). Полужирный
   заголовков/шапки таблицы имитируется обводкой текста `stroke: true` при
   `lineWidth(0.3)`; для 14–24 pt визуально совпадает с bold.
5. **GFM-таблицы.** Полной сетки в PDF нет: заголовки и строки выводятся через
   ` | ` без границ. Данные не теряются, ограничение зафиксировано в KI-527.
6. **Первичный красный гейт был не из-за PDF.** В рабочем дереве параллельно
   шли срезы S2/S3 (MCP/HTTP), из-за их незавершённого union-типа первые
   `pnpm build`/`pnpm typecheck` падали в `src/mcp/*`. Эти файлы я не трогал;
   после завершения параллельных правок гейты стали зелёными (см. § 5).

## 4. Smoke

Локально, без запуска HTTP-сервера: два скрипта через `tsx` (после прогона
удалены, RULES 3.13).

**Smoke 1 — прямой рендерер** (`.tmp/pdf-smoke.ts`, Markdown с H1/H2,
кириллицей, списками, ссылкой и fenced-кодом; JSON с title):

```text
# команда: pnpm exec tsx .tmp/pdf-smoke.ts
[Nest] LOG [PdfRenderer] PDF из markdown: 7 блок(ов), 9504 байт
[Nest] LOG [PdfRenderer] PDF из json: 3 блок(ов), 7518 байт
{
  "markdown": {
    "signature": "%PDF-",
    "bytes": 9504,
    "notoSansEmbedded": true,
    "linkAnnotation": true
  },
  "json": {
    "signature": "%PDF-",
    "bytes": 7518,
    "notoSansEmbedded": true
  }
}
```

Файлы: `.tmp/pdf-smoke-markdown.pdf` (9 504 байта),
`.tmp/pdf-smoke-json.pdf` (7 518 байт). Оба начинаются с `%PDF-`.

**Smoke 2 — сквозной путь исполнителя** (`.tmp/pdf-smoke-executor.ts`):
реальный `PdfRenderer`, `DocumentService`-заглушка (падает при вызове —
доказывает, что DOCX-ветка не задействована), хранилище пишет файл на диск.
`data.fileName='smoke-report.docx'` намеренно с чужим расширением.

```text
[Nest] LOG [PdfRenderer] PDF из markdown: 3 блок(ов), 8384 байт
{
  "storageKey": "99999999-9999-4999-8999-999999999999/generated-pdf-node-1.pdf",
  "outputs": {
    "fileUrl": "/media/file/99999999-9999-4999-8999-999999999999/generated-pdf-node-1.pdf",
    "storedUrl": "/media/file/99999999-9999-4999-8999-999999999999/generated-pdf-node-1.pdf",
    "storedExpiresAt": null,
    "fileName": "smoke-report.pdf",
    "mimeType": "application/pdf",
    "bytes": 8384,
    "format": "pdf"
  }
}
```

Что подтверждено: сигнатура `%PDF-`; NotoSans реально встроен; URI-аннотация
ссылки присутствует в PDF; ключ хранилища и `fileName` заканчиваются на
`.pdf`; `mimeType=application/pdf`; `format='pdf'`; DOCX-рендерер не вызван;
ассет шрифта есть в `dist` после `pnpm build`.

Ограничение smoke: в окружении нет `pdftotext`/Ghostscript/PDF-рендерера,
поэтому визуальный рендер страницы не снимался. Проверка структурная:
сигнатура, встроенный шрифт, URI-аннотации, размеры. Текст в content-stream
сжат и в UTF-16/глифах, поэтому поиск кириллицы «как строки» в буфере
непоказателен; наличие NotoSans — достаточный признак выбранного шрифта.

## 5. Что не так

1. **`DOCUMENT_PDF_MAX_BYTES` из DESIGN § 3.1.5 не добавлен.** Лимит 10 МБ уже
   общий (`DOCUMENT_MAX_BYTES`) и проверяется до сохранения для DOCX и PDF.
   Отдельная env-переменная не меняла бы поведение, а потребовала бы правки
   `env.schema.ts`/`.env.example`/движка; вынесено в обоснование (§ 7), не в
   скрытую недоработку. Если нужна настройка лимита — отдельный маленький шаг.
2. **GFM-таблицы в PDF — плоский текст**, а DOCX рисует сетку (KI-527). Это
   осознанное ограничение среза: DESIGN § 3.1.2 перечисляет H1–H3, абзацы,
   списки, код и ссылки, но не таблицы.
3. **Fallback на Helvetica теряет кириллицу.** Это ровно поведение из DESIGN:
   PDF создаётся, warning пишется. Но при отсутствии ассетов в образе
   пользователь получит PDF с пропущенными глифами кириллицы, а не ошибку.
   Warning есть в логе; для production-образа ассет обязан копироваться
   (`nest-cli.json` это теперь делает).
4. **Визуальная проверка PDF не выполнена** — в окружении нет PDF-инструментов
   (см. § 4). Риск: переносы строк/отступы списков не проверены глазами;
   структура и шрифт проверены.
5. **В рабочем дереве параллельно лежат незакоммиченные изменения других
   срезов v0.12** (SafeHttpClient binary, MCP stdio): `src/common/http/*`,
   `src/mcp/*`, `src/media/providers/*`, `src/config/env.schema.ts`,
   `web/src/lib/api.ts` и др. Они не мои; я их не откатывал. Первые
   `pnpm build`/`pnpm typecheck` падали именно на них; финальные гейты зелёные
   после того, как параллельные правки завершились. **Нельзя делать
   `git add -A`**: в индекс попадут чужие срезы. Коммитить только файлы из § 1.
6. **Нормализация `fileName` — новое поведение.** `report.docx` при
   `format='pdf'` теперь становится `report.pdf`; имя без расширения
   дополняется. Незнакомое расширение (`report.final`) не трогается, поэтому
   теоретически остаётся шанс скачать PDF под чужим суффиксом. Для UI поля
   `fileName` сейчас нет — риск только у старых/ручных графов.
7. **Кэш неудачного чтения шрифта — на процесс.** Если ассет появится после
   первого рендера, понадобится рестарт. Это сознательно: warning не спамит
   на каждый документ; в норме ассет есть с самого старта.
8. **Код выше страницы выводится без серого фона** (фон рисуется только если
   блок целиком помещается на страницу). Содержимое не теряется; декоративный
   компромисс, чтобы не разрывать прямоугольник между страницами.

## 6. Новые KI

- **KI-527** — PDF-рендер GFM-таблиц плоским текстом (Low, Documented).
  Запись добавлена в `docs/KNOWN_ISSUES.md`; сводка пересчитана grep'ом:
  Fixed 230 + Open 269 + Documented 9 + Planned 1 + Deferred 1 +
  Won't Fix 4 = **514** заголовков `### KI-`.
- Других новых KI нет. KI-463 переведён в Fixed с указанием v0.12.0 (S1).

## 7. Обоснование решений

1. **`pdfkit`, а не Puppeteer/LibreOffice.** DESIGN § 1.3 прямо исключает
   HTML→PDF и DOCX→PDF: Chromium/LibreOffice — тяжёлый внешний рантайм в
   Docker. `pdfkit` — чистый JS, пишет PDF в буфер, как `docx` в S3, не требует
   системных бинарников; 10 МБ результата укладываются в память.
2. **Один парсер Markdown/JSON на DOCX и PDF.** `PdfRenderer` вызывает
   `parseMarkdown`/`parseJsonDocument` из `DocumentService`; для инлайн-строк
   экспортирован `splitInlineMarkdown`. Иначе два рендерера начали бы
   расходиться в трактовке `**bold**`, списков и ссылок, а тесты пришлось бы
   дублировать. Экспорт — минимальное изменение API (комментарий в коде).
3. **Noto Sans + OFL.** Стандартные 14 шрифтов PDF не содержат кириллицы.
   Noto Sans покрывает кириллицу и латиницу, лицензия OFL разрешает
   распространение; `OFL.txt` положен рядом со шрифтом. Bold не добавлял,
   чтобы не тянуть второй 600-КБ файл: обводка даёт визуальный bold, а
   требование DESIGN — размеры 24/18/14, которые выдержаны.
4. **Fallback Helvetica с warning, а не исключение.** DESIGN § 3.1.2 требует
   именно fallback: документ должен собраться даже в урезанном образе.
   Warning пишется один раз благодаря кэшу Promise; тест подменяет `readFile`
   на отказ и проверяет и warning, и валидный PDF.
5. **`PdfGenerator` — структурный интерфейс, а не импорт класса.** Тот же
   приём, что `DocumentGenerator`/`AgentRunner`: исполнитель не зависит от
   Nest-DI и `pdfkit`, спеки подменяют рендерер `vi.fn()`. `PDF_MIME_TYPE`
   импортируется как константа — единственный источник истины для MIME.
6. **Расширение и MIME — часть контракта, а не косметика.** Ключ хранилища
   строится из `format` (`generated-<node>.pdf`), из него же берётся `fileName`;
   `mimeType` выбирается по формату. Дополнительно нормализуется явный
   `data.fileName`, чтобы PDF нельзя было скачать как `.docx` — это возврат
   той же ошибки KI-463 на уровне имени.
7. **UI: формат только в inline; template сбрасывает PDF на DOCX.** Шаблоны —
   исключительно `.docx` (backend `superRefine`), поэтому селект формата
   показывается в inline-режиме, а переключение в template принудительно
   ставит `docx`. Иначе пользователь получал бы ошибку валидации при Run без
   видимой причины. Подпись ссылки и `download` берутся из `outputs.format`
   уже сгенерированного файла, а не из текущего селекта — старые запуски
   остаются корректными.
8. **Лимит 10 МБ — общий.** `saveDocumentAsync` проверяет размер до записи в
   хранилище; для PDF этого достаточно, а новая env-переменная без реального
   сценария настройки была бы лишним конфигом. Если понадобится — вводится
   вместе с `ConfigService`, как остальные лимиты (RULES 4.6).
9. **Тесты без PDF-парсера.** В проекте нет `pdf-parse`/`pdfjs`; добавлять
   зависимость только ради теста — лишний вес. Проверяются контрактные
   признаки: `%PDF-`, наличие `NotoSans`, `/URI` и URL ссылки, отсутствие
   вызова DOCX-рендерера, расширение/MIME/`fileName`. Этого достаточно, чтобы
   поймать регресс «PDF не тот формат/не тот шрифт/потеряли ссылку».
