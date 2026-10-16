# Changelog

Все значимые изменения проекта **IIChatTools AI Workflow Builder** документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/).
Проект придерживается [Semantic Versioning](https://semver.org/lang/ru/).

Типы изменений:
- **Added** — новая функциональность
- **Changed** — изменения в существующей функциональности
- **Deprecated** — функции, помеченные как устаревшие
- **Removed** — удалённая функциональность
- **Fixed** — исправления
- **Security** — исправления уязвимостей и утечек
- **Documented** — задокументированные баги

---
## [Unreleased]

## [0.8.5] — 2026-10-16

**Patch после v0.8.4. Единый источник статусов + паритет-гейт REST-контракта.**

Два подшага.

### Changed

- **Backend — единый источник статусов (KI-353):**
  `run-stream-message.dto.ts` импортирует `NODE_RUN_STATUSES` /
  `WORKFLOW_RUN_STATUSES` из `db/schema.ts`; удалены `@deprecated`-псевдоним
  `RUN_STATUSES` (0 потребителей), локальный вывод списка и дублирующий
  `type NodeRunStatus`. Добавлен `TERMINAL_WORKFLOW_RUN_STATUSES`
  (`['completed','failed'] as const satisfies readonly RunStatus[]`) —
  используется в `run-event.dto.ts`. Миграция не нужна
  (`pnpm db:generate` → No schema changes).

### Added

- **API-паритет-гейт REST-контракта (KI-352):**
  `docs/development/api-contract.json` — source of truth для 4 REST-ответов
  (RunResponse, ShareTokenDto, SharedWorkflow, ExportWorkflowDto); два
  паритет-спека (backend + web); паттерн — из KI-348 (`sse-contract.json`).

### Fixed

- **KI-352** — паритет-гейт REST-контракта (`a889991`).
- **KI-353** — единый источник статусов, удаление `RUN_STATUSES` (`0e5d027`).

### Documented

- **KI-356** — workflow без backend-DTO (Medium).
- **KI-357** — REST-зеркала вне гейта (Medium).
- **KI-358** — REST-ответы без Zod (Low).
- **KI-359** — inline-union'ы финальных статусов (Low).

## [0.8.4] — 2026-10-16

**Patch после v0.8.3. Skip-статус в схеме, skip-семантика подграфов,
`run.error` в SSE-снимке, паритет-гейт backend ↔ web.**

Два подшага после v0.8.3.

### Added

- **Backend — skip в схеме (KI-336):** `WORKFLOW_RUN_STATUSES` (без
  skipped) + `NODE_RUN_STATUSES = [...WORKFLOW_RUN_STATUSES, 'skipped']`;
  типы `RunStatus` / `NodeRunStatus`; `node_runs.status` →
  `$type<NodeRunStatus>()`. Миграция не нужна (колонка text без CHECK).
  `RUN_STATUSES` — `@deprecated`-псевдоним (0 потребителей, удаление
  в v0.8.5).
- **Backend — skip-семантика подграфов (KI-337):** общий хелпер
  `skipBlockedNodesAsync` используется и корневым `executeAsync`, и
  `executeSubWorkflowGraphAsync`; подграф доигрывает независимые ветки
  (симметрия с KI-287/RULES 4.16); `node_runs` и `node_skipped` — с
  префиксом `sub_<nodeId>__`.
- **Backend + web — `run.error` в SSE-снимке (KI-347):**
  `RunSnapshotSchema.error: z.string().nullable()`;
  `runs.service.getRunRowAsync` (owner-check переиспользован);
  `applySnapshot` пишет `runError`.
- **Паритет-гейт backend ↔ web SSE (KI-348):**
  `docs/development/sse-contract.json` — source of truth;
  `src/runs/dto/sse-contract.spec.ts` + `web/src/types/run-stream-contract.spec.ts`
  падают при расхождении. Двойные негативные тесты прошли.

### Fixed

- **KI-336** — `skipped` в схеме, тип колонки `NodeRunStatus` (`ac665b1`).
- **KI-337** — skip-семантика подграфов (`ac665b1`).
- **KI-347** — `run.error` в SSE-снимке (`87455f2`).
- **KI-348** — паритет-гейт backend DTO ↔ web SSE-зеркало (`87455f2`).

### Documented

- **KI-352** — нет паритет-гейта для REST-зеркала `web/src/lib/api.ts`
  (Medium).
- **KI-353** — три источника правды по статусам узла (Medium).
- **KI-354** — дублирование обхода уровней в engine (Low).
- **KI-355** — обречённый подграф доигрывает независимые ветки (Low,
  продуктовое решение).

## [0.8.3] — 2026-10-16

**Patch-серия после v0.8.2. Три параллельных подшага + SSE-зеркало + chunk-fix.**

### Added

- **Frontend — fit readability (KI-314, 328):**
  `FIT_VIEW_OPTIONS.minZoom` 0.02 → 0.005 + новый
  `FIT_SELECTION_OPTIONS = { padding 0.3, maxZoom 1, minZoom 0.1 }`;
  `Shift+F` и кнопка «Вписать выделение».
- **Frontend — кэш списка workflow (KI-302):**
  `web/src/lib/workflow-list-cache.ts` (TTL 5 с + revision + inflightSeq);
  инвалидация в save/import/template/delete; подписка через
  `useSyncExternalStore`.
- **Frontend — SSE-зеркало node_skipped (KI-NEW-B / остаток KI-288):**
  `NODE_RUN_STATUSES = [...RunStatusSchema.options, 'skipped']`;
  `NodeRunStatusSchema` (узел) ≠ `RunStatusSchema` (запуск); вариант
  `node_skipped { runId, nodeId, nodeType, reason, skippedAt }`;
  статус skipped в BaseNode (серый пунктир) и RunResultPanel.
- **Backend — skip-статус для потомков упавших (KI-288, 290):**
  `failedIds`/`skippedIds`, `markNodeSkippedAsync`, `node_skipped` в
  RunEventSchema; предшественники из `executionMap.dependents`.
- **Backend — `http.failOnHttpError` (KI-289):**
  `HttpNodeData.failOnHttpError?: boolean`; при true и status ≥ 400 — failed.
- **Backend — type-aware `handleIdToOutputPort` (KI-301):**
  вторым аргументом `sourceNodeType?`.
- **Infra — type-check spec'ов (KI-317):**
  `tsconfig.spec.json`, `"typecheck": "tsc -p tsconfig.spec.json --noEmit"`,
  шаг `Typecheck` в CI (23 ошибки починены — только в `*.spec.ts`).
- **Infra — `test:parity` (KI-318):**
  `node --env-file=.env node_modules/vitest/vitest.mjs run
  src/db/schema-parity.spec.ts`.

### Fixed

- **KI-288** — skip-статус для потомков упавших (`aacae26`).
- **KI-289** — `http.failOnHttpError` (`aacae26`).
- **KI-290** — fallback-выходы потомков упавших не в outputs (`aacae26`).
- **KI-301** — type-aware `handleIdToOutputPort` (`aacae26`).
- **KI-302** — инвалидация кэша workflow в save (`c6edf91` + `df4f3f0`).
- **KI-314** — `minZoom: 0.005` (`c6edf91`).
- **KI-317** — `typecheck` в CI (`ca21f30`).
- **KI-318** — `test:parity` (`ca21f30`).
- **KI-319** — RULES § 3.19 (`ca21f30`).
- **KI-326** — Vite host `127.0.0.1` (`c6edf91`).
- **KI-328** — fit выделения (`c6edf91`).
- **KI-329** — share wheel/pan (`c6edf91`).
- **KI-334** — `chunkSizeWarningLimit: 710` (`952d8b6`).
- **KI-NEW-B** — фронт-SSE-зеркало `node_skipped` (`df4f3f0`).

### Documented

- **KI-330..351** — 22 новых: share UX (330/331), TTL (332), web lint
  (333), формула (335), RUN_STATUSES/skipped (336), подграфы/condition
  (337/338), retryable http (340), null vs {} (341), thenable-двойник
  (342), e2e-спек (343), test:parity enforcement (344), env-file (345),
  drizzle typecheck (346), run.error в снимке (347), паритет-гейт
  SSE-зеркало (348), TextNode target (349), мягкое зеркало (350),
  401-шум (351).

## [0.8.2] — 2026-10-16

**Patch после v0.8.1. CI-гейт схемы + инкремент version + единые fit-опции.**

Три параллельных подшага после v0.8.1.

### Added
- **Общий модуль fit-опций (KI-306/314/315/316):**
  - `web/src/lib/fit-view-options.ts` — `FIT_VIEW_OPTIONS`
    (`padding: 0.2`, `maxZoom: 1`, `minZoom: 0.02`) — единый источник
    для 5 точек вызова (авто-fit / кнопка Fit / хоткей F в Canvas +
    `fitViewOptions` на публичной share-странице).
- **CI-гейт паритета схемы (KI-298):**
  - `src/db/schema-parity.spec.ts` (new) — сверка
    `information_schema.columns` ↔ Drizzle-схема по всем `pgTable`;
    человекочитаемый отчёт о дрейфе; `describe.skipIf` без `DATABASE_URL`.
  - `.github/workflows/ci.yml` — шаг `Apply migrations` перед `pnpm test`.

### Fixed
- **KI-298** — CI-гейт паритета Drizzle-схемы и Postgres (`df2ea46`).
- **KI-300** — инкремент `workflows.version` при изменении
  `nodes`/`edges` (`8163b73`).
- **KI-315** — публичная share-страница получает `fitViewOptions`:
  CDP-замер zoom 0.154905, оба узла в кадре (`a32023f`).
- **KI-316** — асимметрия fit-операций: хоткей F = кнопка Fit
  (CDP 1.0 = 1.0; до фикса 1.82875) (`a32023f`).
- **KI-314** — `minZoom: 0.02` умещает разброс только до 23 050 px
  (Low, Open — фикс отложен, читаемость в KI-328).

### Documented
- **KI-317** — spec-файлы не проходят type-check ни на одном шаге
  (26 ошибок на HEAD).
- **KI-318** — Vitest не читает `.env` → гейт KI-298 локально silently
  skipped.
- **KI-319** — CI: шаг `Apply migrations` стал обязательным.
- **KI-320** — паритет-гейт требует ручного маппинга типов колонок.
- **KI-321** — гейт не сверяет length/order/constraints.
- **KI-322** — подграф вне топ-50 `GET /workflow` → warning недостижим.
- **KI-323** — TOCTOU: два конкурентных PATCH → `version +2`.
- **KI-324** — frontend hash vs backend deep-equal (`type`).
- **KI-325** — `updatedAt` меняется на идемпотентном PATCH.
- **KI-326** — Vite dev слушает только `[::1]:5173`.
- **KI-327** — `AUTH_DISABLED=true` не обходит `POST /auth/refresh`.
- **KI-328** — fit по bbox даёт микроскопические узлы (4–6 px при
  разбросе 21 888 px).
- **KI-329** — share `pointer-events-none` блокирует zoom/pan.

## [0.8.1] — 2026-10-16

**Patch-релиз после v0.8.0. Структурный фикс Vite-прокси.**

### Added
- **Единый реестр API-префиксов (KI-299/072/120):**
  - `web/src/lib/api-prefixes.ts` — `API_PREFIXES`
    (workflow/engine/llm/media/auth/templates/runs/nodes; флаги
    `sse` и `htmlFallback`).
  - `web/vite.config.ts` — `server.proxy` генерируется из реестра.
  - Frontend spec: все `fetch`-литералы ∈ реестр.
  - Backend spec: все `@Controller` ⊆ реестр; `stripComments()`
    против ложных срабатываний на комментариях.
  - `web/tsconfig.node.json`: `allowImportingTsExtensions: true`
    (Vite 8 configLoader: 'native').
  - Tests: backend 514 → 520 (+6), frontend 159 → 166 (+7).
  - Smoke: 22/22 PASS.

### Fixed
- **KI-306** — `fitView` для графов с большим разбросом координат:
  `FIT_VIEW_OPTIONS.minZoom: 0.02` в `useEffect`, хоткее F,
  `<ReactFlow fitViewOptions>`, `<Controls fitViewOptions>`
  (`5fc4f34`).
- **KI-307** — `autoPanOnNodeDrag` — остаётся by design (Low).

### Documented
- **KI-309** — `minZoom: 0.02` умещает разброс только до 23 050 px.
- **KI-310** — публичная share-страница без fitViewOptions.
- **KI-311** — асимметрия Fit (1.0) vs хоткей F (1.53).

## [0.8.0] — 2026-10-16

**v0.8.0 — фичи для продукта (DESIGN v0.8 § 1–13).**

7 подшагов R6.1..R6.7: Auth, Share, LLM upgrade, Canvas UX,
Node types, Export/Import/Templates, Sub-workflows.
Закрывает 16 KI v0.8 (KI-106, 108, 109, 183, 185–195, 197) + KI-200.

Всего с v0.7.2: 294 KI в реестре; Fixed 111; backend 514/514,
frontend 159/159.

### Added
- **Auth backend (R6.1a, KI-201):**
  - Миграция 0004: `users` (uuid), системный пользователь
    `00000000-0000-0000-0000-000000000001`
    (`system@workflow-builder.local`), `workflows.user_id`
    **text → uuid** с backfill (65 строк), `share_token` (задел R6.2).
  - `AuthService` — register / login / me, scrypt (node:crypto),
    `JwtService.signAsync`.
  - `JwtAuthGuard` (кастомный, `@nestjs/jwt`) + `@CurrentUser`.
  - `AuthController`: `POST /auth/register`, `POST /auth/login`,
    `GET /auth/me`.
  - `AUTH_DISABLED=true` (dev/CI) → системный пользователь.
  - `WorkflowController` / `RunsController`: guards; владелец —
    только из токена.
  - Env: `JWT_SECRET` (min 32), `JWT_EXPIRES_IN`, `AUTH_DISABLED`.
  - CI: `JWT_SECRET` + `AUTH_DISABLED` в шаге `pnpm test`.
  - Tests: 358 → 380 (+22).
- **Auth — refresh-token + logout (R6.1b.1):**
  - Миграция 0005: `refresh_tokens` (uuid, sha256-хэш, cascade FK,
    2 индекса).
  - `AuthService`: create / verify / rotate / revoke.
  - `AuthController`: `POST /auth/refresh`, `POST /auth/logout`.
  - httpOnly cookie (sameSite=strict, path=/auth, secure в prod).
  - Env: `JWT_REFRESH_EXPIRES_IN`, `COOKIE_SECURE`.
  - `cookie-parser` в deps.
  - Tests: 380 → 396 (+16).
- **Auth — fail-fast `AUTH_DISABLED` в prod (R6.1b.1-hotfix):**
  - `EnvSchema.superRefine` — `NODE_ENV=production` + `AUTH_DISABLED=true`
    → отказ старта.
  - Tests: 396 → 400 (+4).
- **Auth — frontend (R6.1b.2):**
  - `stores/auth.ts` — zustand, access-токен в ПАМЯТИ (не localStorage).
  - `lib/api.ts` — 401-интерцептор: refresh + retry (single-flight
    Promise, защита от StrictMode double-effect).
  - `lib/auth-api.ts` — login / register / refresh / logout.
  - `components/auth/` — AuthProvider (bootstrap), LoginPage,
    ProtectedRoute.
  - `main.tsx` — BrowserRouter (react-router-dom v7) + AuthProvider.
  - `App.tsx` — Routes: `/login`, `/` (ProtectedRoute).
  - `TopBar` — user-menu (email, logout).
  - Vite proxy: + `/auth`.
  - i18n: 15 ключей `auth.*` (ru/en 121/121).
  - Frontend tests: 15 → 24 (+9).
- **Frontend Auth — fix ?workflowId= после router (R6.1b.2-fix):**
  - ProtectedRoute сохраняет search при редиректе на /login.
  - LoginPage возвращает на / с сохранённым search.
  - App читает `?workflowId=` через `useSearchParams()` +
    эффект на [workflowIdParam, authStatus].
- **Share workflow (R6.2.1, backend, KI-197):**
  - `POST /workflow/:id/share` — owner → создать/обновить `share_token`
    (генерация в БД: `gen_random_uuid()`).
  - `DELETE /workflow/:id/share` — owner → revoke.
  - `GET /workflow/share/:token` — публичный, без auth, read-only;
    ответ без `userId` / `shareToken` / `updatedAt`.
  - Owner-check переиспользует `buildAccessFilter`; чужой → 404.
  - +12 тестов (400 → 412).
- **Share workflow — frontend (R6.2.2, KI-197):**
  - `TopBar` — кнопка «Поделиться» (disabled без `currentWorkflowId`).
  - `ShareModal` — создать / копировать / отозвать; предупреждение
    KI-233 («По ссылке будут видны все данные графа»).
  - `ShareViewPage` — route `/workflow/share/:token` (без
    ProtectedRoute); read-only ReactFlow + баннер «Только просмотр».
  - `lib/share-api.ts`, `lib/share-url.ts` (+ spec), `stores/share.ts`.
  - Vite: `/workflow` bypass на `/index.html` для `Accept: text/html`.
  - i18n: 14 ключей `share.*` (ru/en 135/135).
  - Frontend tests: 24 → 29 (+5).
- **LLM upgrade — backend (R6.3.1, KI-183/192/193):**
  - `LlmGenerateOptions` — `reasoningEffort: 'off' | 'medium' | 'high'`
    (system / maxTokens уже были).
  - `ModelInfo` — `supportsReasoning?`, `defaultMaxTokens?`.
  - OpenAI-совместимый: `reasoning_effort` через типизированное поле
    SDK; 'off' → поле не отправляется; `max_tokens` приоритет:
    options → ModelInfo → 1024.
  - Anthropic: `system` / `max_tokens` как раньше; reasoning — warn
    (extended thinking — v0.8.x).
  - `LlmNodeExecutor`: `data.systemPrompt` / `data.reasoningEffort` /
    `data.maxTokensOverride` → options; логируются только длины.
  - Env-формат: `<id>:<modalities>[:reasoning]`; reasoning-модели
    → `supportsReasoning=true` + `defaultMaxTokens=4096`.
  - `llm-registry`: пропускает новые поля в `GET /llm/models`.
  - +16 тестов (412 → 428).
- **LLM upgrade — frontend (R6.3.2, KI-183/192/193):**
  - `LlmNodeData` += `systemPrompt?`, `reasoningEffort?`,
    `maxTokensOverride?`.
  - `LLMNode` — сворачиваемый System prompt; `<select>` Reasoning
    (только при `supportsReasoning === true`); `<input>` Max tokens
    (placeholder = defaultMaxTokens).
  - `lib/llm-node-fields.ts` — REASONING_EFFORTS + валидаторы.
  - `lib/api.ts` — Zod-схема += `supportsReasoning` / `defaultMaxTokens`
    (иначе strip — KI-149).
  - `nodeDataFromApi` — переносит новые поля (паттерн KI-129).
  - i18n: 10 ключей `node.llm.*` (ru/en 145/145).
  - Frontend tests: 29 → 33 (+4).
- **Canvas UX part 1 (R6.4a):**
  - `edges/InsertableEdge.tsx` — кнопки «+»/«×» на связи (BaseEdge +
    interactionWidth + EdgeLabelRenderer).
  - `hooks/use-hotkeys.ts` — Ctrl+D (расширится в R6.4b).
  - `hooks/use-debounced-effect.ts` — auto-save 3000 мс.
  - `lib/graph-hash.ts`, `lib/graph-edit.ts`, `lib/graph-guides.ts`.
  - `snapToGrid + snapGrid=[8,8]` + направляющие в `<ViewportPortal>`.
  - Индикатор «✓ Сохранено / ● Есть изменения» в TopBar.
  - Frontend tests: 29 → 40 (+11).
- **Canvas UX part 2, подшаг 1 (R6.4b.1):**
  - `useHotkeys` — обратно-совместимый API (`HotkeyBinding` с
    `preventDefault` / `stopPropagation` / `allow`); приоритет
    `ctrl+*` → `shift+*` → одиночные — на этапе подписки.
  - `lib/hotkeys-utils.ts` + 18 тестов (чистый парсер).
  - `stores/workflow`: `canvasMode` / `showMinimap` / `isCatalogOpen`
    + localStorage.
  - Canvas: S (cursor), H (hand), F (fit view), M (minimap),
    Tab (каталог); `panOnDrag` / `selectionOnDrag`; курсор.
  - Условный `<MiniMap />` + панель режимов слева внизу.
  - Toolbar: каталог → `isCatalogOpen` из стора.
  - Frontend tests: 43 → 61 (+18).
- **Canvas UX part 2, подшаг 2a (R6.4b.2a):**
  - Тип узла `comment` (NODE_REGISTRY, `canBeInsertedOnEdge: false`).
  - `CommentNode` — стикер без Handle, `usePreserveCursor` +
    `useAutoResize`.
  - Хоткеи C / Shift+C (создать в центре / toggle visibility).
  - `lib/graph-payload.ts` — фильтр local-only узлов (Save/Plan).
  - CSS: `--color-comment-bg/-border/-foreground`.
  - i18n: `node.comment.label` / `.placeholder` (ru/en 154 → 156).
  - Frontend tests: 61 → 66 (+5).
  - **Остаток:** KI-266 — комментарии не персистятся (F5 → исчезают).
- **Engine — executors новых узлов (R6.5.1, KI-105):**
  - `http` — AbortSignal.timeout (30s default, cap 120s), body только
    для не-GET, ответ обрезается до 1 МБ по границе UTF-8, 4xx/5xx
    не бросают (возвращают `{ status, body }`).
  - `condition` — MVP-DSL (`>`, `<`, `>=`, `<=`, `===`, `includes`)
    без `new Function`. Маршрутизация веток — v0.8.x.
  - `output` — пропускает первое непустое входное значение под ключом
    `data.name`.
  - `compare` — `mode: 'diff'` (построчный diff, без библиотек).
  - `NodeDataValidationException extends UnsupportedNodeTypeException`.
  - `node-ports.ts`: контракты http/condition/output; compare намеренно
    без контракта (KI-278).
  - Tests: 438 → 479 (+41).
- **Engine — frontend узлов http/condition/output/compare (R6.5.2):**
  - `NodeType` += 4; `HttpNodeData` / `ConditionNodeData` /
    `OutputNodeData` / `CompareNodeData`; `AppNode` += 4.
  - 4 компонента: HttpNode (метод/URL/body/timeout), ConditionNode
    (2 выхода T/F), OutputNode (0 выходов, имя), CompareNode
    (2 входа a/b, mode=diff).
  - `NODE_REGISTRY` — 4 записи (tools / tools / output / ai);
    `canBeInsertedOnEdge: true`.
  - `BaseNode` — новый проп `dataNodeAttr` (аддитивно).
  - i18n: 27 ключей `node.{http,condition,output,compare}.*`
    (ru/en 158 → 185).
  - Frontend tests: 101 → 132 (+31).
- **Export / Import / Templates (R6.6.1, KI-108/109):**
  - `GET /workflow/:id/export` — JSON `{ version: 1, name, nodes,
    edges, exportedAt }` (без userId / shareToken / id).
  - `POST /workflow/import` — создать workflow из артефакта.
  - `GET /templates` + `POST /templates/:id/instantiate`.
  - `src/templates/*.json` — 3 шаблона (text-llm, text-llm-image,
    http-llm); handle IDs сверены с node-ports.ts.
  - `TemplateLoaderService` — fail-soft, два кандидата каталога.
  - Tests: 482 → 498 (+16).
- **Engine — продолжение независимых уровней (R6.5.2-fix, KI-287):**
  - Убран `break` в `executeAsync`; план проходится до конца.
  - Зависимые узлы получают `null` и падают сами (вариант A).
  - Tests: 479 → 482 (+3).
- **Frontend Export / Import / Templates (R6.6.2, KI-108/109):**
  - `TopBar` — 📥 «Скачать JSON» (disabled без сохранённого workflow),
    📤 «Импорт» (скрытый `input[type=file]`).
  - `LoadModal` — вкладки «Мои workflow» / «Шаблоны», карточки с
    `data-template-id`.
  - `lib/export-import-api.ts` (Zod-схемы + API-функции +
    `parseExportedWorkflowFile`).
  - `lib/download-blob.ts` (санитайз имени файла + triggerDownload).
  - i18n: +14 ключей (ru/en 185 → 199).
  - Vite proxy: `/templates` (KI-299).
  - Frontend tests: 132 → 144 (+12).
- **Sub-workflows (R6.7, KI-200):**
  - Backend: тип `sub_workflow`, `SubWorkflowNodeData` (workflowId,
    version?, inputsMap?); executor `executeSubWorkflowNode` (рекурсия
    branch-local `visitedWorkflows`, max depth 5, owner-check → 404);
    `executeSubWorkflowGraphAsync` (префикс id `sub_<nodeId>__`,
    собственный plan, тот же runId); результат — плоский `{ result }`
    из терминалов подграфа.
  - Frontend: NodeType += `'sub_workflow'`; категория `composition`;
    `SubWorkflowNode` (селект своих workflow, «Открыть в редакторе»,
    warning «новая версия»); i18n +10 (199 → 209).
  - Tests: backend 498 → 514 (+16), frontend 144 → 159 (+15).
  - Smoke: nested workflow (Save/F5/Load), Run с inner-узлами, рекурсия
    C→C → failed, «Открыть в редакторе», индикатор версии.
- **fitView после загрузки workflow + панель над миникартой
  (R6.5.2-fix2):**
  - `fitView={isEmpty}` заменён на `useEffect` с ref-защитой
    (устранена race condition при `true→false`).
  - Панель режимов перенесена в `right-6` + адаптивный
    `bottom-44`/`bottom-6`.
    
### Fixed
- **KI-201** — Auth backend (R6.1a): users, JWT-guard, `/auth/*`,
  scrypt; остаток R6.1b.1/R6.1b.2 — refresh-token, logout, frontend
  (`88f53e4`, `4b1c149`, `316c680`).
- **KI-202** — owner на `GET /runs/:id` и `/stream`; чужой run → 404
  (`4b1c149`).
- **KI-204** — `userId` удалён из `CreateWorkflowSchema` и
  `ListWorkflowsQuerySchema`; владелец — только из токена
  (`4b1c149`).
- **KI-205** — `migrate.ts` не логирует `DATABASE_URL` с паролем
  (`4b1c149`).
- **KI-213** — fail-fast `AUTH_DISABLED=true` в production
  (`7e921a7`).
- **KI-228** — `?workflowId=` терялся при миграции на react-router
  (три звена: ProtectedRoute, LoginPage, App) (`4eb4664`).
- **KI-197** — публичный share workflow (backend + frontend):
  `share_token`, `POST/DELETE /workflow/:id/share`, публичный
  `GET /workflow/share/:token`; ShareModal + ShareViewPage; Vite
  bypass для SPA (`ae5e461`, `abf88ff`).
- **KI-183** — maxTokens для reasoning-моделей: `ModelInfo.defaultMaxTokens`
  + env-суффикс `:reasoning` → 4096 (`283ce94`).
- **KI-192** — System prompt у LLM-узла (backend) (`283ce94`).
- **KI-193** — Reasoning mode (backend) (`283ce94`).
- **KI-185** — вставка узла в связь по паттерну React Flow
  (`fcd2913`).
- **KI-189** — направляющие (соседи из стора + ViewportPortal)
  (`fcd2913`).
- **KI-258** — каталог вставки: `w-72` + `placement="down"`
  (`fcd2913`).
- **KI-259** — `addNodeOnEdge`: тип без входного порта больше не удаляет
  связь; `NODE_REGISTRY.canBeInsertedOnEdge` + фильтр каталога
  (R6.4a-fix5).
- **KI-260** — `addNodeOnEdge`: узел вставляется по центру связи
  (`insertPositionOnEdge`, размер — `measured` узла того же типа)
  (R6.4a-fix5).
- **KI-261** — `addNodeOnEdge`: notice `canvas.edge.gone`, если связь
  уже удалена (R6.4a-fix5).
- **KI-188** — Cursor / Hand режимы (S / H) + `canvasMode`
  (`e923384`).
- **KI-190** — Minimap toggle (hotkey M + кнопка) (`e923384`).
- **KI-265** — путь репозитория в PROMPT_V5.md приведён к
  `D:\Projects\AI\workflow-builder` (docs-коммит).
- **KI-271** — запуск переживает F5: `?runId=` в URL восстанавливает
  подписку на SSE-поток; `RunStreamUnavailableError` отличает
  «запуска нет» (404/401 → сброс) от сетевого сбоя
  (`531a062`).
- **KI-245** — единый источник лимитов токенов
  (`llm-constants.ts`) (`bec48bf`).
- **KI-246** — `ReasoningEffort` расширен до
  `minimal`/`low`/`xhigh` (тип возврата `resolveReasoningEffort` —
  `Exclude<ReasoningEffort, 'off'>`) (`bec48bf`).
- **KI-247** — лог движка различает `выполнено`/`провалено`
  (`bec48bf`).
- **KI-186** — расширенный список хоткеев
  (S/H/F/M/Tab/C/Shift+C/Ctrl+D/Ctrl+Z/Ctrl+Shift+Z) (`e923384`,
  `2efe3f3`).
- **KI-217** — `@types/express` в devDeps (правка не потребовалась —
  уже был) (`4a214f7`).
- **KI-220** — `COOKIE_SECURE=false` в production → отказ старта
  (`4a214f7`).
- **KI-221** — `NODE_ENV=staging`/`preprod` считаются prod-подобными
  (`4a214f7`).
- **KI-236** — `workflows.createdAt/updatedAt` → `.notNull()` +
  `withTimezone` (`4a214f7`).
- **KI-274** — `matchesHotkey`: `ctrl+*` биндинги не срабатывали
  (критично — не работал `Ctrl+D`/`Ctrl+Z`) (`2efe3f3`).
- **KI-105** — узлы `http` / `condition` / `output` / `compare`
  (backend + frontend) (`1e89cdd`, `c4f2792`).
- **KI-287** — продолжение независимых уровней после падения узла
  (`987bc5a`).
- **KI-108** — Export / Import / Templates (`12ff041`).
- **KI-109** — Export / Import / Templates (`12ff041`).
- **KI-293** — timestamptz-дрейф: миграция 0006 + 4 колонки
  `withTimezone: true` в схеме; API возвращает UTC-корректные даты
  (`e5f489a`).
- **KI-296** — `workflows.created_at/updated_at`: `SET NOT NULL` +
  `SET DEFAULT now()` в 0006 (`e5f489a`).
- **KI-299** — Vite-прокси для `/templates` (`27cbc14`).
- **KI-200** — Sub-workflows (backend + frontend, `699772f`).
- **KI-306** — `fitView` при большом разбросе координат
  (minZoom) — заведён, v0.8.1.
- **KI-307** — `autoPanOnNodeDrag` — заведён, v0.8.1.

### Documented
- **Gap-анализ GPTunnel (2026-10-15) — новые KI для v0.8/v0.9:**
  - **v0.8 Canvas UX:** KI-185 (вставка узла в связь),
    KI-186 (расширенные хоткеи), KI-187 (комментарии),
    KI-188 (курсор/рука), KI-189 (направляющие/snap),
    KI-190 (миникарта-toggle), KI-191 (дублировать узел).
  - **v0.8 LLM:** KI-192 (System prompt), KI-193 (Reasoning mode).
  - **v0.8 прочее:** KI-194 (Note/Compare), KI-195 (auto-save).
  - **v0.8 Share:** KI-197 (публичная read-only ссылка).
  - **v0.9:** KI-196 (медиа-инструменты: upscale, bg-removal,
    lipsync, 3D, motion).
  - **KI-107 не тронут:** в KNOWN_ISSUES.md это «Параллельные
    media-узлы и rate limit», а не Share — детали Share
    заведены отдельным KI-197.
  - **KI-202..208** — Auth-остаток: `GET /runs/:id` без owner (🔴
    Critical), FK на users, `userId` в DTO, `migrate.ts` логирует
    URL, rate-limit/refresh/logout, scrypt-параметры,
    `@nestjs/passport` в deps.
  - **KI-209..212** — коллизии нумерации KI (CHANGELOG `[0.1.0]`
    использует KI-номера как идентификаторы фич), «Passport»-формулировки
    в DESIGN § 1/§ 3.1, пропуск KI-198/199, ошибочная ссылка на KI-106
    в сообщении коммита `88f53e4` (аннотирована через `git notes`).
  - **KI-214..222** — Auth/DB-остаток v0.8.x: нет индекса на
    `workflows(user_id)` (Medium), `refresh_tokens` не чистится
    (Medium), нет family-revocation на reuse (Medium),
    `COOKIE_SECURE=false` в prod (Medium), `@types/express`
    транзитивный, нет тестов `parseDurationToMs`, `revoked_reason`
    отсутствует, staging-NODE_ENV, edge-cases env-схемы.
  - **KI-223..227, 229..232** — Auth UX + router-остаток v0.8.x:
    bootstrap 401 vs сеть (Medium), logout best-effort (Medium),
    маппинг 400 в LoginPage, красный 401 в консоли, `meAsync` +
    alias `@/`, `syncWorkflowUrlParam` через `replaceState`,
    тесты на ProtectedRoute/App (jsdom), multi-tab refresh-rotation
    (Medium), Welcome screen с шаблонами (Medium, после KI-109).
  - **KI-233..243** — Share-остаток v0.8.x: sanitize публичного
    ответа (Medium), rate-limit публичных ручек (Medium, вместе с
    KI-206), бессрочность + аудит ссылки, `.notNull()` на
    `createdAt`/`updatedAt`, перевыпуск токена без предупреждения,
    SPA-proxy в prod (High, KI-238), предупреждение о перевыпуске
    в UI, read-only node-карточки, Zod-валидация графа в
    ShareViewPage, сообщение о сбое copy, реализация allow-copy
    (R6.6).    
  - **KI-244..247** — LLM-остаток v0.8.x: Anthropic-модели
    захардкожены (Medium), лимит токенов в трёх местах (Low),
    ReasoningEffort покрывает только off/medium/high (Low),
    лог движка «узлов=0» (Low).
  - **KI-248..251** — frontend LLM-остаток v0.8.x: `reasoningEffort`
    не сбрасывается при смене модели, union в 3 местах,
    placeholder без пояснения, нет unit-теста на `nodeDataFromApi`.
  - **KI-252..255, 259..261** — Canvas UX-остаток: узлы из Toolbar
    вне сетки, хэш на каждом изменении, Ctrl+D фокус на копию,
    structuredClone, addNodeOnEdge без входного порта (High),
    позиция узла, молчание при отсутствующей связи.    
  - **KI-262..263** — Canvas UX-остаток: `canBeInsertedOnEdge` не
    синхронизирован с Handle в компоненте (Low), перекрытие при
    тесной раскладке (Medium).
  - **KI-264** — заметка о смоук-харнессе CDP (узкий Fetch-перехват +
    `windowsVirtualKeyCode`).
  - **KI-266** — комментарии не персистятся (backend роняет run на
    незнакомом типе, `UnsupportedNodeTypeException`).
  - **KI-267** — `loadWorkflowAsync` при ошибке схемы молчит в консоль.
  - **KI-266** — комментарии-стикеры персистятся: backend исключает
    аннотации из плана выполнения (`ANNOTATION_NODE_TYPES`),
    frontend больше не отсекает `comment` при Save/Plan
    (`55beb6d`).
  - **KI-187** — комментарии/аннотации на холсте (`55beb6d`).
  - **KI-268** — SSE-поток запуска авторизуется через `fetch`
    с Bearer-заголовком (`ReadableStream`); `EventSource` не умеет
    заголовки → 401 при `AUTH_DISABLED=false`
    (`5374164`).  
  - **KI-271** — после F5 посреди запуска прогресс не восстанавливается
    (Medium).
  - **KI-272** — `onFatalError` потока не снимает «выполняется» (Low).
  - **KI-273** — расширенные хоткеи (Ctrl+A/C/V/S, Shift+Backspace) —
    отложены в v0.8.x (не критично для MVP).    
  - **KI-275** — CDP-смоук: hidden-страница молча отбрасывает OS-ввод
    (Medium).
  - **KI-276** — Ctrl+Z не работает при фокусе в поле ввода узла (Low).
  - **KI-277** — Load не чистит историю undo (Low).
  - **KI-284** — вставка compare в связь теряет операнды (Medium).
  - **KI-285** — обрезка полей в карточках новых узлов (Low).
  - **KI-286** — CDP-смоук: Ctrl+A вставляет символ; каталог требует
    scrollIntoView (Low).
  - **KI-287** — движок прерывает независимые уровни после первого
    падения (Medium, противоречит RULES 4.16).
  - **KI-288** — нет skipped-статуса (Medium).
  - **KI-289** — http не считает 4xx/5xx ошибкой (Medium).
  - **KI-290** — outputs с fallback от потомков упавших (Medium).
  - **KI-291** — workflows.version не в артефакте (Low).
  - **KI-292** — nest-cli assets для templates (Medium).
  - **KI-293** — timestamptz дрейф: API отдаёт дату на 3ч раньше
    (🟠 High).
  - **KI-294** — ImportSchema.name без max(200) (Low).
  - **KI-295** — WorkflowController Async-стиль (Low).
  - **KI-297** — устаревший комментарий в `findSharedAsync` (Low).
  - **KI-298** — `drizzle-kit generate` не сверяет схему с БД
    (Medium, корень KI-293/296).
  - **KI-300..305** — Sub-workflows-остаток: version не
    инкрементится, type-aware резолвер портов, кэш workflow, inputsMap,
    префиксные id в SSE/outputs, пустой подграф.

## [0.7.2] — 2026-10-15

**Patch-релиз после v0.7.1. Yandex env + LM Studio auto-discovery + LLM/media фиксы.**

### Added
- **Интеграции — Yandex env + LM Studio auto-discovery (KI-174/175/176/088):**
  - `YANDEX_MODELS` (env): формат `<id>:<modalities>` (короткие id +
    `YANDEX_FOLDER_ID` или полные `gpt://<folder>/<model>/<version>`).
    Парсер `parseYandexModels`. Vision через `:text+vision`.
  - `MODEL_PRICING` — yandexgpt-lite / yandexgpt / yandexgpt-32k /
    qwen3.6-35b-a3b. `bareModelId()` извлекает id из URI.
  - LM Studio: `createProvidersAsync` + `GET /v1/models` при старте.
    Env `LMSTUDIO_MODELS` — приоритет для модальностей; API — источник
    каталога. API недоступен → fallback на env.

### Fixed
- **KI-179** — LLM: fallback `reasoning` при пустом `content`;
  явная ошибка «LLM вернул пустой ответ (finish_reason=X)» (`675ca23`).
- **KI-180** — textarea для prompt в LLM-узле (auto-resize, i18n,
  backend fallback `inputs.prompt` → `data.prompt`) (`675ca23`).
- **KI-181** — media: схема принимает объектную форму ошибки
  (EXCEPTION от GPTunnel); падение yandex-art на стороне
  провайдера видно пользователю (`675ca23`).

### Documented
- **KI-182** — не баг кода (старый `.env`); добавлено 5 тестов на
  группировку моделей (`675ca23`).
- **KI-174, KI-175, KI-176** — Yandex AI Studio: env-формат каталога
  моделей (по образцу `LMSTUDIO_MODELS`), vision-модальность
  `qwen3.6-35b-a3b` (потеряна в v0.7.1), цены в `MODEL_PRICING`.
  Уточнён KI-172. Инсайт после пользовательской настройки Yandex.

## [0.7.1] — 2026-10-14

**Patch-релиз после v0.7.0. 19 KI закрыто + 9 новых Open.**

Пакеты фиксов:
- Интеграции: Yandex (реальный URI + folder_id), media-дефолт
  (flux-schnell), LMSTUDIO_MODELS id, единый источник prompt.
- UX: удаление edges/nodes, кнопка «Новый workflow»,
  word-wrap панели, auto-resize textarea, tooltips, миникарта.
- Метрики: cost_rub/tokens/cost_usd в node_completed/node_failed
  (панель без F5), cost_usd = 0 для LM Studio, формат USD.
- Run: авто-Save перед Run (устаревший snapshot).
- Ввод: сохранение курсора в контролируемых полях.

### Fixed
- **KI-075** — метрики в `node_completed`/`node_failed` (`84532f1`,
  `684211f`): cost_rub / tokensIn / tokensOut / costUsd / logs.
- **KI-147** — Run всегда Save перед запуском (`47d577f`).
- **KI-148** — cost_usd = 0 для локальных провайдеров (`f200c42`).
- **KI-149** — frontend читает метрики события (`684211f`).
- **KI-151** — формат USD с 2 знаками (`58d5672`).
- **KI-154** — дефолт media-модели: text-to-image, не bgremover
  (`29f4e19`).
- **KI-156** — LMSTUDIO_MODELS id совпадают с LM Studio
  (`29f4e19`).
- **KI-157** — сохранение курсора в контролируемых полях
  (`702d849`).
- **KI-158** — миникарта: контраст + border (`474a93f`).
- **KI-159** — Yandex URI `gpt://<folder>/<model>/latest`
  (`29f4e19`).
- **KI-160** — textarea для prompt в ImageGen (`474a93f`).
- **KI-162** — удаление edges через Delete/Backspace (`9d2f6bf`).
- **KI-163** — кнопка удаления node (`9d2f6bf`).
- **KI-164** — кнопка «Новый workflow» (`9d2f6bf`).
- **KI-165** — word-wrap в панели результата (`474a93f`).
- **KI-166** — единый источник prompt (`29f4e19`).
- **KI-167** — tooltips Controls React Flow локализованы
  (`474a93f`).
- **KI-168** — tooltip кнопки сворачивания панели (`474a93f`).
- **KI-169** — auto-resize textarea в узлах (`474a93f`).

### Added
- **Frontend тесты выросли с 2 до 10** — добавлены на чистые
  функции (`pickDefaultMediaModel`, форматтеры).
- **Backend тесты: 325 -> 341** (+16).

## [0.7.0] — 2026-10-14

**UI-срезы v0.7: тёмная тема, i18n, каталог узлов, уборка типов.**

Backend не менялся. Frontend — 4 подшага:
- R5.1: уборка типов (KI-129) + реестр на labelKey.
- R5.2: тёмная тема (KI-125, KI-132, KI-134).
- R5.3: i18n RU/EN (KI-126, KI-137, KI-141, KI-142) + CI job web.
- R5.4: каталог узлов (KI-127).

### Added
- **Frontend — v0.7.0 / R5.4: каталог узлов (KI-127):**
  - `web/src/components/NodeCatalogPopover.tsx` (новый) — поповер
    каталога: секции из `NODE_REGISTRY` по `category`, порядок из
    `NODE_CATEGORIES`, только непустые секции (`input`/`ai`/`media`).
    Поиск (i18n-aware), клавиатура (↑/↓ по кругу, Enter, Esc, `/`,
    клик вне).
  - `Toolbar`: кнопка «+» (`data-catalog-toggle`).
  - 9 ключей `catalog.*` (ru/en 84 -> 93, паритет-тест).
  - Bundle 585 -> 589 kB.
- **Frontend — v0.7.0 / R5.3: i18n RU/EN (KI-126, KI-137, KI-141,
  KI-142):**
  - `react-i18next` + `i18next`. `web/src/i18n/index.ts` —
    инициализация, `detectInitialLanguage` (localStorage ->
    navigator.language -> 'ru'), `setLanguage` (язык + localStorage
    + `<html lang>`).
  - `web/src/i18n/ru.json` + `en.json` — 84 ключа, паритет-тест
    (`i18n.spec.ts`, 2/2).
  - `node-registry`: `tLabel` / `TEMP_LABELS` удалены,
    `nodeLabelOf` -> `i18n.t()`.
  - Компоненты (`TopBar`, `Toolbar`, `BaseNode`, `TextNode`,
    `LLMNode`, `ImageGenNode`, `RunResultPanel`, `LoadModal`) —
    на `useTranslation()` + `t()`; `stores/workflow.ts` -> `i18n.t()`.
  - `TopBar`: кнопка RU/EN.
  - **CI job `web`** (install + build + test) — закрывает KI-005
    (frontend в CI) и KI-068 (frontend-тесты) частично.
  - Bundle 528 -> 585 kB (+56 kB i18next).
- **Frontend — v0.7.0 / R5.2: тёмная тема (KI-125, KI-132):**
  - `web/src/styles/theme.css` (новый) — `@theme` (светлая) +
    `.dark` (тёмная): CSS-переменные для background/foreground/
    muted/border/primary/canvas/node + маппинг React Flow
    (`--xy-*`: edge-stroke, background-pattern, controls, minimap,
    edge-label).
  - `web/src/hooks/use-theme.ts` (новый) — `useTheme()`:
    light/dark/system, `localStorage.theme`, реактивная подписка
    на `matchMedia`, класс `.dark` на `<html>`.
  - `web/index.html` — inline-script до bundle, против вспышки.
  - `TopBar` — кнопка ☀/🌙.
  - Компоненты (`TopBar`, `Toolbar`, `BaseNode`, `RunResultPanel`,
    `LoadModal`, `Canvas`) и узлы (`TextNode`, `LLMNode`,
    `ImageGenNode`) переведены на переменные.
  - Инпуты узлов — темизированы; фокус `focus:border-primary
    focus:ring-1 focus:ring-primary` (R5.2.1/R5.2.2/R5.2.3).
  - RULES 4.32: `color-mix()` вне `@theme` эмитится как невалидный
    `theme(…)` — такие значения держать отдельной переменной в
    `@theme`/`.dark` (KI-134).

### Changed
- **Frontend — v0.7.0 / R5.1: уборка типов и реестр на labelKey
  (KI-129):**
  - `NodeData` — дискриминированный union по `kind`
    (`TextNodeData | LlmNodeData | ImageGenNodeData`), `kind`
    обязателен. Подтипы `extends Record<string, unknown>` (требование
    React Flow и API-слоя).
  - `createNode` / `nodeDataFromApi` — явные `case` без `default:`;
    новый тип узла поймает tsc.
  - `imageUrl` в `nodeDataFromApi` добавляется условно — без
    `undefined`-ключей в JSON и в `Object.keys`.
  - `NODE_REGISTRY` — `labelKey` вместо `label`/`labelEn`, `icon`
    (эмодзи) вместо `iconEmoji` + `label`. `as const satisfies
    Record<NodeType, NodeRegistryEntry>`.
  - `capabilities: { externalState, userConfig }` — задел под
    KI-128.
  - `NODE_CATEGORIES` — 5 категорий (`input / ai / media / tools /
    output`), `image_generation` → `media`.
  - `Toolbar` и узлы — `tLabel(NODE_REGISTRY[type].labelKey)`;
    временный RU до R5.3 (react-i18next).

### Fixed
- **Root vitest excludes web/ (KI-137):** после R5.3 корневой
  `pnpm test` подхватывал `web/src/i18n/i18n.spec.ts` (327/327
  вместо 325/325). `include` сужен до `src/` + `test/`, добавлен
  `exclude: ['web/**']`.
- **CI: pnpm version в job web (KI-141):** `pnpm/action-setup@v4`
  падал с `Multiple versions of pnpm specified` — `version: 12`
  в YAML + `pnpm@12.11.2` в `package.json`. `with: version` убран,
  версия берётся из `packageManager`.
- **web: zod в dependencies (KI-142):** `zod` использовался в
  `web/src/**`, но не был в `web/package.json` — локально резолвился
  из корневого `node_modules`, в CI падало с TS2307 + TS7006.
  Добавлен `zod: ^4.6.6`.

## [0.6.1] — 2026-10-14

**Frontend: единый реестр узлов (KI-121, KI-122, KI-123), KI-125..129.**

### Changed
- **Frontend — v0.6.1: единый реестр узлов (KI-121, KI-122, KI-123):**
  - `web/src/lib/node-registry.ts` (новый) — `NODE_REGISTRY`
    (`Record<NodeType, NodeRegistryEntry>`): метаданные (`label`,
    `icon`, `iconEmoji`, `labelEn`, `category`), компоненты,
    `isNodeType()`, `nodeTypes` для React Flow, `nodeLabelOf()`.
  - `fromApiWorkflow` — цепочка `!==` заменена на `isNodeType()`.
    Новый тип узла больше не теряется молча при Load (tsc ловит).
  - `nodeDataFromApi` — переносит `model` / `aspectRatio` для
    `image_generation` (KI-122: до правки Load терял выбор
    пользователя, и следующий Save затирал его в БД).
  - `Toolbar` — кнопки строятся из реестра (KI-123), локальный
    `BUTTONS` удалён. Визуал v0.6.0 сохранён (эмодзи + EN-подписи
    для тулбара, RU-подписи — для шапки узла и будущего каталога).
  - `data.label` удалён из `NodeData` — заголовок узла берётся из
    реестра (`nodeLabelOf`). Читатели `data.label` (`TopBar`,
    `RunResultPanel`, `workflow.runPlanAsync`) переведены на хелпер.
  - `NODE_CATEGORIES` / `NodeCategory` + `category` у каждой записи
    реестра — скелет под каталог (KI-127 частично).
  - `nodes/index.ts` — тонкий реэкспорт; `Canvas.tsx` не менялся.

### Documented
- **KI-125** — нет тёмной темы (🟡 Medium, v0.7).
- **KI-126** — нет i18n RU/EN (🟡 Medium, v0.7). RULES 1.14.
- **KI-127** — каталог узлов с категориями (🟡 Medium, частично
  закрыт: `NODE_CATEGORIES` + `category` в реестре; поповер — v0.8).
- **KI-128** — узлы-сервисы с внутренним конфигом (🟢 Low, v0.8+).
- **KI-129** — уборка типов фронтенда: `NodeData` как
  дискриминированный union, `imageUrl` без `undefined`
  (🟢 Low, v0.7).

---

## [0.6.0] — 2026-10-14

**Media: генерация изображений через GPTunnel CreativeLab.**

Полный цикл «нарисовал → сохранил → запустил → LLM выполнил → картинка в узле». Провайдеры: 6 LLM (Anthropic, OpenAI, RouterAI, GPTunnel, DeepSeek, Yandex, LM Studio) + media-провайдер CreativeLab (57 IMAGE-моделей, Flux / DALL·E / Gemini Image / Nano Banana / Midjourney).

### Added
- **Runner — v0.6.0a: модальности моделей (2026-10-13):**
  - `ModelModality` (`text` / `vision` / `image-generation` /
    `audio` / `video` / `embedding`) + `ModelInfo` с
    `inputModalities` / `outputModalities`. Рантайм-константа
    `MODEL_MODALITIES` — для валидации env.
  - `GET /llm/models` возвращает модальности каждой модели.
  - `LMSTUDIO_MODELS` — суффикс модальностей:
    `id:modality+modality,id:modality`. Без суффикса — `text`.
  - UI: селект LLM-ноды **сгруппирован** (`Текст` /
    `Текст + Vision`), карточка узла показывает badge `[V]` для
    vision-моделей.
  - `web/src/lib/llm-models.ts` — `filterModelsByInput`,
    `filterModelsByOutput`, `groupLlmModelsForSelect`.
  - ImageGen-нода фильтрует модели по `output: image-generation`
    (пусто до v0.6.0b — image-провайдера ещё нет).
  - +3 теста (257 → 260).
  - Smoke: 9 моделей от 4 провайдеров, группы в селекте, badge
    `[V]` на `qwen/qwen2.5-vl-7b`.

- **Runner — v0.6.0b.1: GPTunnel chat (2026-10-13):**
  - GPTunnel (`https://gptunnel.ru/v1`) — OpenAI-совместимый chat.
    Два независимых API: `/v1` (chat) и `/api/v2/media` (image/
    video/audio, добавляется в v0.6.0b.2).
  - `GPTUNNEL_API_KEY`, `GPTUNNEL_BASE_URL`, `GPTUNNEL_MODELS`
    (формат `id:modality+modality,id:modality` — как
    `LMSTUDIO_MODELS`; парсер общий).
  - Провайдер включается при **ключе** и **непустом списке** —
    в отличие от LM Studio (только список).
  - Парсер `parseModelIds` обобщён: `{ envKey, labelSuffix }` в
    опциях — предупреждения называют правильную переменную.
  - +11 тестов (260 → 271).

- **Runner — v0.6.0b.2.1: media-провайдер CreativeLab (2026-10-13):**
  - `src/media/` — новый модуль для media-провайдеров, отдельный
    от `LlmModule`.
  - `IMediaProvider` + `MediaProviderException` (с `retryable`, как
    в `LlmProviderException`).
  - `CreativeLabProvider` (GPTunnel `/api/v2/media`):
    `GET /media/models?type=IMAGE` через встроенный `fetch` (Node 22),
    Zod-валидация ответа, snake_case → camelCase, кэш по типу
    (TTL 15 мин, `GPTUNNEL_MEDIA_CACHE_TTL_MS`).
  - `MediaRegistryService` + `MEDIA_PROVIDERS` токен (паттерн как
    `LLM_PROVIDERS`). Пустой список при отсутствии провайдера —
    не 404. Дедупликация id: первое побеждает.
  - `GET /media/models?type=IMAGE` — контроллер.
    `retryable` → 503, иначе → 502.
  - env: `GPTUNNEL_MEDIA_API_KEY`, `GPTUNNEL_MEDIA_BASE_URL`,
    `GPTUNNEL_MEDIA_CACHE_TTL_MS`.
  - +26 тестов (271 → 297).

- **Runner — v0.6.0b.2.2: executor для media (2026-10-14):**
  - Узел `image_generation` выполняет **реальный** CreativeLab:
    `createTask → poll → URLs`. Стаб удалён.
  - **Миграция `0003`:** `node_runs.cost_rub numeric(10,6)`.
    LLM → `cost_usd` (USD), media → `cost_rub` (RUB). Не смешиваются.
  - `src/media/dto/media-task.dto.ts` — Zod-схемы задачи.
  - `CreativeLabProvider.createTaskAsync` / `getTaskAsync` с
    `idempotency_key` (защита от двойной оплаты при retry),
    `wait: true`, таймауты 45с/15с. Классификация ошибок:
    401/403, 402, 409+code:23 (идемпотентный конфликт → возврат
    существующей задачи), 400+code:25, 410+code:21 (без
    аналога), 429/5xx — retryable. Заголовок `Deprecation: true`
    + `x-model-served` → logger.warn, запрос продолжается.
  - `MediaNodeExecutor` — DI-исполнитель с poll'ом (backoff
    2s ×1.5, cap 15s, общий таймаут 5 мин). Outputs:
    `{ mediaUrl, mediaType, taskId }`.
  - `ExecutionEngineService`: `NodeStepResult` — discriminated
    union (`plain | llm | media`). UPDATE пишет `tokens_in/out` +
    `cost_usd` для LLM, `cost_rub` — для media. UPSERT сбрасывает
    `cost_rub` (KI-047).
  - +27 тестов (297 → 324).

