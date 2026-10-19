---
title: "S4+S5: Document Templates Engine & UI"
date: 2026-10-19
version: v0.11.0
steps: [S4, S5]
status: accepted
related_ki: [KI-463, KI-479, KI-480]
related_adr: []
---

# Отчёт S4+S5 — Document Templates Engine & UI

**Статус:** реализовано, **не закоммичено** (по заданию). `git add -A` не использовался.
`RunLeaseService` не тронут (S9). Новые зависимости не добавлялись.

---

## 1. Файлы (+/−)

### Изменённые

| Файл | +/− | Что |
|---|---:|---|
| [src/engine/node-executors.ts](../../../../src/engine/node-executors.ts) | +323 / −58 | `mode`/`templateId`/`variables` в `DocumentGenerationNodeData` и Zod-схеме (`superRefine`), `DocumentGenerationDeps` (+ `DocumentTemplateLoader`/`DocumentTemplateRenderer`), template-ветка исполнителя, `logs` в результате, общие `saveDocumentAsync`/`resolveDocumentFileName` |
| [src/engine/execution-engine.service.ts](../../../../src/engine/execution-engine.service.ts) | +27 / −2 | DI `DocumentTemplatesService` + `DocumentTemplateService`; в `case 'document_gen'` — `workflowId` только для template, deps-объект, `logs` шага |
| [src/engine/document-generation-executor.spec.ts](../../../../src/engine/document-generation-executor.spec.ts) | +305 / −26 | переход на `createDeps`; 9 новых template-тестов |
| [src/engine/execution-engine.service.spec.ts](../../../../src/engine/execution-engine.service.spec.ts) | +109 / −0 | стабы template-зависимостей в TestingModule; 2 wiring-теста (успех + чужой шаблон) |
| [src/media/media-storage.integration.spec.ts](../../../../src/media/media-storage.integration.spec.ts) | +13 / −0 | стабы новых зависимостей движка (иначе не собирается DI в CI-гейте) |
| [web/src/components/nodes/DocumentGenNode.tsx](../../../../web/src/components/nodes/DocumentGenNode.tsx) | +496 / −44 | селект режима; template-панель: список шаблонов, upload, чипы плейсхолдеров, `variables`, удаление (disabled для viewer), `missingVariables`, data-атрибуты |
| [web/src/components/nodes/DocumentGenNode.spec.tsx](../../../../web/src/components/nodes/DocumentGenNode.spec.tsx) | +381 / −11 | мок API шаблонов; 12 новых тестов (режим, список, чипы, upload, ошибка, variables, viewer, missing) |
| [web/src/lib/api.ts](../../../../web/src/lib/api.ts) | +71 / −0 | `listDocumentTemplatesAsync`, `uploadDocumentTemplateAsync` (FormData), `deleteDocumentTemplateAsync` |
| [web/src/lib/api.spec.ts](../../../../web/src/lib/api.spec.ts) | +83 / −1 | 3 теста: список, multipart POST без JSON-заголовка (KI-479), DELETE |
| [web/src/i18n/ru.json](../../../../web/src/i18n/ru.json) | +9 / −0 | `node.document_gen.mode`, `template.*` (uploading/deleteConfirm/deleteError/loadError/needSave/noPlaceholders/variablesFromInput/variablesInvalid) |
| [web/src/i18n/en.json](../../../../web/src/i18n/en.json) | +9 / −0 | то же, паритет ключей |
| [docs/development/reports/README.md](../README.md) | +1 / −0 | строка отчёта S4-S5 |
| [docs/CHANGELOG.md](../../../CHANGELOG.md) | +18 / −2 | `[Unreleased] → Added`: S4+S5 + ссылка на отчёт (заодно исправлены относительные ссылки отчётов S0-S1/S2-S3/S6-S7) |
| `docs/development/reports/v0.11.0/S4-S5-document-templates-engine.md` *(new)* | +169 | этот отчёт |

**Итого:** 13 файлов изменено + 1 новый отчёт: **+2014 / −144** (по `git diff --numstat` + отчёт).

---

## 2. Build / test

`pnpm build` — **0 errors / 0 warnings** · `pnpm typecheck` — **0** · `pnpm test` — **92 файла passed / 3 skipped, 1341 passed / 18 skipped** · `pnpm --dir web test` — **49 файлов, 395 passed** · `pnpm --dir web build` — **✓ 280 ms**.

Прирост тестов: backend 1329 → **1341**; из них моих — doc-executor **19** (было 10, +9) и engine **+2 сценария**; web 380 → **395** (+12 компонентных, +3 API). Skipped — прежние DB-интеграционные спеки без `DATABASE_URL`.

