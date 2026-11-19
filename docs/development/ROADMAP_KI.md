# RoadMap: проверка и исправление открытых KI

> Сгенерировано фактом из `docs/KNOWN_ISSUES.md` на HEAD `16d506f` (v1.6.0).
> Делайн: **06:00 МСК, 19.11.2026**. Старт: 00:26 МСК.
> Правила: `docs/development/RULES.md` v1.10.0.

## Порядок и ритм

1. Спринт = 3–5 KI (целевой размер 4). Порядок: 🔴 → 🟠 → 🟡 → 🟢, внутри — по номеру.
2. На каждый KI: сверить описание с фактическим кодом/тестами → починить или подтвердить «не баг» → покрыть тестом.
3. В конце спринта: `pnpm build` (0 errors / 0 warnings) + `pnpm test` (все зелёные).
4. Обновить `docs/CHANGELOG.md` + `docs/KNOWN_ISSUES.md` **в том же коммите** (RULES §3.17, §2.12).
5. `git status --short` → `git add -A` → commit → push → проверить CI (RULES §3.3–3.5).
6. Отчёт по спринту — в `docs/development/reports/v1.6.0/` (RULES §2.15/§2.18).

## Сводка

- Всего открытых KI: **272** (🟠 High — 1, 🟡 Medium — 83, 🟢 Low — 188).
- Спринтов: **68** по 4 KI.
- Прогресс отмечается галочками в списке ниже; исполнение фиксируется в «Логе спринтов».

## Спринты

### Спринт 01 (High/Medium)

- [x] **KI-667** 🟠 — Бэкапы и restore-drill не автоматизированы в репозитории — `docs/development/PRODUCTION.md (§ 8), .github/workflows/ (нет job)`
- [x] **KI-011** 🟡 — `REDIS_URL` обязателен в `validateEnv()`, но в CI нет Redis — `src/config/env.schema.ts, .github/workflows/ci.yml,`
- [x] **KI-024** 🟡 — Сбой публикации события роняет узел — `src/engine/execution-engine.service.ts`
- [x] **KI-025** 🟡 — `workflow_runs.outputs` дублирует выходы всех узлов — `src/engine/execution-engine.service.ts`

### Спринт 02 (Medium)