- **Frontend — v0.6.0b.2.3: узел image_generation (2026-10-14):**
  - `ImageGenNode` — рабочий узел: селект `GET /media/models?type=IMAGE`,
    `aspect_ratio` из `params` модели, подпись цены
    («от 0.6 ₽ / генерация»), рендер `<img src={mediaUrl}>` в теле узла.
  - `isRenderableMediaUrl` — валидация http(s) перед `<img>`
    (класс KI-006).
  - Валидация Run — `findImageNodesWithoutModel`.
  - Store: `mediaModels`, `mediaModelsLoaded`, `loadMediaModelsAsync`
    (lazy, один fetch за сессию); `NodeRunMetrics.costRub`.
  - `RunResultPanel`: `formatRub` — `"0.600000"` → `"0.60 ₽"`.
  - `costRub` в `NodeRunSnapshotSchema` (`.nullable().optional()`).
  - CDP-smoke: 55 моделей, дефолт `flux-schnell`, `<img>` по URL,
    метрика `0.60 ₽`, Run заблокирован без модели.

- **Runner — v0.6.0b.2.4: `cost_rub` в SSE snapshot (2026-10-14):**
  - `costRub: z.string().nullable().optional()` в
    `NodeRunSnapshotSchema` (backend-схема).
  - `toNodeSnapshot` — `costRub: row.costRub ?? null`.
  - +1 тест (324 → 325).