---

## 3. Диагностика

1. **`z.infer` не сужает `templateId` после `superRefine`.** Схема гарантирует `templateId` для `mode='template'`, но TS видит `string | undefined` — в `executeTemplateDocumentAsync` добавлена явная проверка с тем же текстом ошибки (`NodeDataValidationException`), иначе `loadAsync` получил бы `undefined`.
2. **`readonly string[]` vs `string[]`.** `DocumentTemplateService.renderAsync` возвращает `missingVariables: readonly string[]` (S2). В `DocumentTemplateRenderer` использован `readonly string[]`, а в `outputs` кладётся копия `[...missingVariables]` (тип `string[]` по DESIGN § 3.1.7). Иначе `DocumentTemplateService` не был бы структурно совместим с `deps`.
3. **`workflowId` только для template.** `findWorkflowIdByRunAsync` — лишний SELECT; движок читает его, только если `node.data.mode === 'template'`, и передаёт `''` для inline (DESIGN § 3.1.7). Исполнитель защищён от пустой строки явной ошибкой — иначе Postgres вернул бы `invalid input syntax for type uuid`.
4. **`logs` не потребовали правок схемы `node_runs`.** В движке уже было общее поле `NodeStepResult.logs` (введено для агента), оно дописывается к `node_runs.logs` и к `node_completed`; template-ветка возвращает туда `warning` о незаполненных плейсхолдерах.
5. **`media-storage.integration.spec.ts` пришлось обновить.** Этот spec собирает `ExecutionEngineService` через `Test.createTestingModule`; без новых провайдеров Nest-граф не компилируется. В обычном `pnpm test` он skipped (нет `DATABASE_URL`), но в CI с миграциями — выполняется; ошибка была бы только в CI (ловушка «локально зелено»).
6. **Smoke: `node --env-file` не перебивает process env.** Проверено опытом: `AUTH_DISABLED=false` остаётся из `.env`, поэтому `$env:AUTH_DISABLED='true'` перед `node --env-file=.env dist/main` имеет приоритет. Сервер поднят на `PORT=3199` без правок `.env`.
7. **UI-тесты и статические пропсы.** В изолированном рендере `DocumentGenNode` получает `data` пропом, а `updateNodeData` меняет узел в React Flow, не этот проп. Поэтому переключение режима проверяется по `flow.getNode(id).data.mode` (как в существующих тестах узла), а template-разметка — отдельным рендером с `mode: 'template'`; реактивные сценарии (upload/missing/viewer) проверяются по DOM.
8. **`vi.mock('@/lib/api', async (importOriginal) => …)`** вместо фабрики «только 3 функции»: стор `workflow.ts` импортирует из `@/lib/api` и другие функции, иначе модуль падал бы на отсутствующих именованных экспортах.
9. **`pizzip` в smoke-скрипте.** Node ESM `import PizZip from 'pizzip'` работает (CJS default = класс); шаблон собран в памяти, реальный Word не нужен.
10. **Импорт `document-template.service` в `node-executors.ts`** тянет `docxtemplater`/`pizzip` в граф загрузки движка (в проде они и так загружены `DocumentsModule`). На import-время тестов влияет незаметно (2.3 с на два спека); альтернатива — вынести `resolveTemplateVariables` в отдельный лёгкий модуль — оставлена на будущее (см. § 6).

---

## 4. Smoke (локальный запуск, реальные PostgreSQL 17 + Redis 17 + BullMQ-worker)

Запуск: `PORT=3199 AUTH_DISABLED=true node --env-file=.env dist/main` → «Nest application successfully started»; маршруты `DocumentTemplatesController {/workflow/:id/document-templates}` и `ExecutionEngineService` собрались с новыми зависимостями.
Сценарий — отдельный `tmp-smoke-s4s5.mjs` (удалён после прогона): `.docx` собран в памяти (плейсхолдеры `{number},{date},{client},{amount}`), workflow `Text → document_gen(mode=template)`, переменные приходят JSON-строкой из Text-узла.