- [x] **KI-026** 🟡 — Нет таймаута и отмены выполнения — `src/engine/execution-engine.service.ts, src/engine/node-executors.ts` (Fixed: фактически закрыт отменой v1.4.0)
- [x] **KI-027** 🟡 — Run-level inputs игнорируются — `src/runs/runs.service.ts, src/engine/execution-engine.service.ts`
- [x] **KI-033** 🟡 — Неизвестный `sourceHandle` подменяется дефолтом по типу узла — `src/engine/engine.service.ts, src/engine/node-ports.ts` (Won't Fix)
- [x] **KI-035** 🟡 — Нормализация входов сворачивает multi-input — `src/engine/node-ports.ts, src/engine/engine.service.ts` (Won't Fix)

### Спринт 03 (Medium)

- [x] **KI-038** 🟡 — `tokensIn` / `tokensOut` / `costUsd` / `logs` не заполняются — `src/engine/execution-engine.service.ts,` (уже исправлено)
- [x] **KI-041** 🟡 — Node-level retry повторяет узел целиком, а не только вызов провайдера — `src/engine/execution-engine.service.ts` (уже исправлено)
- [x] **KI-042** 🟡 — Retry-After из 429 игнорируется, backoff не настраивается — `src/engine/execution-engine.service.ts` (уже исправлено)
- [x] **KI-049** 🟡 — Переиспользованные узлы не видны в потоке событий — `src/runs/run-events.service.ts,` (уже исправлено)

### Спринт 04 (Medium)

- [x] **KI-050** 🟡 — `isDeepStrictEqual` тянет и сравнивает весь JSONB inputs — `src/engine/execution-engine.service.ts,` (Deferred)
- [x] **KI-053** 🟡 — Стоимость неудачных попыток теряется — `src/engine/execution-engine.service.ts,` (Deferred)
- [x] **KI-056** 🟡 — `listModels()` недостижим снаружи — `src/llm/llm-registry.service.ts, src/llm/llm.controller.ts (нет)` (уже исправлено)
- [x] **KI-060** 🟡 — Нет докачки событий при переподключении — `src/runs/runs-stream.service.ts` (Won't Fix)

### Спринт 05 (Medium)

- [x] **KI-061** 🟡 — Нет `GET /runs` (список запусков) — `src/runs/runs.controller.ts, src/runs/runs.service.ts` (уже исправлено)
- [x] **KI-062** 🟡 — `APIConnectionError` классифицируется как неповторяемая — `src/llm/provider-errors.ts`
- [x] **KI-063** 🟡 — Финальность не попадает в snapshot — `src/runs/runs-stream.service.ts, src/db/schema.ts` (Deferred)
- [x] **KI-064** 🟡 — `run_completed` публикуется только процессором (скрытый контракт) — `src/engine/execution-engine.service.ts,` (Won't Fix)

### Спринт 06 (Medium)

- [x] **KI-068** 🟡 — У фронтенда нет тестовой инфраструктуры и lint-скрипта (частично) — `web/package.json, .github/workflows/ci.yml` (Fixed: инфраструктура есть)
- [x] **KI-087** 🟡 — `OPENAI_BASE_URL` дублирует `ROUTERAI_*` — `src/llm/llm-provider.factory.ts, .env.example` (Documented)
- [x] **KI-092** 🟡 — Группировка в UI знает только text / vision — `web/src/lib/llm-models.ts` (Won't Fix)
- [x] **KI-094** 🟡 — Yandex: `text+vision` не подтверждён документацией — `src/llm/llm-provider.factory.ts (YANDEX_MODELS)` (Documented)

### Спринт 07 (Medium)

- [x] **KI-096** 🟡 — Env-список моделей описывает только входные модальности — `src/llm/llm-provider.factory.ts, .env.example` (Won't Fix)
- [x] **KI-097** 🟡 — GPTunnel-модели не валидируются на старте — `src/llm/llm-provider.factory.ts` (Documented)
- [x] **KI-099** 🟡 — Кэш media-моделей живёт в памяти процесса — `src/media/providers/creativelab.provider.ts` (Deferred)
- [x] **KI-101** 🟡 — Ошибки upstream не различаются по `code` в теле — `src/media/providers/creativelab.provider.ts` (Documented)

### Спринт 08 (Medium)

- [x] **KI-106** 🟡 — Идемпотентность работает только при повторе с тем же runId — `src/media/media-node-executor.service.ts` (Deferred)
- [x] **KI-107** 🟡 — Параллельные media-узлы могут упереться в rate limit — `src/engine/execution-engine.service.ts` (Deferred)
- [x] **KI-119** 🟡 — Пустой каталог media блокирует Run с некорректным текстом — `web/src/components/TopBar.tsx`
- [x] **KI-131** 🟡 — Связь `NodeType ↔ data.kind` не проверяется tsc — `web/src/types/graph.ts, web/src/lib/node-registry.ts` (Deferred)

### Спринт 09 (Medium)

- [x] **KI-145** 🟡 — Каталог узлов: a11y неполный — `web/src/components/NodeCatalogPopover.tsx` (Deferred)
- [x] **KI-170** 🟡 — `<MiniMap />` не локализуется через `ariaLabelConfig` — `web/src/components/Canvas.tsx` (Deferred)
- [x] **KI-184** 🟡 — Media-ошибка upstream не различает «наш запрос» и «сбой провайдера» — `src/media/dto/media-task.mapper.ts,` (Documented)
- [x] **KI-191** 🟡 — Дублировать узел (Ctrl+D) — `web/src/stores/workflow.ts, web/src/components/Canvas.tsx` (уже исправлено)

### Спринт 10 (Medium)

- [x] **KI-203** 🟡 — Нет FK workflows.user_id → users.id — `src/db/schema.ts, drizzle/` (Deferred)
- [x] **KI-209** 🟡 — KI-номера в CHANGELOG `[0.1.0] → ### Planned` — не ссылки на реестр — `docs/CHANGELOG.md` (уже исправлено)
- [x] **KI-216** 🟡 — Нет family-revocation при reuse refresh-токена — `src/auth/auth.service.ts`
- [x] **KI-223** 🟡 — Bootstrap не различает 401 и сетевую ошибку — `web/src/lib/api.ts (runRefreshAsync),`

### Спринт 11 (Medium)

- [x] **KI-224** 🟡 — Logout best-effort без отзыва refresh-токена — `web/src/components/TopBar.tsx (handleLogout)`
- [x] **KI-231** 🟡 — Multi-tab не координирует refresh-rotation — `web/src/lib/api.ts (refreshSessionAsync)`
- [x] **KI-239** 🟡 — Модалка не предупреждает о перевыпуске share-токена — `web/src/components/ShareModal.tsx` (Deferred)
- [x] **KI-240** 🟡 — Read-only страница рендерит редакторные node-компоненты — `web/src/components/ShareViewPage.tsx,` (Deferred)

### Спринт 12 (Medium)

- [x] **KI-241** 🟡 — `nodes as unknown as AppNode[]` без валидации — `web/src/components/ShareViewPage.tsx`
- [x] **KI-244** 🟡 — Anthropic-модели захардкожены в провайдере — `src/llm/providers/anthropic.provider.ts` (Deferred)
- [x] **KI-269** 🟡 — /engine/sort не исключает аннотации — `src/engine/engine.service.ts (topologicalSortAsync)`
- [x] **KI-275** 🟡 — CDP-смоук: hidden-страница молча отбрасывает OS-ввод — `временные скрипты смоука` (Documented)

### Спринт 13 (Medium)

- [x] **KI-278** 🟡 — NodePortContract: 1 вход / 1 выход на тип — `src/engine/node-ports.ts, src/engine/engine.service.ts` (Deferred)
- [x] **KI-280** 🟡 — http-узел полностью не ретраится — `src/engine/execution-engine.service.ts,`
- [x] **KI-284** 🟡 — Вставка compare в связь теряет операнды — `web/src/stores/workflow.ts (addNodeOnEdge),` (Deferred)
- [x] **KI-304** 🟡 — Узлы подграфа видны в `node_runs`/SSE под префиксными id — `src/engine/execution-engine.service.ts,` (Deferred)

### Спринт 14 (Medium)

- [x] **KI-322** 🟡 — Подграф вне топ-50 `GET /workflow` → warning недостижим — `web/src/components/nodes/SubWorkflowNode.tsx,` (Deferred)
- [x] **KI-338** 🟡 — `condition`: непройденная ветка не помечается skipped — `src/engine/node-executors.ts, src/engine/execution-engine.service.ts` (Deferred)
- [x] **KI-340** 🟡 — `http.failOnHttpError` не ретраит 5xx/429 — `src/engine/node-executors.ts` (уже исправлено в S13)
- [x] **KI-344** 🟡 — KI-318 закрыт наполовину — `package.json, vitest.config.ts` (уже исправлено)

### Спринт 15 (Medium)

- [x] **KI-349** 🟡 — `TextNode` без target-handle при контракте `text-input` — `web/src/components/nodes/TextNode.tsx, src/engine/node-ports.ts`
- [x] **KI-356** 🟡 — REST-ответ workflow без DTO: web-зеркало расходится на shareToken — `src/workflow/workflow.controller.ts, src/db/schema.ts,` (Deferred)
- [x] **KI-357** 🟡 — REST-зеркала вне паритет-гейта: TemplateSummary, LlmModelInfo, — `web/src/lib/api.ts, web/src/lib/export-import-api.ts,` (Deferred)
- [x] **KI-370** 🟡 — дублирование маршрутизации в `MediaNodeExecutor` — `src/media/media-node-executor.service.ts` (Deferred)

### Спринт 16 (Medium)

- [ ] **KI-372** 🟡 — бюджет: фиксированный курс + нулевая оценка LLM — `src/runs/cost-budget.service.ts, src/config/env.schema.ts`
- [ ] **KI-379** 🟡 — KI-370 не закрыт, дублирование маршрутизации — `src/media/media-node-executor.service.ts,`
- [ ] **KI-381** 🟡 — серверной идемпотентности нет у Replicate/FAL/OpenAI — `src/media/providers/*.provider.ts`
- [ ] **KI-385** 🟡 — CreativeLab не отдаёт `type=AUDIO`: TTS-модели лежат в MUSIC — `src/media/media-generation.ts, web/src/lib/generation-node.ts`

### Спринт 17 (Medium)

- [ ] **KI-386** 🟡 — Метаданные результата музыки/аудио теряются на схеме задачи — `src/media/dto/media-task.dto.ts, src/media/dto/media-task.mapper.ts,`
- [ ] **KI-392** 🟡 — `matrix.unitParam='duration'` семантика не документирована — `src/runs/cost-budget.service.ts, src/media/dto/media-model.dto.ts`
- [ ] **KI-393** 🟡 — `pricing.plus` и `expr.units`-объекты не учитываются — `src/runs/cost-budget.service.ts`
- [ ] **KI-402** 🟡 — каталог embedding-моделей не формализован — `src/llm/llm-provider.factory.ts,`

### Спринт 18 (Medium)

- [ ] **KI-403** 🟡 — фильтрованный HNSW recall на масштабе — `src/db/schema.ts, src/vector/vector-store.service.ts`
- [ ] **KI-404** 🟡 — семантика VectorUpsert → VectorQuery — `src/engine/node-executors.ts`
- [ ] **KI-408** 🟡 — `node_runs.logs` агента дублирует транскрипт — `src/agent/agent.service.ts`
- [ ] **KI-426** 🟡 — `S3_TTL_DAYS` не удаляет объекты из бакета — `src/media/media-storage.service.ts`

### Спринт 19 (Medium)

- [ ] **KI-436** 🟡 — Agent: hard-cap превышается на один шаг — `src/agent/agent.service.ts`
- [ ] **KI-449** 🟡 — UI не различает «результат не сохранён» и «ссылка истекла» — `web/src/lib/media-source.ts`
- [ ] **KI-462** 🟡 — `document_gen` не проверяет лимит 500 блоков (Medium) — `v0.10.x`
- [ ] **KI-474** 🟡 — UI-селекты форматов у файловых узлов не применяются — `src/engine/node-executors.ts, web/src/components/nodes/*.tsx`

### Спринт 20 (Medium)

- [ ] **KI-475** 🟡 — 3D/Motion узлы не реализованы (перенесено из KI-196) — `web/src/lib/node-registry.ts,`
- [ ] **KI-497** 🟡 — Сводка `KNOWN_ISSUES.md` расходится с `grep` — `docs/KNOWN_ISSUES.md`
- [ ] **KI-509** 🟡 — Бейджи статусов и возможностей — светлые литералы (Medium) — `web/src/components/TopBar.tsx,`
- [ ] **KI-520** 🟡 — MCP-ссылки вне каталога не видны в UI узла `agent` — `web/src/components/nodes/AgentNode.tsx,`

### Спринт 21 (Medium)

- [ ] **KI-533** 🟡 — Глобальный `MCP_STDIO_ENV_ALLOWLIST` отдаёт все env всем серверам — `src/mcp/mcp-client.service.ts`
- [ ] **KI-537** 🟡 — Права на историю запусков уже, чем на сам запуск — `src/runs/runs.service.ts, src/runs/runs.controller.ts`
- [ ] **KI-538** 🟡 — В `workflow_runs` нет длительности и стоимости запуска — `src/runs/runs.service.ts, src/engine/execution-engine.service.ts,`
- [ ] **KI-661** 🟡 — Нет удаления аккаунта и согласия на обработку ПД — `web/src/components/auth/LoginPage.tsx, src/auth/**,`

### Спринт 22 (Low)

- [ ] **KI-013** 🟢 — `process.env` читается напрямую в обход `ConfigService` — `src/db/db.module.ts (DATABASE_URL), src/main.ts (PORT)`
- [ ] **KI-020** 🟢 — Мёртвое поле `executionMap` во фронтенде — `web/src/lib/api.ts`
- [ ] **KI-021** 🟢 — У `node_runs` нет `created_at` — `src/db/schema.ts`
- [ ] **KI-028** 🟢 — Дублирование `toMessage` в 4 файлах — `src/runs/runs.service.ts, src/runs/run-events.service.ts,`

### Спринт 23 (Low)

- [ ] **KI-029** 🟢 — Нет следа узла, если падение до INSERT в `node_runs` — `src/engine/execution-engine.service.ts`
- [ ] **KI-043** 🟢 — `node_runs.logs` — свободный текст — `src/db/schema.ts (node_runs.logs), src/engine/execution-engine.service.ts`
- [ ] **KI-044** 🟢 — `lint-staged` установлен, но не сконфигурирован — `package.json, .husky/pre-commit`
- [ ] **KI-045** 🟢 — Husky-файл `.husky/_/` не в `.gitignore` (проверить) — `.gitignore, .husky/_/`

### Спринт 24 (Low)

- [ ] **KI-051** 🟢 — Кэш ограничен одним `runId` — `src/engine/execution-engine.service.ts`
- [ ] **KI-054** 🟢 — Нет агрегата по запуску — `src/db/schema.ts (workflow_runs),`
- [ ] **KI-057** 🟢 — `isConfigured` не подхватывает смену ключа без перезапуска — `src/llm/providers/*.provider.ts`
- [ ] **KI-058** 🟢 — `isConfigured` — это «ключ задан», а не «ключ работает» — `src/llm/providers/*.provider.ts`

### Спринт 25 (Low)

- [ ] **KI-073** 🟢 — Точность номера попытки ограничена контрактом — `src/runs/dto/run-event.dto.ts, web/src/stores/workflow.ts`
- [ ] **KI-076** 🟢 — Панель фиксированной высоты без drag-ресайза — `web/src/components/RunResultPanel.tsx`
- [ ] **KI-089** 🟢 — `z.url({ protocol })` — deprecated в Zod 4 — `src/config/env.schema.ts`
- [ ] **KI-090** 🟢 — oxlint warning в `web/src/lib/api.ts` (pre-existing) — `web/src/lib/api.ts`

### Спринт 26 (Low)

- [ ] **KI-093** 🟢 — Возможности модели видны только у LLM-узла — `web/src/components/nodes/LLMNode.tsx`
- [ ] **KI-095** 🟢 — Правило включения env-провайдера разъехалось — `src/llm/llm-provider.factory.ts`
- [ ] **KI-098** 🟢 — Vision-возможности GPTunnel объявляются вручную — `.env.example (пример GPTUNNEL_MODELS)`
- [ ] **KI-100** 🟢 — `GET /media/models` тормозит на холодном кэше — `src/media/providers/creativelab.provider.ts`

### Спринт 27 (Low)

- [ ] **KI-102** 🟢 — `passthrough()` может дублировать имя поля в ответе — `src/media/dto/media-model.dto.ts, media-model.mapper.ts`
- [ ] **KI-103** 🟢 — `MediaProviderException` не различает, какой провайдер упал — `src/media/media-provider.interface.ts`
- [ ] **KI-115** 🟢 — `aspectRatio` не материализуется в `data` до первого изменения — `web/src/components/nodes/ImageGenNode.tsx`
- [ ] **KI-116** 🟢 — `aspect_ratio` рендерится только если у модели есть `options` — `web/src/components/nodes/ImageGenNode.tsx`

### Спринт 28 (Low)

- [ ] **KI-117** 🟢 — Каталог media кэшируется на сессию без инвалидации — `web/src/stores/workflow.ts`
- [ ] **KI-133** 🟢 — Статусные/notice-цвета вне узлов остаются палитрой Tailwind — `web/src/components/TopBar.tsx`
- [ ] **KI-135** 🟢 — CDP-фокус требует `Emulation.setFocusEmulationEnabled` — `—`
- [ ] **KI-136** 🟢 — `:focus` vs `:focus-visible` в инпутах узлов — `web/src/components/nodes/*.tsx,`

### Спринт 29 (Low)

- [ ] **KI-138** 🟢 — Тосты хранят готовый текст, а не ключ — `web/src/stores/workflow.ts (notice: { kind, text }),`
- [ ] **KI-139** 🟢 — Unmet peer: react-i18next хочет TypeScript ^5 — `web/package.json, web/pnpm-lock.yaml`
- [ ] **KI-140** 🟢 — Строки вне UI-слоя остаются русскими — `web/src/lib/api.ts, web/src/types/media.ts,`
- [ ] **KI-143** 🟢 — Нет локального CI-прогона для web перед push — `package.json (корневой), возможно .github/workflows/ci.yml`

### Спринт 30 (Low)

- [ ] **KI-144** 🟢 — web/ — самостоятельный пакет, но zod «одалживал» из корня — `web/package.json, pnpm-workspace.yaml (не содержит`
- [ ] **KI-146** 🟢 — Каталог: подсветка выбора не прокручивается и не отличима от hover — `web/src/components/NodeCatalogPopover.tsx`
- [ ] **KI-153** 🟢 — Стоимость локального вызова не зависит от наличия usage — `src/llm/model-pricing.ts (calculateCostUsdForProvider)`
- [ ] **KI-161** 🟢 — Позицию курсора нельзя проверить в CI — `web/src/hooks/use-preserve-cursor.ts`

### Спринт 31 (Low)

- [ ] **KI-171** 🟢 — auto-resize не учитывает смену ширины узла — `web/src/hooks/use-auto-resize.ts`
- [ ] **KI-172** 🟢 — Версия модели Yandex захардкожена (`latest`) — `src/llm/llm-provider.factory.ts`
- [ ] **KI-173** 🟢 — `pickDefaultMediaModel` не учитывает `deprecated` — `web/src/lib/media.ts`
- [ ] **KI-177** 🟢 — LM Studio auto-discovery работает только на старте — `src/llm/llm-provider.factory.ts`

### Спринт 32 (Low)

- [ ] **KI-178** 🟢 — Формат `YANDEX_MODELS` / `LMSTUDIO_MODELS` не валидируется Zod — `src/config/env.schema.ts`
- [ ] **KI-194** 🟢 — Note / Compare узлы — `web/src/types/graph.ts, web/src/lib/node-registry.ts`
- [ ] **KI-207** 🟢 — Параметры scrypt не фиксированы в хэше — `src/auth/auth.service.ts`
- [ ] **KI-208** 🟢 — @nestjs/passport в deps не используется — `package.json`

### Спринт 33 (Low)

- [ ] **KI-210** 🟢 — DESIGN v0.8 § 1 / § 3.1 называют guard «Passport»-овым — `docs/development/v0.8/DESIGN_V08_FEATURES.md`
- [ ] **KI-211** 🟢 — Пропущены номера KI-198 и KI-199 — `docs/KNOWN_ISSUES.md («Правила ведения»)`
- [ ] **KI-212** 🟢 — Сообщение коммита `88f53e4` содержит ошибочный «KI-106» — `git history (коммит 88f53e4)`
- [ ] **KI-218** 🟢 — Нет юнит-тестов `parseDurationToMs` и интеграционного теста ротации — `src/common/utils/parse-duration.ts,`

### Спринт 34 (Low)

- [ ] **KI-219** 🟢 — `refresh_tokens` не хранит контекст отзыва — `src/db/schema.ts`
- [ ] **KI-222** 🟢 — Env-схема не покрыта кейсами `AUTH_DISABLED=''` и `'garbage'` — `src/config/env.schema.spec.ts`
- [ ] **KI-225** 🟢 — Неточный маппинг 400 в LoginPage — `web/src/components/auth/LoginPage.tsx`
- [ ] **KI-226** 🟢 — Красный 401 в консоли на неаутентифицированном заходе — `src/auth/auth.controller.ts (POST /auth/refresh),`

### Спринт 35 (Low)

- [ ] **KI-227** 🟢 — `meAsync` мёртвый + alias `@/` в vitest — `web/src/lib/auth-api.ts, web/vitest.config.ts`
- [ ] **KI-229** 🟢 — `syncWorkflowUrlParam` через `history.replaceState` — роутер не знает — `web/src/components/TopBar.tsx (syncWorkflowUrlParam)`
- [ ] **KI-230** 🟢 — Нет unit-тестов на `ProtectedRoute` / `App` — `web/src/components/auth/ProtectedRoute.tsx,`
- [ ] **KI-235** 🟢 — Share-ссылка бессрочная и без аудита — `src/db/schema.ts (workflows),`

### Спринт 36 (Low)

- [ ] **KI-237** 🟢 — Повторный POST `/workflow/:id/share` молча перевыпускает токен — `src/workflow/workflow.service.ts`
- [ ] **KI-242** 🟢 — Сбой копирования не сообщается пользователю — `web/src/components/ShareModal.tsx`
- [ ] **KI-243** 🟢 — Флаг «Разрешить копирование» — UI-заглушка — `web/src/components/ShareModal.tsx`
- [ ] **KI-248** 🟢 — `reasoningEffort` не сбрасывается при смене модели — `web/src/components/nodes/LLMNode.tsx`

### Спринт 37 (Low)

- [ ] **KI-249** 🟢 — Union `ReasoningEffort` продублирован в трёх местах — `src/llm/llm-provider.interface.ts,`
- [ ] **KI-250** 🟢 — Placeholder «Max tokens» без пояснения — `web/src/components/nodes/LLMNode.tsx,`
- [ ] **KI-251** 🟢 — Нет unit-теста на `nodeDataFromApi` (LLM-поля) — `web/src/stores/workflow.ts,`
- [ ] **KI-252** 🟢 — Узлы из Toolbar не попадают на сетку 8×8 — `web/src/stores/workflow.ts (addNode, addNodeOnEdge)`

### Спринт 38 (Low)

- [ ] **KI-253** 🟢 — Хэш графа считается на любом изменении стора — `web/src/components/Canvas.tsx,`
- [ ] **KI-254** 🟢 — После Ctrl+D панель результата переключается на копию — `web/src/stores/workflow.ts (duplicateNodes)`
- [ ] **KI-255** 🟢 — `structuredClone` в `duplicateNodes` упадёт на несериализуемых полях — `web/src/lib/graph-edit.ts`
- [ ] **KI-262** 🟢 — `canBeInsertedOnEdge` не проверяется против фактических Handle — `web/src/lib/node-registry.ts,`

### Спринт 39 (Low)

- [ ] **KI-264** 🟢 — Смоук-харнесс CDP: узкий Fetch-перехват + windowsVirtualKeyCode — `временные скрипты смоука (вне репо)`
- [ ] **KI-267** 🟢 — `loadWorkflowAsync` при ошибке схемы молчит в консоль — `web/src/stores/workflow.ts (loadWorkflowAsync)`
- [ ] **KI-270** 🟢 — фронт шлёт мёртвый `userId: 'demo-user'` в POST /workflow — `web/src/stores/workflow.ts (DEFAULT_USER_ID),`
- [ ] **KI-272** 🟢 — `onFatalError` потока не снимает «выполняется» — `web/src/stores/workflow.ts`

### Спринт 40 (Low)

- [ ] **KI-273** 🟢 — Расширенные хоткеи: Ctrl+A / Ctrl+C / Ctrl+V / Ctrl+S / Ctrl+Shift+Backspace — `web/src/hooks/use-hotkeys.ts, web/src/components/Canvas.tsx`
- [ ] **KI-276** 🟢 — Ctrl+Z не работает при фокусе в поле ввода узла — `web/src/components/Canvas.tsx,`
- [ ] **KI-277** 🟢 — Load не чистит историю undo — `web/src/stores/workflow.ts (loadWorkflowAsync)`
- [ ] **KI-279** 🟢 — compare без контракта: fallback по targetHandle — `src/engine/node-ports.ts, src/engine/node-executors.ts`

### Спринт 41 (Low)

- [ ] **KI-281** 🟢 — http: тело ответа читается целиком перед обрезкой — `src/engine/node-executors.ts`
- [ ] **KI-282** 🟢 — condition: `evaluated` теряет типы — `src/engine/node-executors.ts`
- [ ] **KI-283** 🟢 — condition: эвристика ключей `input.X` — `src/engine/node-executors.ts`
- [ ] **KI-285** 🟢 — UI новых узлов: обрезка полей в карточке w-60 — `web/src/components/nodes/ConditionNode.tsx,`

### Спринт 42 (Low)

- [ ] **KI-286** 🟢 — CDP-смоук: Ctrl+A вставляет символ; каталог требует scrollIntoView — `временные скрипты смоука (вне репо)`
- [ ] **KI-291** 🟢 — `workflows.version` не переносится в артефакт экспорта — `src/workflow/workflow.service.ts (EXPORT_FORMAT_VERSION)`
- [ ] **KI-292** 🟢 — `nest build` не копирует `src/templates/*.json` в dist — `nest-cli.json, src/templates/template-loader.service.ts,`
- [ ] **KI-294** 🟢 — `ImportWorkflowSchema.name` без `.max(200)` — `src/workflow/dto/export-workflow.dto.ts`

### Спринт 43 (Low)

- [ ] **KI-295** 🟢 — `WorkflowController`: смешан Async-стиль — `src/workflow/workflow.controller.ts`
- [ ] **KI-297** 🟢 — Устаревший комментарий и мёртвый null-fallback в `findSharedAsync` — `src/workflow/workflow.service.ts`
- [ ] **KI-303** 🟢 — `inputsMap` не применяется executor'ом подграфа — `src/engine/node-executors.ts, web/src/types/graph.ts`
- [ ] **KI-305** 🟢 — Асимметрия пустого подграфа — `src/engine/execution-engine.service.ts,`

### Спринт 44 (Low)

- [ ] **KI-307** 🟢 — `autoPanOnNodeDrag` усиливает координаты узла при drag за край — `web/src/components/Canvas.tsx`
- [ ] **KI-308** 🟢 — `NodesController` без маршрутов (мёртвый модуль) — `src/nodes/nodes.controller.ts`
- [ ] **KI-309** 🟢 — Frontend-спек ловит литералы, не конкатенацию — `web/src/lib/api-prefixes.spec.ts`
- [ ] **KI-310** 🟢 — `web/tsconfig.app.json` (`types: ["vite/client"]`) блокирует `node:*` — `web/tsconfig.app.json`

### Спринт 45 (Low)

- [ ] **KI-311** 🟢 — `@Controller()` без `path` невидим для regex-паритета — `src/common/api-prefixes.spec.ts`
- [ ] **KI-313** 🟢 — Смоук-чек-лист: `/unknown/foo → 404` верен только для fetch — `docs/development/SMOKE_CDP.md (нет) или заметки`
- [ ] **KI-320** 🟢 — Паритет-гейт требует ручного маппинга типов колонок — `src/db/schema-parity.spec.ts`
- [ ] **KI-321** 🟢 — Гейт не сверяет length/order/constraints — `src/db/schema-parity.spec.ts`

### Спринт 46 (Low)

- [ ] **KI-323** 🟢 — TOCTOU: два конкурентных PATCH → `version +2` — `src/workflow/workflow.service.ts`
- [ ] **KI-324** 🟢 — Frontend hash vs backend deep-equal (type) — `web/src/lib/graph-hash.ts, src/workflow/workflow.service.ts`
- [ ] **KI-325** 🟢 — `updatedAt` меняется на идемпотентном PATCH — `src/workflow/workflow.service.ts`
- [ ] **KI-327** 🟢 — `AUTH_DISABLED=true` не обходит `POST /auth/refresh` — `src/auth/auth.controller.ts,`

### Спринт 47 (Low)

- [ ] **KI-332** 🟢 — TTL кэша workflow-list не видит изменений из другой вкладки — `web/src/lib/workflow-list-cache.ts`
- [ ] **KI-333** 🟢 — web/ без lint-скрипта и без oxlint в package.json — `web/package.json`
- [ ] **KI-335** 🟢 — Формула покрытия в KI-314 неточна — `docs/KNOWN_ISSUES.md (KI-314), web/src/components/Canvas.tsx`
- [ ] **KI-339** 🟢 — `node_runs.error` skipped не называет упавшего предшественника — `src/engine/execution-engine.service.ts`

### Спринт 48 (Low)

- [ ] **KI-341** 🟢 — «нет выходов» у узла: `null` у skipped vs `{}` у failed — `src/engine/execution-engine.service.ts`
- [ ] **KI-342** 🟢 — Двойник Drizzle в тестах не thenable — `src/engine/*.spec.ts, тестовые двойники db`
- [ ] **KI-343** 🟢 — `tsconfig.spec.json` не покрывает `app.e2e-spec.ts` — `tsconfig.spec.json, test/app.e2e-spec.ts`
- [ ] **KI-345** 🟢 — `--env-file=.env` на Node 24/Windows даёт `.env: not found` — `package.json (test:parity)`

### Спринт 49 (Low)

- [ ] **KI-346** 🟢 — `typecheck` не покрывает drizzle/** и корневые скрипты — `tsconfig.spec.json, tsconfig.build.json, drizzle/**`
- [ ] **KI-350** 🟢 — Фронт-SSE-зеркало мягче бэкенда — `web/src/types/run-stream.ts`
- [ ] **KI-351** 🟢 — 401-шум в консоли при заходе гостем — `web/src/components/auth/AuthProvider.tsx`
- [ ] **KI-354** 🟢 — дублирование обхода уровней в engine — `src/engine/execution-engine.service.ts`

### Спринт 50 (Low)

- [ ] **KI-355** 🟢 — обречённый подграф доигрывает независимые ветки — `src/engine/execution-engine.service.ts`
- [ ] **KI-358** 🟢 — у REST-ответов backend нет Zod: гейт разбирает TS-интерфейсы — `src/runs/runs.service.ts,`
- [ ] **KI-359** 🟢 — inline-union'ы финальных статусов запуска вне канона — `src/engine/execution-engine.service.ts (:164, :370, :1208),`
- [ ] **KI-360** 🟢 — Перспектива: вынос vector store в отдельный сервис — `src/db/schema.ts, src/engine/execution-engine.service.ts`

### Спринт 51 (Low)

- [ ] **KI-374** 🟢 — `bgremover` требует prompt, операция в нём не нуждается — `src/media/image-tool.ts`
- [ ] **KI-375** 🟢 — бюджет-бар только при активном run — `web/src/components/TopBar.tsx`
- [ ] **KI-376** 🟢 — sse-contract не расширен — `docs/development/sse-contract.json,`
- [ ] **KI-388** 🟢 — `durationSec`/`aspectRatio` в DESIGN § 3.2 не совпадают с каталогом; узел без модели не показывает поля — `docs/development/v0.9/DESIGN_V09_FEATURES.md (§ 3.2),`

### Спринт 52 (Low)

- [ ] **KI-389** 🟢 — TTS: нет каталога голосов, `speed` не объявлен ни одной моделью — `web/src/components/nodes/AudioGenNode.tsx, src/media/media-generation.ts`
- [ ] **KI-394** 🟢 — Миграция `BULLMQ_PREFIX` `bull` → `workflow-runs` (операционное) — `.env.example, src/runs/runs.worker-options.ts`
- [ ] **KI-395** 🟢 — allowlist sandbox расширен сверх DESIGN § 3.5 — `src/sandbox/quickjs-runner.service.ts,`
- [ ] **KI-396** 🟢 — CDP-смоук невоспроизводим без Docker (инфраструктурный) — `.smoke/** (скрипты), docs/development/ (SMOKE_CDP.md)`

### Спринт 53 (Low)

- [ ] **KI-400** 🟢 — Гонка duplicate-invite → 500 — `src/workflow/workflow.service.ts (inviteCollaboratorAsync)`
- [ ] **KI-411** 🟢 — `runError` не сбрасывается при успешном retry — `web/src/stores/workflow.ts`
- [ ] **KI-422** 🟢 — Лимиты @Throttle статические — `src/http-throttle.constants.ts`
- [ ] **KI-423** 🟢 — POST /auth/register и /auth/refresh без строгого лимита — `src/auth/auth.controller.ts`

### Спринт 54 (Low)

- [ ] **KI-428** 🟢 — Cron-очистка media покрыта только unit-тестами — `src/media/media-cleanup.service.spec.ts`
- [ ] **KI-429** 🟢 — Неполная формула зазора при вставке узла — `web/src/lib/graph-edit.ts`
- [ ] **KI-430** 🟢 — Регистрозависимость схемы URL — `web/src/types/media.ts`
- [ ] **KI-431** 🟢 — `PROMPT_CACHE_MIN_TOKENS` не объявлена в `EnvSchema` — `src/config/env.schema.ts`

### Спринт 55 (Low)

- [ ] **KI-432** 🟢 — Порог промпт-кэша считается в символах, а не в токенах — `src/llm/providers/anthropic.provider.ts`
- [ ] **KI-438** 🟢 — Пустой `audioUrl` у lipsync не блокирует Run — `web/src/lib/image-tool-node.ts`
- [ ] **KI-441** 🟢 — `TRUST_PROXY` не задаёт число хопов / подсети — `src/config/env.schema.ts`
- [ ] **KI-447** 🟢 — Route-level lazy для Canvas/ShareViewPage — `web/src/App.tsx`

### Спринт 56 (Low)

- [ ] **KI-458** 🟢 — `PGVECTOR_ENABLED=false` не отключает vector-инструменты агента (Low) — `v0.10 S10`
- [ ] **KI-473** 🟢 — Коллизия ссылок в `node-executors.ts` — `src/engine/node-executors.ts`
- [ ] **KI-476** 🟢 — Реестр KI: KI-001 ломает счётчики статусов — `docs/KNOWN_ISSUES.md (KI-001, сводка)`
- [ ] **KI-477** 🟢 — `read_file` в `NODE_PORT_CONTRACT` имеет target-хендл — `src/engine/node-ports.ts,`

### Спринт 57 (Low)

- [ ] **KI-480** 🟢 — Расхождение имён `document_generation` и `document_gen` (Low) — `web/src/lib/node-registry.ts,`
- [ ] **KI-484** 🟢 — `WORKFLOW_RUN_LEASE_TTL_MS` без верхней границы — `src/config/env.schema.ts`
- [ ] **KI-485** 🟢 — `schema-parity` маппит все `PgCustomColumn` в `bytea` — `src/db/schema-parity.spec.ts`
- [ ] **KI-486** 🟢 — `drizzle-kit` кавычит custom SQL-тип — `drizzle/0012_document_templates.sql`

### Спринт 58 (Low)

- [ ] **KI-487** 🟢 — Конфликт `heartbeat < staleThreshold` с верхней границей heartbeat — `docs/development/v0.11/DESIGN_V011_FEATURES.md, src/config/env.schema.ts`
- [ ] **KI-488** 🟢 — Дублирование константы `MCP_MAX_TOOLS_PER_NODE_LIMIT` — `src/config/env.schema.ts, web/src/types/graph.ts`
- [ ] **KI-489** 🟢 — Причина ошибки загрузки/удаления шаблона не показывается — `web/src/components/nodes/DocumentGenNode.tsx`
- [ ] **KI-490** 🟢 — variables-черновик не ресинхронизируется при undo/redo — `web/src/components/nodes/DocumentGenNode.tsx`

### Спринт 59 (Low)

- [ ] **KI-491** 🟢 — Список шаблонов не обновляется при возврате к узлу — `web/src/components/nodes/DocumentGenNode.tsx`
- [ ] **KI-492** 🟢 — Дублирование контракта `document_gen` frontend ↔ backend — `web/src/types/graph.ts, src/engine/node-executors.ts`
- [ ] **KI-493** 🟢 — Гонка повторного `startAsync` и тика — `src/runs/run-lease.service.ts`
- [ ] **KI-494** 🟢 — `lease_expires_at` не обнуляется при завершении — `src/engine/execution-engine.service.ts`

### Спринт 60 (Low)

- [ ] **KI-495** 🟢 — Рост `#stopped` в памяти — `src/runs/run-lease.service.ts`
- [ ] **KI-496** 🟢 — Нет DB-интеграционного спека на SQL-флаги — `src/runs/runs.processor.spec.ts`
- [ ] **KI-498** 🟢 — Дублирование релизных метрик в документации — `README.md, docs/README.md, PROMPT_CURRENT.md`
- [ ] **KI-499** 🟢 — Нет проверки markdown-ссылок в CI — `.github/workflows/ci.yml`

### Спринт 61 (Low)

- [ ] **KI-502** 🟢 — Нет DB-интеграционного спека на кэш-колонки — `src/engine/execution-engine.service.spec.ts`
- [ ] **KI-503** 🟢 — `cacheSavingsUsd` агента не в SSE — `src/runs/run-node-snapshots.ts`
- [ ] **KI-504** 🟢 — Нет теста на env-переопределение retry в движке — `src/engine/execution-engine.service.spec.ts`
- [ ] **KI-505** 🟢 — `restoreRunAsync` не отменяет REST-запросы — `web/src/stores/workflow.ts`

### Спринт 62 (Low)

- [ ] **KI-506** 🟢 — `NodeRunSnapshot` гейтуется двумя файлами — `sse-contract.json, api-contract.json`
- [ ] **KI-507** 🟢 — Нет автоматического UI-гейта на F5 — `.smoke/s12-s13-smoke.mjs`
- [ ] **KI-508** 🟢 — Нет теста API-обёрток `fetchRunAsync`/`fetchRunNodesAsync` — `web/src/lib/api.spec.ts`
- [ ] **KI-510** 🟢 — Глобальные поверхности (Toast, модалки, логин) — светлые литералы (Low) — `web/src/components/Toast.tsx,`

### Спринт 63 (Low)

- [ ] **KI-512** 🟢 — Тёмная тема: рамка `pending`-узла почти не видна (Low) — `web/src/styles/theme.css,`
- [ ] **KI-513** 🟢 — Хрупкий deep-import `ThrottlerStorageRecord` — `src/common/throttler/redis-throttler.storage.ts`
- [ ] **KI-514** 🟢 — Нет валидации ответа Lua в Redis Throttler — `src/common/throttler/redis-throttler.storage.ts`
- [ ] **KI-515** 🟢 — `THROTTLER_STORAGE=memory` создает Redis-соединение — `src/common/throttler/redis-throttler.storage.ts`

### Спринт 64 (Low)

- [ ] **KI-516** 🟢 — Нет CI-гейта на два инстанса (Throttler) — `.github/workflows/ci.yml`
- [ ] **KI-517** 🟢 — `Dockerfile` не пинит версию Node (>= 22.19) — `Dockerfile`
- [ ] **KI-519** 🟢 — Ожидаемые метрики в `RELEASES.md` не сверяются с фактом — `docs/development/RELEASES.md`
- [ ] **KI-521** 🟢 — Действующий лимит MCP читается независимо в двух местах — `src/mcp/mcp.controller.ts, src/agent/agent.service.ts,`

### Спринт 65 (Low)

- [ ] **KI-523** 🟢 — `maxRetries: 0` для SDK захардкожен — `src/llm/providers/openai-compatible.provider.ts,`
- [ ] **KI-524** 🟢 — Список операций `image_tool` продублирован в UI — `src/media/image-tool.ts, web/src/types/graph.ts`
- [ ] **KI-535** 🟢 — WARN «stdio без Docker» только при первом подключении — `src/mcp/mcp-client.service.ts`
- [ ] **KI-536** 🟢 — `MCP_STDIO_CWD` не канонизируется — `src/config/env.schema.ts`

### Спринт 66 (Low)

- [ ] **KI-539** 🟢 — `started_at` по умолчанию = времени создания запуска — `src/db/schema.ts, src/runs/runs.service.ts`
- [ ] **KI-543** 🟢 — Список истории не обновляется в реальном времени — `web/src/components/RunHistoryModal.tsx`
- [ ] **KI-557** 🟢 — Гонка регистрации с одинаковым email → 500 вместо 409 — `src/auth/auth.service.ts (registerAsync)`
- [ ] **KI-559** 🟢 — Удаление организации падает на FK `workflow_collaborators.invited_by` — `src/db/schema.ts`

### Спринт 67 (Low)

- [ ] **KI-610** 🟢 — Grafana dashboard статичен: панели не проверяются в CI и нет alert rules — `infra/grafana/dashboard.json`
- [ ] **KI-612** 🟢 — OTel-трейсы не экспортируются в Prometheus — `src/observability/, src/metrics/`
- [ ] **KI-614** 🟢 — Logout не отзывает access-токен — `src/auth/auth.controller.ts, src/auth/auth.service.ts,`
- [ ] **KI-615** 🟢 — `JwtAuthGuard` делает SELECT в БД на каждый аутентифицированный запрос — `src/auth/guards/jwt-auth.guard.ts`

### Спринт 68 (Low)

- [ ] **KI-616** 🟢 — Email маскируется только в `member.invite`/`member.remove` — `src/audit/audit.interceptor.ts`
- [ ] **KI-665** 🟢 — QR без GMS: кнопка молча ничего не делает — `web/src/hooks/useQrScanner.ts, web/src/components/TopBar.tsx`
- [ ] **KI-668** 🟢 — CORS_ALLOWED_ORIGINS действует только в production — `src/config/cors.ts, src/main.ts, .env.example`
- [ ] **KI-669** 🟢 — Allowlist `/metrics` не поддерживает IPv6-CIDR — `src/metrics/metrics-ip-allowlist.ts`

## Лог спринтов

| Спринт | KI | Результат | Коммит |
|--------|----|-----------|--------|
| 01 | KI-667, KI-011, KI-024, KI-025 | 4 Fixed; 2135 тестов зелёные | `70f4224` |
| 02 | KI-026, KI-027, KI-033, KI-035 | 2 Fixed, 2 Won't Fix; 162 теста зелёные | `5dc320d` |
| 03 | KI-038, KI-041, KI-042, KI-049 | 4 Fixed (верификация, код не менялся) | `f2f816a` |
| 04 | KI-050, KI-053, KI-056, KI-060 | 1 Fixed, 1 Won't Fix, 2 Deferred | `15be954` |
| 05 | KI-061, KI-062, KI-063, KI-064 | 2 Fixed, 1 Deferred, 1 Won't Fix; +3 теста | `b244d19` |
| 06 | KI-068, KI-087, KI-092, KI-094 | 1 Fixed, 2 Documented, 1 Won't Fix | `5ff30a2` |
| 07 | KI-096, KI-097, KI-099, KI-101 | 1 Deferred, 2 Documented, 1 Won't Fix | `0553d7f` |
| 08 | KI-106, KI-107, KI-119, KI-131 | 1 Fixed (UI+i18n), 3 Deferred | `e2303a7` |
| 09 | KI-145, KI-170, KI-184, KI-191 | 1 Fixed, 2 Deferred, 1 Documented | `da82928` |
| 10 | KI-203, KI-209, KI-216, KI-223 | 3 Fixed (2 с кодом), 1 Deferred | `f3e53ab` |
| 11 | KI-224, KI-231, KI-239, KI-240 | 2 Fixed (frontend), 2 Deferred | `0903ec7` |
| 12 | KI-241, KI-244, KI-269, KI-275 | 2 Fixed (2 с кодом), 1 Deferred, 1 Documented | `0bf2e80` |
| 13 | KI-278, KI-280, KI-284, KI-304 | 1 Fixed (код+тест), 3 Deferred | `9366a08` |
| 14 | KI-322, KI-338, KI-340, KI-344 | 2 Fixed (по факту), 2 Deferred | `54e4175` |
| 15 | KI-349, KI-356, KI-357, KI-370 | 1 Fixed (UI), 3 Deferred | (текущий) |