- **Frontend — v0.6.0b.2.5: `image` → `image_generation` (2026-10-14):**
  - Контракт типа узла приведён к backend: `NodeType`, `createNode`,
    `nodeDataFromApi`, `fromApiWorkflow`, registry `nodeTypes`,
    `Toolbar`, `NODE_TYPE_ICONS/LABELS`. `kind: 'image'` (UI-метка)
    сохранён.
  - CDP-smoke: Save отправляет `type: 'image_generation'`, Load
    отрисовывает узел нашим компонентом, `data.kind` не подменён.

### Fixed
- **KI-110** — WSL2 Docker proxy (`wslrelay.exe`) рвал idle TCP:
  `pg.Pool` переиспользовал мёртвый сокет, `POST /workflow` падал с
  500, ioredis сыпал `ECONNABORTED`. `pg.Pool` — `idleTimeoutMillis:
  5s`, `maxLifetimeSeconds: 30s`, `connectionTimeoutMillis: 5s`.
  `ioredis` — `keepAlive: 10s`, bounded `retryStrategy`.
- **KI-111** — `MediaTaskResponseSchema.result` — массив
  **объектов** `{ url }`, не массив строк. Схема ждала
  `z.array(z.url())`, узел `image_generation` падал за ~300 мс до
  первого poll. Схема — `z.array(z.object({ url: z.url() }))`,
  mapper — `dto.result.map(item => item.url)`.