| Кейс | Запрос/проверка | Результат |
|---|---|---|
| Загрузка шаблона (multipart, KI-479) | `POST …/document-templates` c `FormData` | **201**, `placeholders=[amount,client,date,number]`, `bytes=1011` |
| Список | `GET …/document-templates` | **200**, 1 элемент, без `content` |
| Файл шаблона | `GET …/:templateId/file` | **200**, `Content-Type: …wordprocessingml.document`, байты **равны** загруженным |
| Граф | `PATCH /workflow/:id` | nodes Text + document_gen(`templateId`), edges `text-output → text-input` |
| Запуск | `POST /runs` → poll `GET /runs/:id` | **completed**; узел `doc-1` completed |
| Outputs | `GET /runs/:id` (`nodes[].outputs`) | `mode='template'`, `templateId`, `templateName='Smoke contract S4'`, `format='docx'`, `fileName='contract-smoke.docx'`, `bytes=1069`, `missingVariables=['date','number']` |
| Логи | `GET /runs/:id` (`nodes[].logs`) | `warning: шаблон отрендерен, не заполнены плейсхолдеры: date, number` |
| Скачивание DOCX | `GET {fileUrl}` | **200**, `Content-Type: …wordprocessingml.document`, 1069 байт |
| Подстановка | распаковка `word/document.xml` | `«Договор №  от . Клиент: ACME. Сумма: 42.»`; `{number}`/`{date}` удалены (пустая строка), `ACME`/`42` подставлены |
| Чужой шаблон | workflow-2 ссылается на `templateId` workflow-1 → `POST /runs` | run **failed**, узел **failed**, error: `Шаблон документа baaa1867-… не найден в workflow` (1 попытка, non-retryable) |
| Очистка | `DELETE /workflow/:id` ×2 | **204**; `document_templates` = 0 строк, `workflows like 'S4/S5 smoke%'` = 0; каталог `data/media/<runId>` удалён, сервер остановлен |

> **Браузерный smoke не выполнялся:** в сессии нет браузерной автоматизации (как в S0-S3). UI-часть покрыта 20 jsdom-тестами `DocumentGenNode` (режим, список, чипы, upload, variables, viewer, missing) и зелёными `web build`/`web test`; реальный клик по `<input type="file">` в браузере остаётся за ручным QA-кейсом в S17.

---

## 5. Что не так / ограничения

1. **Не закоммичено** — по заданию; `git add -A` не использовался. Рабочее дерево: 11 изменённых файлов + отчёт (см. § 1).
2. **CHANGELOG обновлён минимально** (одна запись `Added` + ссылка на отчёт, RULES 2.1/2.18); `KNOWN_ISSUES`/`README`/`USER_GUIDE`/`QA` в этом пакете не трогались — реестр KI и release-гайды идут в S17 (RULES 2.16), а номера новым KI присваивает пользователь (как в S0-S1).
3. **Ошибки backend не показываются в UI дословно.** `uploadDocumentTemplateAsync`/`deleteDocumentTemplateAsync` в компоненте ловятся и показывают generic `template.uploadError`/`template.deleteError`; пользователь не видит причину (`invalid-docx`, «макросы не поддерживаются», 413). Backend уже отдаёт `message` — нужен `ApiError.message` в подсказке (KI-кандидат § 6.1).
4. **Черновик `variables` не синхронизируется с `data.variables` при undo/redo.** `variablesDraft` — локальный state: после отмены правки в текстовом поле может остаться старый JSON, хотя в узле уже другое значение; сохранение при этом корректно (в стор пишется только валидный JSON). KI-кандидат § 6.2.
5. **Список шаблонов не обновляется при возврате к узлу.** `useEffect` перезапрашивает список при смене режима/workflow; если шаблон загрузил коллега или он появился в другой вкладке, узел покажет старый список до переключения режима/перезагрузки. KI-кандидат § 6.3.
6. **`storage_key` не входит в `NodeRunSnapshot`.** API `GET /runs/:id` (`nodes`) отдаёт `outputs`/`logs`, но не `storage_key`; в smoke поле проверено только через unit-тест движка (`fake.rows[0]?.storageKey`). Это существующее поведение v0.10, не регрессия S4.
7. **Smoke ловит только сценарий «шаблон + Text-узел»**, без LLM (ключи провайдеров в `.env` не заданы). Сценарий DESIGN § 1.4.1 («LLM извлекает поля») не проверялся вживую — только контракт `inputs.prompt` (JSON-строка) в unit/smoke.
8. **`it.each` в engine-спеке** расширяется в несколько тестов, поэтому общий прирост backend-тестов (+12) больше суммы заявленных новых сценариев (+11); это учёт Vitest, не расхождение логики.
9. **`DocumentGenerationNodeDataSchema` и web-тип `DocumentGenNodeData` дублируют `mode`/`templateId`/`variables`** (shared-типов frontend↔backend в проекте нет; как KI-488). KI-кандидат § 6.4.
10. **`template.delete` использует `window.confirm`** (нативный диалог). Тестами удаление по клику не проверяется (только disabled/enabled), т.к. нативный confirm в jsdom не мокался: покрыт happy-path API-тестом и ручным QA.
11. **`read_file`/`write_file` и `document_gen` теперь по-разному получают `workflowId`**: первые — всегда, второй — только в template-режиме. Это осознанно (DESIGN § 3.1.7), но повод не забыть при рефакторинге контекста запуска.
12. **В `node-executors.ts` JSDoc ссылается на `DocumentRenderException`** (класс из `document.service.ts`), который в template-ветке не бросается: там `DocumentTemplateInvalidException`. Ссылка историческая, из S6; не дефект, но при следующем чтении файла может путать.
13. **Компонентный upload-тест мокает не `fetch`, а функции `@/lib/api`** (как принято в спеках узлов этого репозитория): сеть в jsdom не участвует. Сам multipart-контракт (FormData + отсутствие JSON-заголовка, KI-479) проверен отдельно в `web/src/lib/api.spec.ts` через stub `fetch`; сквозная multipart-загрузка — в § 4 smoke.