- **KI-112** — у моделей с тарифом «по входу» (`tts2`) нет
  `price_unit`, есть `price_input`/`price_input_unit`. Схема
  требовала `price_unit: z.string()`, один такой элемент в
  коллекции ломал `safeParse` → вся пачка моделей не грузилась.
  Поле — `.optional()`, добавлены `price_input`/`price_input_unit`.
- **KI-120** — Vite proxy не знал про `/media`: UI получал HTML
  (SPA fallback) со статусом 200, `requestAsync` падал на
  `JSON.parse`, селект моделей оставался disabled. `'/media'` в
  `web/vite.config.ts`.
- **Контракт типа узла** (v0.6.0b.2.5) — frontend отправлял
  `type: 'image'`, backend ждёт `'image_generation'` (NodeDto,
  executor, engine). Каждый Run падал с «Неподдерживаемый тип узла:
  image».

---

## [0.4.0] — 2026-10-13

**MVP: визуальный редактор LLM-workflow с реальным выполнением.**

Canvas (React Flow) → Engine (топосортировка) → Runner (BullMQ + Postgres) → LLM
(Anthropic / OpenAI) → SSE → UI (подсветка нод + панель результата). Полный цикл
«нарисовал → сохранил → запустил → увидел результат» работает.

### Added

- **Frontend — R4.3b: панель результата:**
  - `RunResultPanel` (снизу, сворачивается): по клику на ноду — вывод (JSON),
    метрики (длительность/токены/стоимость), ошибка и логи ретраев (KI-036);
    без выбранного узла — статус запуска с номером попытки и `runError`.
  - Раскладка переведена на flex-колонку: `TopBar` — обычный элемент,
    `Canvas` — `flex-1 min-h-0`, панель — `shrink-0`. React Flow корректно
    ресайзится при сворачивании панели.
  - `stores/workflow.ts` — `selectedNodeId`, `nodeErrors`, `nodeLogs`,
    `nodeMetrics`; выбор снимается при удалении ноды. Фикс `attemptNumber`:
    промежуточный провал — `attemptsMade + 2` (следующая попытка), финал —
    `attemptsMade + 1` (завершившаяся).
  - Smoke (CDP): панель показывает `{ "text": "привет" }` и «2 мс», клик по
    пустому месту возвращает run-уровень, свернуть/развернуть — 48px/288px,
    консоль чистая.
- **Frontend — R4.3a: id моделей и блокировка Run:**
  - Список моделей приходит из `GET /llm/models` (R4.1b) и кэшируется в store:
    в `data.model` хранится **id** (`claude-sonnet-4-20250514`), в селекте
    показывается label. `LLM_MODELS`/`LlmModel`/`LLM_MODEL_HINTS` удалены.
  - Недоступная модель показывается как «(недоступно)» — молчаливой подмены на
    первый из списка больше нет (`nodeDataFromApi`).
  - `TopBar` блокирует Run, если в графе есть LLM-узел с недоступной моделью
    (точный тост; `POST /runs` не отправляется).
  - `vite.config.ts` — `/llm` proxy (без него `GET /llm/models` → 404).
- **Frontend — R4.2: EventSource + подсветка нод:**
  - `Run` выполняет реальный `POST /runs` и подписывается на SSE. Ноды
    подсвечиваются в реальном времени: серые → синие → зелёные (успех) /
    красные (провал).
  - `web/src/types/run-stream.ts` — Zod-схемы SSE-сообщений (зеркало backend
    `RunStreamMessageSchema`).
  - `web/src/lib/run-stream.ts` — `subscribeToRunStream` со счётчиком ошибок
    (3 → close). Таймаут «нет сообщений» **не** используется: SSE
    keep-alive-комментарии не видны в JS, и таймер оборвал бы живой долгий
    LLM-вызов.
  - `stores/workflow.ts` — `runId`/`runStatus`/`nodeStatuses`/`nodeOutputs`;
    `applySnapshot` **заменяет** карты (snapshot — источник истины при
    переподключении), `final=true` → close.
  - `BaseNode` — `border-2` + `bg-*-50` по статусу, `data-status` для e2e.
  - `TopBar` — бейдж статуса, кнопка Run блокируется во время выполнения,
    авто-Save перед Run, если workflow не сохранён.
  - `vite.config.ts` — `/runs` proxy с `timeout: 0`/`proxyTimeout: 0` (дефолт
    убил бы долгий SSE-поток).
  - Smoke (CDP, headless Chrome): провал — 3 попытки BullMQ (серый → синий →
    красный × 3, badge «Выполняется… (попытка N/M)» → «Ошибка»),
    `streamClosed: true` на `final=true`; успех (text→text) — обе ноды зелёные,
    badge «Готово». Zero console errors.