---

## 6. Новые KI (кандидаты)

Номера предложены по текущему максимуму реестра (KI-488), **в `KNOWN_ISSUES.md` не вносил** — нумерацию подтверждает пользователь (практика S0-S1).

1. **KI-489-кандидат (Low, UX).** `DocumentGenNode`: причина ошибки загрузки/удаления шаблона не показывается — только generic-текст. Backend уже отдаёт `message` (`Некорректный шаблон: …`, 413), поэтому достаточно вывести `ApiError.message` под кнопкой.
2. **KI-490-кандидат (Low, UX).** `DocumentGenNode`: `variablesDraft` не пересинхронизируется при undo/redo/внешнем изменении `data.variables` — в textarea может отображаться устаревший JSON.
3. **KI-491-кандидат (Low, UX).** Список шаблонов в узле кешируется в локальном state и не обновляется при повторном открытии узла/загрузке из другой вкладки; нужен refetch (focus/save) или инвалидация.
4. **KI-492-кандидат (Low, архитектура).** Дублирование контракта `document_gen` frontend↔backend (`mode`/`templateId`/`variables` и `mode` union) при отсутствии shared-типов; риск рассинхронизации при следующем изменении схемы (аналог KI-488).

---

## 7. Обоснование решений

1. **Deps-объект вместо позиционных аргументов** — прямо по DESIGN § 3.1.7: к S4 у функции уже было 4 позиционных параметра, template добавляет ещё 3 зависимости. Объект делает вызов читаемым и исключает перепутывание моков, которое типы не поймали бы (`DocumentGenerator` и `DocumentTemplateRenderer` структурно разные, но обе функции асинхронные).
2. **Структурные контракты `DocumentTemplateLoader`/`DocumentTemplateRenderer`, а не импорт сервисов** — исполнитель остаётся юнит-тестируемым без Nest-DI/PostgreSQL и без `docxtemplater`-инстанса; в проде подставляются `DocumentTemplatesService`/`DocumentTemplateService` (DI из `DocumentsModule`, уже экспортированы в S2/S3).
3. **Template-ветка вынесена в отдельную функцию** `executeTemplateDocumentAsync`: inline-конвейер остаётся байт-в-байт прежним (кроме перехода на `deps`/`saveDocumentAsync`), а порядок шагов template (load → variables → render → size → save) читается как DESIGN § 3.1.7.
4. **Проверка `mediaStorage.backend === 'none'` до рендера** — как в S6: бессмысленно рендерить документ, который некуда сохранить. Для template это ещё и экономит загрузку 5 МБ шаблона из БД.
5. **`missingVariables` — не ошибка, а warning** (DESIGN § 3.1.4): пустая переменная рендерится пустой строкой (`nullGetter` S2), имя попадает в `outputs` и в `logs`. В лог — **только имена**, без значений (RULES 5.9); формат `warning: …` совпадает со стилем логов движка и виден в `RunResultPanel` (секция «Логи»).
6. **`fileName` в template-режиме** — та же логика, что inline: `data.fileName` важнее имени из хранилища (`generated-<nodeId>.docx`); имя шаблона попадает в `templateName`, но не подменяет `download`-имя (пользователь явно задаёт файл узла). Вынесено в `resolveDocumentFileName`, чтобы не дублировать.
7. **`mode` в engine проверяется по сырому `node.data.mode`** — единственное место, где нужен `workflowId`; Zod-валидация всё равно произойдёт в исполнителе (и невалидное значение станет `NodeDataValidationException`, а не HTTP-ошибкой). Так inline не платит лишним SELECT (DESIGN § 3.1.7).
8. **`logs` переиспользует существующее поле шага** — не пришлось менять ни `NodeStepResult` (поле было), ни колонку `node_runs.logs` (JSON-массив), ни SSE-контракт.
9. **UI: загрузка списка по режиму, а не при mount.** В inline-режиме API шаблонов не дёргается вовсе (важно: у узла может не быть workflowId); в template — запрос при входе в режим/смене workflow, а upload/delete правят локальный список без полного refetch (дёшево и без мигания селекта).
10. **Upload через `FormData` в `requestAsync`** — KI-479-фикс S3 уже не ставит `Content-Type: application/json` для `FormData`; smoke подтвердил реальный multipart на backend. Отдельная функция `uploadDocumentTemplateAsync` не даёт компоненту собирать HTTP-детали.
11. **Переменные вводятся как JSON-текст с частичной валидацией**: в стор пишется только валидный объект, невалидный текст остаётся в поле и подсвечивается (`template.variablesInvalid`). Пустая строка — «fallback не задан» (очищает `data.variables`), массив/скаляр — ошибка (backend-схема ждёт объект). Это совпадает с `resolveTemplateVariables` (S2).
12. **Права в UI:** удаление и загрузка disabled для `viewer` (backend всё равно вернёт 403, но UI не должен предлагать заведомо неуспешное действие); `accessRole === null` (роль неизвестна) не блокирует — иначе узел был бы мёртв в шаблонах без интеграции ролей.
13. **Переиспользованы хуки узла:** `useNodeDataHistory` (undo/redo), `usePreserveCursor` (KI-157 — JSON-поле не должно прыгать в конец), `useAutoResize` (KI-169). Новых зависимостей/компонентов нет.
14. **i18n — в оба файла** (RULES 1.14): добавлены только недостающие ключи (label режима, uploading/deleteConfirm/deleteError/loadError/needSave/noPlaceholders/variablesFromInput/variablesInvalid); паритетный тест `i18n.spec.ts` зелёный, значения «Не заполнено: …»/«Missing: …» уже были из S0.
15. **Тесты движка — два сценария (успех + чужой шаблон)**, а не дубль executor-тестов: проверяется именно проводка (workflowId из `findWorkflowIdByRunAsync`, deps, logs в `node_runs`); сама логика режима покрыта в `document-generation-executor.spec.ts`, где нет Nest-графа и БД.
16. **`data-*`-атрибуты для smoke** (`data-document-gen-mode`, `data-document-template-select`, `data-document-template-upload`, `data-document-template-placeholders`, `data-document-gen-missing`) — по DESIGN § 3.1.8, чтобы S17 мог проверить UI без хрупких CSS-селекторов.
17. **`DocumentTemplatesService`/`DocumentTemplateService` внедрены в конструктор движка, а не во фабрику** (RULES 1.3, DI только через конструктор); порядок параметров выбран рядом с `DocumentService`/`MEDIA_STORAGE`, чтобы diff был локальным.
18. **Никаких изменений в `RunLeaseService` и миграциях** — S4/S5 не добавляют схемы/колонок; `document_templates`/`lease_expires_at` уже есть (S1). Новых env-ключей нет.