- **Runner — R4.1: SSE-поток и список моделей:**
  - `GET /runs/:id/stream` — SSE-поток прогресса запуска (`@Sse()` +
    `@SseSignal()`). Первым сообщением — `snapshot` (KI-049: run + все
    `node_runs`), далее — события из Redis pub/sub. Keep-alive `: keep-alive`
    раз в 15 с — защита от `proxy_read_timeout`.
  - `src/runs/dto/run-stream-message.dto.ts` — `RunStreamMessageSchema`
    (discriminatedUnion `RunEventSchema` + `SnapshotMessageSchema`);
    `RunEventSchema` (pub/sub-контракт) не менялся.
  - `GET /llm/models` (KI-056) — `LlmController` отдаёт
    `LlmRegistryService.listModels()` (отфильтровано по `isConfigured`,
    KI-039), без envelope.
  - 12 новых тестов (190 → 202).
- **Runner — KI-065 + KI-032: конфигурируемый воркер:**
  - `WorkerEnvSchema` в `env.schema.ts` — единый источник дефолтов и границ;
    встроена в `EnvSchema` через `.shape`, поэтому `ConfigModule` и
    `@Processor` валидируют одно и то же.
  - `src/runs/runs.worker-options.ts` — читает env в момент загрузки модуля
    (декораторы вне DI); значения валидируются Zod **до** передачи в BullMQ
    (`Number('abc') = NaN` не утечёт).
  - `@Processor(WORKFLOW_RUNS_QUEUE, WORKFLOW_RUNS_WORKER_OPTIONS)`:
    `concurrency` (default 5), `lockDuration` (default 300 000),
    `maxStalledCount` (default 2) — из env.
  - `RUN_STALE_THRESHOLD_MS` удалён из `runs.constants.ts`; значение берётся из
    `WORKFLOW_RUNS_STALE_THRESHOLD_MS` (default 300 000) — единый источник без
    расхождения prod/тестов (KI-032).
  - 12 новых тестов (217 → 229).
  - Smoke: `concurrency=2` → «max simultaneously running = 2» (до правки — 1);
    `concurrency=1` → регресс 1; env fail-fast: `0`/`100`/`abc` → `exit=1`.
- **Runner — KI-060: явный признак финальности `run_completed`:**
  - `run_completed` несёт `final: boolean` — эвристика
    `attemptsMade >= attempts - 1` ломалась на детерминированных провалах
    планирования (цикл: `executeAsync` не пробрасывает, job успешен, retry не
    будет).
  - `RunsProcessor` — **единственный** публикатор `run_completed`: только он
    знает и результат (`return`/`throw`), и состояние попыток job'а.
    `ExecutionEngineService` больше **не** публикует `run_completed`;
    `RunAttemptContext` удалён — `executeAsync(runId, graph)` снова с двумя
    аргументами. `runs-stream.service` закрывает поток чисто по `event.final`,
    `isFinalCompletion` удалён.
  - 8 новых и 5 обновлённых тестов (209 → 217).
  - Smoke A (job retry): `final=false` на 0/3 и 1/3, `final=true` на 2/3 —
    поток закрыт. Smoke B (цикл): `run_completed(final=true)` сразу, поток
    закрыт за 1.3 с (было: `curl exit=28`, соединение висело).