---

## Черновик commit message (не коммитил)

```
feat(v0.11.0): S4+S5 — Document Templates engine and UI

S4 (engine):
- node-executors: DocumentGenerationNodeData → mode/templateId/variables;
  Zod superRefine (template требует templateId, только DOCX);
  DocumentGenerationDeps {documentService, mediaStorage, templateLoader,
  templateRenderer, workflowId}; template-ветка loadAsync(templateId,
  workflowId) → resolveTemplateVariables → renderAsync → лимит 10 МБ →
  saveGeneratedAsync; outputs mode/templateId/templateName/missingVariables,
  warning в logs; inline-контракт не изменён.
- execution-engine: DI DocumentTemplatesService/DocumentTemplateService;
  workflowId запрашивается только для mode=template; logs шага в node_runs.
- Тесты: +9 executor, +2 engine (успех и чужой шаблон), стабы в
  media-storage.integration.spec для DI.

S5 (UI):
- api.ts: list/upload(FormData)/delete document-templates.
- DocumentGenNode: селект режима; шаблоны (list/upload/placeholders/
  delete disabled для viewer), variables (только без входящей связи),
  жёлтая подсказка missingVariables; data-атрибуты для smoke.
- i18n ru/en: 9 ключей; компонентные тесты +12, API +3.

Docs: отчёт reports/v0.11.0/S4-S5-document-templates-engine.md,
reports/README, CHANGELOG (Unreleased → Added).

Refs: DESIGN v0.11 § 3.1.4, § 3.1.7, § 3.1.8, § 5 (S4, S5); KI-479, KI-480.
```