- **Runner — KI-059: сигнал исчерпания попыток:**
  - `RunEventSchema.run_completed` несёт `attemptsMade` и `attempts` (из job в
    процессоре); SSE-поток закрывается только на **финальном**
    `run_completed`. `attempts=null` — поток остаётся открытым (неизвестный
    лимит ≠ «повторов не будет»).
  - 7 новых тестов (202 → 209).
  - Smoke: 3 job-retry (мёртвый `ANTHROPIC_BASE_URL`) — поток открыт на 0/3 и
    1/3, закрывается после 2/3.
- **Runner — KI-039 + KI-052: провайдеры и стоимость:**
  - `ILlmProvider.isConfigured` (KI-039) — геттер `client !== null`;
    `LlmRegistryService.listModels()` фильтрует неконфигурированные провайдеры.
    `resolveByModel` **не** фильтрует (маршрутизация ≠ готовность; ошибка
    «API_KEY не задан» всплывает на вызове).
  - `calculateCostUsd` возвращает `null`, если провайдер не отдал usage
    (KI-052): `cost_usd = 0` больше не означает «бесплатный вызов».
  - 7 новых тестов (183 → 190).
- **Runner — KI-038: метрики LLM-узлов:**
  - `ILlmProvider.generateAsync` возвращает `LlmGenerateResult`
    (`{ text, usage }`) вместо `Promise<string>` (breaking change, dev-only).
  - `extractUsage` в обоих провайдерах с явным narrowing из `unknown`
    (RULES § 1.17).
  - `src/llm/model-pricing.ts` (новый) — `MODEL_PRICING` + `calculateCostUsd`.
  - `LlmNodeExecutor.executeAsync` возвращает `{ outputs, metrics }`; метрики
    пишет `ExecutionEngineService` (executor не трогает БД — он владеет
    `node_runs` и UPSERT'ом из KI-031/KI-047).
  - `node_runs.tokens_in/tokens_out/cost_usd` заполняются и сбрасываются в
    UPSERT (не «прилипают» к новой попытке).
  - 11 новых тестов (172 → 183).
- **Runner — R3: LLM-провайдеры:**
  - `src/llm/llm-provider.interface.ts` — `ILlmProvider`,
    `LlmGenerateOptions`, `LlmProviderException`.
  - `src/llm/providers/anthropic.provider.ts` — Claude Opus 4 / Sonnet 4
    (`@anthropic-ai/sdk`); `openai.provider.ts` — GPT-4o / 4o-mini (`openai`).
  - `src/llm/llm-registry.service.ts` — `resolveByModel()` + `listModels()`;
    `src/llm/llm.service.ts` — единая точка вызова + `AbortSignal` timeout 60s
    (RULES § 4.19).
  - `src/llm/llm-node-executor.service.ts` — DI-исполнитель узла `llm`
    (`node-executors.ts` остались чистыми функциями).
  - `ExecutionEngineService`: `runNode` → `runNodeAsync`,
    `executeLlmNodeStub` удалён.
  - Зависимости: `@anthropic-ai/sdk@0.133.0`, `openai@7.32.0`.
  - 17 новых тестов с замоканными SDK (124 → 148).
  - Smoke: graceful degradation без `ANTHROPIC_API_KEY` — провайдер бросает
    `LlmProviderException`, run → `failed`, `node_runs.error` заполнен; prompt
    в логи не попадает (RULES § 5.9).
- **Runner — R2.2: Executor:**
  - `ExecutionEngineService` (`src/engine/execution-engine.service.ts`):
    `executeAsync(runId, graph)` — обход `plan.levels` (`Promise.allSettled`
    внутри уровня, RULES 4.16; `for...of` между уровнями, прерывание на первом
    failed-узле); `executeNodeAsync` — INSERT `node_runs` (`running`) →
    выполнение → UPDATE (`completed`/`failed`) + публикация `node_started`,
    `node_completed`, `node_failed`; `collectInputsAsync` — параллельное чтение
    `outputs` предшественников (RULES 4.17); `markRunRunningAsync` (в
    transaction), `finishRunAsync`.
  - `src/engine/node-executors.ts`: `executeTextNode` (реальный),
    `executeLlmNodeStub`/`executeImageGenNodeStub` (заглушки),
    `UnsupportedNodeTypeException`.
  - `RunsProcessor` вместо скелета вызывает `ExecutionEngineService`,
    валидирует `snapshot` (Zod) и идемпотентен.
  - 13 новых тестов (95 → 108).
  - Smoke: линейный A→B→C — 3 `node_runs` completed, `inputs[B]` от A, полная
    цепочка событий в Redis pub/sub.
- **Runner — R2.1: подготовка executor'а:**
  - **KI-016:** очередь `workflow-runs` получила `defaultJobOptions`:
    `attempts: 3`, `backoff: exponential 2000ms`, `removeOnComplete`
    (count 100, age 24ч), `removeOnFail` (count 500, age 7д).
  - **KI-014:** jsonb-колонки типизированы через `$type<T>()`
    (`workflows.nodes/edges`, `workflow_runs.snapshot/inputs/outputs`,
    `node_runs.inputs/outputs/logs`); тип snapshot — `GraphSnapshotDto`
    (`src/engine/dto/graph-snapshot.dto.ts`).
  - **KI-015:** в `workflow_runs` добавлен `created_at timestamptz NOT NULL
    DEFAULT now()` + backfill из `started_at` (миграция
    `drizzle/0001_flippant_lockjaw.sql`); `RunResponse.createdAt` читает из
    `created_at`.
  - **KI-003:** ключ в `executionMap.inputs` — `targetHandle ?? sourceHandle ??
    edge.id` (было `targetHandle ?? 'input'`) — multi-input узлы без заданных
    портов больше не перезаписывают друг друга.
  - Pub/sub-инфраструктура: `RedisModule` (`@Global()`, отдельный ioredis-клиент),
    `RunEventSchema` (`src/runs/dto/run-event.dto.ts`), `RunEventsService`
    (`publishAsync`, `subscribeAsync` с `AbortSignal`),
    `runEventsChannel(runId)`.
  - 13 новых тестов (82 → 95).
- **Runner — R1: BullMQ-инфраструктура:**
  - `docker-compose.yml` — сервис `redis` (`redis:7-alpine`, порт 6379, named
    volume, healthcheck); `REDIS_URL=redis://127.0.0.1:6379` в `.env` и
    `.env.example` (хост `127.0.0.1`, не `localhost` — RULES 4.31).
  - `src/config/env.schema.ts` — Zod-схема env + `validateEnv()` (fail-fast при
    старте, RULES 4.5).
  - `RunsModule` (`src/runs/`): DTO (`CreateRunSchema`, Zod-payload job),
    `runs.constants.ts`, `runs.service.ts` (`createRunAsync` — INSERT run +
    snapshot графа + `queue.add`; `getRunAsync` — 404), `runs.controller.ts`
    (`POST /runs` 201, `GET /runs/:id` 200/404), `runs.processor.ts`
    (`@Processor` + `WorkerHost`, скелет), `runs.module.ts`.
  - `src/app.module.ts` — `ConfigModule.forRoot({ isGlobal, cache, validate })` +
    `BullModule.forRootAsync` (Redis URL из `ConfigService`, RULES 4.9).
  - `src/main.ts` — `app.enableShutdownHooks()` (RULES 4.12).
  - 14 новых тестов (68 → 82), включая ветку «Redis упал → run.failed» и
    controller-тесты на supertest.

### Fixed

- **KI-074** — список моделей грузится на старте; новый LLM-узел получает
  `llmModels[0].id`; `TopBar.findNodesWithUnavailableModel` блокирует Run с
  тостом при недоступной модели. Smoke: `POST /runs` не уходит.
- **KI-071** — favicon встроен SVG data-URI в `web/index.html`; консоль чистая.
- **KI-070** — промежуточный провал (`run_completed(failed, final=false)`) больше
  не переводит `runStatus` в `failed`: бейдж продолжает «Выполняется… (попытка
  N/M)», кнопка Run заблокирована до `final=true`.
- **KI-069** — UI отправлял **метку** модели («Claude Opus 4»), а не id: LLM-узел
  из редактора всегда падал с «Модель не поддерживается». Список приходит из
  `GET /llm/models`; `nodeDataFromApi` больше не подменяет неизвестную модель.
  Smoke: Save сохраняет id в `workflows.nodes[].data.model`.
- **KI-046** — job-level replay (KI-040) переигрывал весь граф, включая
  завершённые узлы, — повторные **платные** вызовы LLM при неизменных входах.
  `findReusableNodeRunAsync` проверяет `node_runs` на `status='completed'` +
  `isDeepStrictEqual(inputs)` **до** UPSERT и при совпадении возвращает
  сохранённые `outputs`, не вызывая узел и не публикуя события. +8 тестов,
  включая интеграционный A→B→C (переигрывается только C).
- **KI-047** — UPSERT не сбрасывал `outputs`/`duration_ms`, из-за чего «running»
  показывал результат прошлой попытки. Добавлены
  `outputs: null, durationMs: null`; при попадании в кэш (KI-046) строка не
  перезаписывается вовсе.
- **KI-040** — job-level retry (BullMQ `attempts: 3`) был декоративен: guard в
  `RunsProcessor` отклонял повторную доставку после того, как `executeAsync`
  ставил `failed` и бросал исключение. Guard расширен:
  `pending || isStale || isJobRetry`. Плюс `markRunRunningAsync` сбрасывает
  `error`/`finishedAt`. +5 тестов; smoke с реальным BullMQ retry (backoff
  2s/4s, 3 прогона графа, UPSERT идемпотентен).
- **KI-036** — падение LLM-узла не ретраилось. `LlmProviderException.retryable` +
  классификация 429/5xx/таймаут/сеть против 400/401/403/404
  (`src/llm/provider-errors.ts`); node-level retry: 3 попытки,
  backoff 500ms × 2^(n−1) только для `retryable`, после исчерпания — `throw`
  наружу. +5 тестов.
- **KI-037** — ошибка `buildExecutionPlanAsync` оставляла run в `pending`
  навсегда. Обёрнуто в try/catch; при ошибке — `failRunAsync` (`status='failed'`
  + `error` с деталями цикла через `describePlanError`). +1 тест.
- **KI-031** — повторный запуск зависшего run дублировал `node_runs`. Добавлен
  `unique (run_id, node_id)` + `ON CONFLICT DO UPDATE` в `executeNodeAsync`:
  повторный прогон обновляет ту же строку. Миграция
  `drizzle/0002_steady_molecule_man.sql`.
- **KI-030** — React Flow handle id (`text-output`/`image-output`) не совпадали с
  именами портов исполнителей (`text`/`url`), и `collectInputsAsync` молча клал
  `null` для **всех** UI-графов. Введён единый реестр `NODE_PORT_CONTRACT`
  (`sourceHandleId` + `outputPortName` + `targetHandleId`) и
  `handleIdToOutputPort()` (`src/engine/node-ports.ts`);
  `DEFAULT_OUTPUT_PORT_BY_NODE_TYPE` теперь **выводится** из контракта —
  рассинхрон имён невозможен. +8 тестов (116 → 124).
- **KI-034** — входы узлов нормализованы: ключ в `executionMap.inputs` и
  `node_runs.inputs` теперь **имя порта** (`prompt`/`text`), а не UI-id хендла.
  Fallback `targetHandle → sourceHandle → edge.id` сохранён для узлов без
  контракта. +7 тестов.
- **KI-022** — `executionMap` подставлял несуществующий порт `output` для связей
  без `sourceHandle`, из-за чего `collectInputsAsync` молча клал `null` (R2.2).
  Теперь `fromPort = sourceHandle ?? inferDefaultOutputPort(sourceNode.type)`:
  `text`/`llm` → `'text'`, `image_generation` → `'url'`. +4 теста.
- **KI-023** — зависший запуск при падении worker'а: `workflow_runs` навсегда
  оставался в `running`. Введён lease-guard: повторное выполнение разрешено,
  если `status='running'` и `started_at` старше `RUN_STALE_THRESHOLD_MS`;
  свежий `running` и `started_at=null` пропускаются консервативно. +4 теста.
- **KI-014, KI-015, KI-016, KI-003** — см. блок «R2.1» в `Added`: типизация
  jsonb, `created_at` с backfill, `defaultJobOptions` очереди, контракт ключей
  `executionMap`.
- **KI-010** — `pnpm` 12 перезаписывал `pnpm-lock.yaml` при каждом запуске:
  добавлен `pmOnFail: ignore` в конфиг, lockfile стабилен.

### Changed

- **Husky pre-commit hook** — блокирует коммиты, в которых встречается
  подстрока с реальным ключом Anthropic или OpenAI (`ANTHROPIC_API_KEY=`,
  `OPENAI_API_KEY=`). Заменяет ручную проверку из RULES § 3.12, дополняет
  GitHub Push Protection. `husky 9.1.7` + `lint-staged 17.6.0` (lint-staged пока
  не сконфигурирован — KI-044).
- **Контракт `executionMap`** (KI-003): ключи внутри узла больше не схлопываются
  в `'input'`, если `targetHandle` не задан. Frontend это поле не использует
  (KI-020), executor использует с R2.2.

---

## [0.3.0] — 2026-10-13

**Frontend: визуальный редактор графа (React Flow + Zustand + Tailwind v4).**

### Added

- **Frontend — Task 3: сохранение, загрузка и предпросмотр плана:**
  - `web/src/lib/api.ts` — типизированный клиент API: Zod-валидация ответов,
    `requestAsync<T>` с обработкой сетевых и HTTP-ошибок, 6 endpoints.
  - `web/src/lib/plan.ts` — `levelsToMap` (`string[][]` →
    `Record<string, number>`).
  - `TopBar` — редактируемое имя workflow, кнопки Load / Save / Run.
  - `LoadModal` — список workflow, открытие / удаление, Escape.
  - `Toast` — inline-уведомления (без библиотек).
  - Store: `currentWorkflowId`, `currentWorkflowName`, `executionLevels`,
    `saveWorkflowAsync`, `loadWorkflowAsync`, `runPlanAsync`.
  - `BaseNode` — badge уровня выполнения (серый кружок с номером).
  - Синхронизация URL: после первого Save → `?workflowId=` через
    `history.replaceState`; при перезагрузке — fetch по id.
  - `executionLevels` сбрасывается при `addNode` / `onConnect` / `load`.
  - Проверено на живом backend: Save → POST, повторный Save → PATCH того же id,
    Run на diamond A→B/C→D → `{A:1, B:2, C:2, D:3}` и badges, Load → граф
    заменён, reload `?workflowId=` → узлы восстановлены, 0 ошибок в консоли.
- **Frontend — Task 2: кастомные ноды и порты:**
  - `TextNode`, `LLMNode`, `ImageGenNode` + презентационная обёртка `BaseNode`.
  - Типизированные порты: T (синий `#3b82f6`), G (зелёный `#22c55e`), 10px +
    белая обводка + подпись рядом.
  - `TextNode` — textarea (3 строки) с плейсхолдером и `nodrag`;
    `LLMNode` — select моделей + подсказка скорости;
    `ImageGenNode` — плейсхолдер результата + disabled select.
  - Регистрация через `nodeTypes` в `ReactFlow`; сеточная раскладка 280×190;
    `fitViewOptions: { maxZoom: 1 }`; `defaultEdgeOptions: { strokeWidth: 2 }`.
  - Проверка в headless Chrome + CDP: ввод текста и смена модели доходят до
    Zustand, порты соединяются, 0 ошибок в консоли.
- **Frontend — Task 1: отдельный пакет `web/`:**
  - Vite 8 + React 19 + TypeScript 6 (strict, ESM) + Tailwind CSS v4
    (CSS-based config).
  - React Flow v12 (`@xyflow/react`) — canvas с сеткой, controls, minimap.
  - Zustand store (`useWorkflowStore`) для `nodes`/`edges`.
  - `Toolbar` с 3 кнопками (Text / LLM / Image Generation).
  - Vite proxy: `/workflow` и `/engine` → `http://localhost:3000`.
  - Dev-only `window.__wfStore` для отладки в DevTools.
  - Проверка в headless Chrome + CDP: 3 ноды, 2 связи, 0 ошибок.

---

## [0.2.0] — 2026-10-12

**Backend: CRUD workflow и Engine (топологическая сортировка).**

### Added

- **Engine:**
  - `EngineService` — топологическая сортировка (алгоритм Кана), валидация
    графа, построение плана выполнения с уровнями параллелизма.
  - DTO: `PositionSchema`, `NodeSchema`, `EdgeSchema`, `GraphSchema`
    (`src/engine/dto/`).
  - `EngineController` — 3 endpoints: `POST /engine/validate`, `/sort`, `/plan`.
  - 29 тестов (+26 service, +3 controller). Всего: **68**.
- **CRUD Workflow:**
  - `ZodValidationPipe` (`src/common/pipes/`) — валидация body/query/param через
    Zod 4, `static create(schema)` для использования в декораторах.
  - DTO: `CreateWorkflowSchema`, `UpdateWorkflowSchema`,
    `ListWorkflowsQuerySchema` (`src/workflow/dto/`).
  - `WorkflowService` — 5 методов (`createAsync`, `findAllAsync`, `findOneAsync`,
    `updateAsync`, `removeAsync`) на Drizzle ORM + pg driver.
  - `WorkflowController` — 5 REST endpoints
    (`POST/GET/GET:id/PATCH/DELETE /workflow`).
  - Multi-tenant readiness: необязательный `userId`-фильтр во всех методах.
  - 31 тест (было 7): +18 service, +8 controller, −2 заменено.

### Fixed

- **PATCH `/workflow/:id` с пустым body** возвращал 200 вместо 400.
  `UpdateWorkflowSchema` переписан без `.partial()` — defaults на
  `nodes`/`edges` больше не блокируют `.refine()`; `userId` исключён из
  update-схемы.

---

## [0.1.0] — 2026-10-12

**Первый рабочий каркас.** Проект инициализирован, поднят NestJS 12 + ESM + Vitest,
подключена PostgreSQL через Drizzle ORM, создана схема данных для workflow / runs / node_runs.

### Added
- **Инициализация проекта:**
  - NestJS 12 (ESM, TypeScript 6, strict mode).
  - Vitest как test-runner (7 тестов-заглушек).
  - oxlint + Prettier.
- **Зависимости (runtime):**
  - `@nestjs/config`, `@nestjs/bullmq`, `bullmq`, `ioredis` — очереди и конфиг.
  - `drizzle-orm` + `postgres` — PostgreSQL клиент.
  - `zod` — валидация.
  - `@nestjs/passport`, `@nestjs/jwt` — auth (задел).
  - `pino`, `nestjs-pino` — структурированные логи.
  - `dotenv` — загрузка `.env` в runtime.
- **Зависимости (dev):**
  - `drizzle-kit`, `@nestjs/testing`, `tsx`.
- **Модули-скелеты:**
  - `WorkflowModule` + Service + Controller + spec.
  - `EngineModule` + Service + Controller + spec.
  - `NodesModule` + Service + Controller + spec.
- **Drizzle / PostgreSQL:**
  - `drizzle.config.ts` — конфиг drizzle-kit с dotenv.
  - `src/db/schema.ts` — 3 таблицы: `workflows`, `workflow_runs`, `node_runs`
    + relations (one-to-many, cascade delete).
  - `src/db/db.module.ts` — `@Global()` NestJS-модуль с токенами `DRIZZLE` и `DB_SCHEMA`.
  - Миграция `drizzle/0000_*.sql`.
  - Скрипты: `db:generate`, `db:migrate`, `db:push`, `db:studio`.
- **Runtime fix:**
  - `import 'dotenv/config'` в `src/main.ts` — иначе NestJS не видит `.env`
    (в отличие от `drizzle-kit`, который читает его сам).
- **Документация:**
  - `docs/development/RULES.md` v1.0.0 — 88 правил для TS/NestJS/ESM/Drizzle.
  - `docs/CHANGELOG.md` (этот файл).
  - `docs/KNOWN_ISSUES.md` — пустой реестр.
  - `docs/development/PROMPT_V1.md` — стартовый промпт для новых чатов.

### Changed
- **Git-author** — переключён на нейтральный `dev@workflow-builder.local`
  (по аналогии с инцидентом KI-039 в IIChatTools).

### Planned

> **Внимание:** KI-номера в этом разделе — **исторические идентификаторы
> фич из плана v0.1.0**, а не ссылки на реестр `KNOWN_ISSUES.md`.
> С момента создания реестра нумерация разошлась: например, здесь
> `KI-106` = «Аутентификация», в реестре `KI-106` = «Идемпотентность
> media». Актуальные записи — только в `KNOWN_ISSUES.md` (см. KI-209).

- **KI-101** — Visual canvas для редактирования workflow (React + @xyflow/react).
- **KI-102** — LLM-провайдеры (Anthropic, OpenAI, локальные).
- **KI-103** — Image-generation провайдеры (Replicate, FAL, OpenAI Images).
- **KI-104** — BullMQ-оркестрация + SSE-стриминг прогресса.
- **KI-105** — Node types: `text`, `llm`, `image_generation`, `http`, `condition`, `output`.
- **KI-106** — Аутентификация (JWT + Passport).
- **KI-107** — Публичный share workflow (read-only ссылка).
- **KI-108** — Экспорт / импорт workflow (JSON).
- **KI-109** — Templates (пресеты: Text→Image, Text→LLM→Image, ...).

### Security
- **`.env`** — в `.gitignore`, содержит только dev-секреты
  (`workflow_dev_password` — локальный PostgreSQL в Docker).
- **Публичный репозиторий** — email автора обезличен.