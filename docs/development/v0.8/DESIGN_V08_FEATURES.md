# DESIGN v0.8 — Фичи для продукта

**Файл:** `docs/development/v0.8/DESIGN_V08_FEATURES.md`
**Версия:** 1.0 (final)
**Дата:** 2026-10-15
**Статус:** Approved
**Закрывает (Fixed):** KI-106, 108, 109, 183, 185, 186, 187, 188, 189,
190, 191, 192, 193, 194, 195, 197
**Связанные:** KI-105, 128 (v0.9), KI-196 (v0.9)
**RULES:** 2.5, 2.14

---

## 1. Контекст

После v0.7.2 проект имеет рабочий цикл
«нарисовал → сохранил → запустил → LLM/media выполнил → результат в узле».
Открыто **190 KI**, из них **110 Open**. Gap-анализ GPTunnel (2026-10-15)
выявил **12 пропущенных фич**, критичных для «продуктового» уровня.

**v0.8 закрывает 16 KI** в 4 направлениях:

| Направление | KI | Приоритет |
|---|---|---|
| **Auth + Share** | KI-106, KI-197 | 🟠 High |
| **LLM upgrade** | KI-192 (system prompt), KI-193 (reasoning), KI-183 (maxTokens) | 🟠 High |
| **Canvas UX** | KI-185, 186, 187, 188, 189, 190, 191, 195 | 🟡 Medium |
| **Node types** | KI-105, KI-194 | 🟡 Medium |
| **Export/Import/Templates** | KI-108, KI-109 | 🟡 Medium |
| **Sub-workflows** | (новый, KI-200) | 🟠 High |

**Почему одним DESIGN:** все 16 KI **пересекаются** в `NodeData`,
`stores/workflow.ts`, `Canvas.tsx`, `LLMNode.tsx`. Если делать по
отдельности — одни и те же файлы дважды, конфликты, регрессии.

**Ключевая идея:** **расширяем существующие структуры**, не создаём
новые. `NodeData` — уже discriminated union по `kind`; добавляем поля,
не ломая типы. `NODE_REGISTRY` — уже единый реестр; вводим новые узлы
через него.

---

## 2. Ключевое архитектурное решение

**Три слоя изменений:**

1. **Backend API** — auth (JWT + Passport), share (shareToken),
   sub-workflow executor. **Изолированные модули**, не трогают
   существующий Engine / Runner.
2. **Frontend editor** — Canvas UX (7 фич), LLM upgrade (system/
   reasoning), новые типы узлов. **Всё через `NODE_REGISTRY`**.
3. **Совместимость** — все новые поля `NodeData` — optional, старые
   workflow работают без миграции; `nodeDataFromApi` переносит новые
   поля (ловушка KI-122/129).

**Правила:**
- **1 фича = 1 коммит** (RULES § 3.2). 16 KI → ~7 подшагов R6.1…R6.7.
- **Backend-only** модули (auth, share) — свои тесты + smoke.
- **Frontend-only** фичи (Canvas UX) — CDP-smoke.
- **При пересечении файлов** — держать единый контракт в `types/graph.ts`.

---

## 3. Auth (KI-106)

### 3.1. Стратегия

**R6.1a (MVP, backend):** JWT access (**24 ч**), кастомный
`JwtAuthGuard` через `@nestjs/jwt` (без `passport-jwt`),
пароли — `node:crypto` (scrypt, формат `scrypt$<salt>$<hash>`).

**R6.1b (frontend):** refresh-cookie (httpOnly, sameSite=strict,
7 дней) + fetch interceptor (401 → refresh → retry).

**Passport:** `@nestjs/passport` остаётся в deps как задел,
не используется в R6.1a (KI-201).

**Multi-tenant готовность:** в схеме `workflows.userId` **уже есть**
(nullable). После v0.8 — **обязателен**.

### 3.2. Схема БД

Добавить таблицу `users` (миграция):

    CREATE TABLE users (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email       text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    -- workflows.user_id: nullable -> NOT NULL (с backfill на 'demo-user')
    ALTER TABLE workflows ALTER COLUMN user_id SET NOT NULL;

Миграция: `drizzle/0004_add_users.sql` (backfill существующих
`demo-user` в системного пользователя).

### 3.3. Эндпоинты

- `POST /auth/register` — `{ email, password }` → `{ accessToken, user }`.
- `POST /auth/login` — `{ email, password }` → `{ accessToken, user }`
  + refresh cookie.
- `POST /auth/refresh` — cookie → новый access.
- `POST /auth/logout` — удалить cookie.
- `GET /auth/me` — текущий user.

### 3.4. Guards

- `JwtAuthGuard` (Passport) — на `WorkflowController`,
  `RunsController`, `LlmController` (кроме `/llm/models` — публичный).
- `@CurrentUser()` — декоратор, инжектит `userId` из JWT.
- **Все запросы** к `/workflow`, `/runs` — фильтр по `userId`.

### 3.5. Frontend

- **`LoginPage`** — email + password, register/login toggle.
- **`AuthProvider`** — контекст: `{ user, login, logout }`.
- **`ProtectedRoute`** — редирект на `/login` при 401.
- **Axios/fetch interceptor** — 401 → попытка refresh → retry.
- **TopBar** — меню user (email, logout).

### 3.6. Совместимость

- **Системный пользователь** `system@workflow-builder.local` с
  **детерминированным UUID**
  `00000000-0000-0000-0000-000000000001` создаётся в миграции
  0004 (`INSERT ... ON CONFLICT DO NOTHING`).
- **Backfill:** все `workflows.user_id`, указывавшие на `demo-user`
  (если есть), → `system.id`.
- **AUTH_DISABLED=true** (dev/CI) → `sub = DEMO_USER_ID`
  (`00000000-0000-0000-0000-000000000001`) — **валидный uuid**,
  запросы к `workflows.user_id` работают.
- **Важно:** `demo-user` как строка **не используется** (users.id —
  uuid; `WHERE id = 'demo-user'` упал бы в Postgres).

---

## 4. Share (KI-197)

### 4.1. Схема

Колонка в `workflows`:

    ALTER TABLE workflows ADD COLUMN share_token uuid UNIQUE;

`share_token` — nullable. Если `NULL` — share выключен.

### 4.2. Эндпоинты

- `POST /workflow/:id/share` — owner → создать/обновить `share_token`.
- `DELETE /workflow/:id/share` — отозвать (`share_token = NULL`).
- `GET /workflow/share/:token` — **без auth**, read-only.

Ответ `GET /workflow/share/:token` — **без `userId`**, только
`{ id, name, nodes, edges, createdAt }`.

### 4.3. Frontend

- **Кнопка «Поделиться»** в TopBar → модалка:
  - Toggle «Доступ по ссылке» (создать/отозвать).
  - Поле с URL (`https://app/workflow/share/<token>`), Copy.
  - Toggle «Разрешить копирование» (флаг `allowCopy` в share-модалке).
- **Read-only режим:** роут `/workflow/share/:token` рендерит Canvas
  с `isReadOnly=true`: баннер «Только просмотр», скрыть Toolbar/Save/
  Run, `nodesDraggable=false`, `nodesConnectable=false`.
- **Копирование** — если `allowCopy`, кнопка «Скопировать к себе» →
  `POST /workflow/import` (см. § 9).

### 4.4. Безопасность

- `share_token` — **capability-токен** (uuid v4). **Не логировать**
  (RULES § 5.9).
- Не показывать `share_token` в чужих списках.
- Rate-limit на `GET /workflow/share/:token` (защита от брутфорса) —
  опционально в v0.8, или отложить.

**Участники-по-ID** (из GPTunnel) — **v0.9**, не в этом DESIGN.

---

## 5. Sub-workflows (KI-200, новый)

### 5.1. Идея

Узел `sub_workflow` — ссылка на **другой workflow**. Executor:
загружает подграф, выполняет его как часть текущего, возвращает
результат.

### 5.2. NodeData

    export type SubWorkflowNodeData = {
      kind: 'sub_workflow';
      workflowId: string;
      /** Снимок версии графа на момент сохранения ссылки. */
      version?: number;
      /** Input mapping: имя входа → ключ в inputs подграфа. */
      inputsMap?: Record<string, string>;
    };

    // Добавить в union:
    export type NodeData =
      | TextNodeData | LlmNodeData | ImageGenNodeData
      | SubWorkflowNodeData; // v0.8

### 5.3. Executor

**Backend `ExecutionEngineService`:**

1. При `kind === 'sub_workflow'`:
   - Загрузить `workflow` по `workflowId`.
   - Валидировать `version` (если задана) — снимок.
   - **Рекурсия protection:** `visitedWorkflows: Set<string>` в контексте
     запуска; при повторном `workflowId` → `Exception`.
   - **Слить** nodes/edges подграфа в текущий `executionMap`
     (с префиксом `sub_<nodeId>__`) — изоляция ID.
2. Результаты подграфа → в `node_runs.outputs` с ключом `result`.

### 5.4. UI

- В каталоге — секция «Композиция» → узел «Под-воркфлоу».
- В узле — селект своих workflow (по API `GET /workflow`).
- Превью имени + кнопка «Открыть в редакторе» (новый таб).

### 5.5. Версионирование

- `workflows.version: number` (уже есть? проверить).
- Sub_workflow сохраняет `version` при добавлении — чтобы апдейт
  родителя не ломал детей.
- При изменении подграфа — пользователю показать «есть новая версия».

### 5.6. Риски

- **Глубина рекурсии** — ограничить 5 уровнями.
- **Размер графа** — если подграф большой, UI может лаг.
- **Ошибка в подграфе** — пробрасывать наверх как ошибку узла.

---

## 6. LLM upgrade (KI-192, KI-193, KI-183)

### 6.1. Расширение NodeData

    export type LlmNodeData = {
      kind: 'llm';
      model: string;
      prompt?: string;         // введён в KI-180
      systemPrompt?: string;   // KI-192
      reasoningEffort?: 'off' | 'medium' | 'high'; // KI-193
      maxTokensOverride?: number; // KI-183 (опционально)
    };

Все поля — **optional**, старые workflow работают.

### 6.2. UI LLMNode

- **System prompt** — сворачиваемый блок (toggle «▶ System»),
  `<textarea>` + auto-resize (KI-169).
- **Reasoning** — `<select>`: Off / Medium / High.
  Показывать только для моделей с `capabilities.reasoning === true`
  (нужно расширить `ModelInfo`).
- **Max tokens** — число, дефолт по модели.

### 6.3. Backend

`LlmNodeExecutor`:
- Собирает `messages`:
    [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      { role: 'user', content: userPrompt },
    ]
- `reasoning_effort` — передаётся в SDK (у некоторых провайдеров —
  отдельное поле; проверить в `openai-compatible.provider`).
- `max_tokens` — из `maxTokensOverride` или дефолт (`DEFAULT_MAX_TOKENS`
  → теперь per-model).

### 6.4. `ModelInfo` — расширение

Добавить в `ILlmProvider`:

    readonly models: readonly ModelInfo[];

    export interface ModelInfo {
      id: string;
      label: string;
      inputModalities: readonly ModelModality[];
      outputModalities: readonly ModelModality[];
      /** v0.8: поддержка reasoning (off/medium/high). */
      supportsReasoning?: boolean;
      /** v0.8: дефолт max_tokens (если не задан override). */
      defaultMaxTokens?: number;
    }

Env-формат (`LMSTUDIO_MODELS` и др.) — расширить:
`<id>:<modalities>[:reasoning]` — опциональный суффикс `:reasoning`.

### 6.5. Максимальная совместимость

- **KI-183:** default maxTokens для reasoning-моделей — **4096**
  (вместо 1024).
- **KI-179** (уже Fixed) — fallback reasoning; вместе с KI-193
  пустой content не должен возникать.

---

## 7. Canvas UX (KI-185..191, 195)

**7 фич одним подшагом** (R6.4). Все — frontend-only,
`web/src/components/Canvas.tsx` + новые хуки.

### 7.1. KI-185 — Вставка узла в связь

- **Hover на edge** → показать «+» в середине (`EdgeLabelRenderer`).
- **Клик «+»** → открыть каталог узлов (переиспользовать
  `NodeCatalogPopover`).
- **Выбор узла** → split: `source → new`, `new → target`.
- **Клик «×»** → удалить edge (дублирует Delete).

### 7.2. KI-186 — Расширенный список хоткеев

Создать `web/src/hooks/use-hotkeys.ts`:

    type HotkeyHandler = (event: KeyboardEvent) => void;

    export function useHotkeys(
      bindings: Record<string, HotkeyHandler>,
      deps?: unknown[],
    ): void;

- Игнорировать, если `activeElement` — `input`/`textarea`/`select`.
- Приоритет: `ctrl+*` > одиночные.

**Список:**
- `Tab` — открыть каталог.
- `S` — cursor mode.
- `H` — hand mode.
- `F` — fit view.
- `C` — добавить комментарий (KI-187).
- `Shift+C` — показать/скрыть комментарии.
- `Ctrl+A` — выделить всё.
- `Ctrl+C/V` — копи/паст.
- `Ctrl+D` — дублировать (KI-191).
- `Delete` / `Backspace` — удалить выделенное.
- `Ctrl+Shift+Backspace` — очистить промпт выделенных.
- `Ctrl+Z` / `Ctrl+Shift+Z` — undo/redo (нужен history store).
- `Ctrl+S` — сохранить.

**История (undo/redo)** — отдельный slice в Zustand:
`past: Snapshot[]`, `future: Snapshot[]`, max 50. Snapshot = `{ nodes,
edges }` (deep clone через `structuredClone`).

### 7.3. KI-187 — Комментарии/аннотации

- Новый тип узла `comment` (`NODE_REGISTRY`).
- Простой стикер: `<textarea>` без handles, `draggable`.
- `Shift+C` — toggle visibility.
- Сохраняется в `nodes` как обычный узел.

### 7.4. KI-188 — Cursor / Hand (S / H)

- `useHotkeys`: `S` → `panOnDrag=false` (selection), `H` → `true`.
- Кнопки в правой панели.
- Сохранять в store (`canvasMode: 'select' | 'pan'`).

### 7.5. KI-189 — Snap / Направляющие

- `snapToGrid: true`, `snapGrid: [8, 8]` в ReactFlow.
- **Custom guides** — `useAligning` (React Flow 12 helper) или
  ручная реализация через `<HelperLines />`.
- `Ctrl` (при перетаскивании) — временно отключить snap.

### 7.6. KI-190 — Миникарта toggle

- `showMinimap: boolean` в store, `localStorage` persistence.
- Хоткей `M`.
- Кнопка в правой панели.
- **Учесть KI-158** — CSS-контраст (`theme.css`) работает через
  `display: none` → стили остаются, но не видны.

### 7.7. KI-191 — Дублировать узел (Ctrl+D)

- `store.duplicateNodes(ids: string[])`:
  - Deep clone + новый `id` (`crypto.randomUUID()`).
  - Offset `+30 / +30`.
  - **Не дублировать edges** (только узлы).
- Хоткей `Ctrl+D`.

### 7.8. KI-195 — Auto-save

- `useDebouncedEffect` — 3 сек после последнего изменения.
- Индикатор в TopBar: «Сохранено» / «Есть изменения» (dirty state).
- Ручной Save остаётся (fallback).

**Dirty state:** сравнивать `nodes`/`edges` с последним сохранённым
snapshot (deep equal через hash). Хранить `lastSavedHash: string`.

---

## 8. Node types (KI-105, KI-194)

**v0.8 — только text-узлы** (медиа-узлы — v0.9).

### 8.1. `http` — HTTP-запрос

    export type HttpNodeData = {
      kind: 'http';
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      url: string;
      headers?: Record<string, string>;
      body?: string;
      timeoutMs?: number;
    };

- UI: `<select>` method, `<input>` url, textarea body (JSON).
- Backend executor: `fetch` с AbortSignal.timeout.
- Выход: `{ status, body }`.

### 8.2. `condition` — Ветвление

    export type ConditionNodeData = {
      kind: 'condition';
      /** JS-выражение, true → true-branch. */
      expression: string;
    };

- 1 вход, 2 выхода (`true` / `false`).
- Executor: `new Function('input', 'return ' + expr)` — **опасно**,
  лучше JSON-path или ограниченный DSL (v0.9 — sandbox).
- **MVP:** только `input.value > N` / `includes` / `===`.

### 8.3. `output` — Терминальный узел

- 1 вход, 0 выходов.
- Сохраняет результат в `workflow_runs.outputs` под ключом `name`.
- UI: `<input>` name.

### 8.4. `note` — Стикер (см. KI-187)

- См. § 7.3.

### 8.5. `compare` — Сравнение

    export type CompareNodeData = {
      kind: 'compare';
      mode: 'diff' | 'llm-judge';
      model?: string; // для llm-judge
    };

- 2 входа, 1 выход (`{ winner, diff }`).
- `diff` — простое сравнение строк.
- `llm-judge` — prompt к LLM: «Какой из двух ответов лучше?».

### 8.6. Расширение реестра

- 4 новых типа → `NODE_REGISTRY`.
- **Категории:** `http`/`condition`/`output` → `tools` / `output`;
  `note` → `input`; `compare` → `ai`.
- `kind` ↔ `NodeType` — расширить `NodeData` union.

### 8.7. Migrations

- **`nodeDataFromApi`** — расширить на 4 новых типа
  (по аналогии с KI-129).
- **`createNode`** — обработать (без `default:`).
- **`isNodeType`** — автоматически через `NODE_REGISTRY`.

---

## 9. Export / Import / Templates (KI-108, KI-109)

### 9.1. Export

- `GET /workflow/:id/export` → JSON:
    {
      version: 1,
      name: string,
      nodes: NodeDto[],
      edges: EdgeDto[],
      exportedAt: string,
    }
- Без `userId`, `id`, `share_token` — **sharable**.

### 9.2. Import

- `POST /workflow/import` — body = экспортированный JSON.
- Создаёт новый workflow у текущего `userId`.
- **Валидация:** Zod-схема импорта (`z.literal(1)` для version).
- **Ремап ID:** не обязательно, если граф внутри консистентен.

### 9.3. Templates

- **`templates` в репозитории** (`src/templates/*.json`) — 3-5 штук:
  - `text-llm-image` — базовый.
  - `text-llm` — с system prompt.
  - `http-llm` — HTTP → LLM.
  - `llm-compare` — 2 LLM → Compare.
- `GET /templates` → список.
- `POST /templates/:id/instantiate` → создать новый workflow.
- UI: в Load-модалке — таб «Шаблоны».

---

## 10. Совместимость и миграция

### 10.1. NodeData

- **Все новые поля optional.** Существующие workflow работают.
- `nodeDataFromApi` — расширить на новые поля (по типам).
- `createNode` — не сломать `satisfies`.

### 10.2. DB

- Миграция `0004` — users + backfill `user_id` + `share_token`.
- `workflows.user_id` — `NOT NULL` после backfill.
- `workflows.share_token` — nullable unique.

### 10.3. Env

- `JWT_SECRET` — обязательна в prod, default в dev.
- `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`.
- `AUTH_DISABLED=true` — для smoke/CI.

### 10.4. RULES — обновления

- § 1.15 — «новый узел = 1 файл + 1 регистрация».
- § 4.34 — Zod-схемы экспорта/импорта.
- § 5.11 — capability-токены (share) не логировать.

---

## 11. План работ — 7 подшагов

| Подшаг | Что | KI | ~Время |
|---|---|---|---|
| **R6.1** | Auth — users, JWT, guards, frontend login | KI-106 | 4 ч |
| **R6.2** | Share — share_token, read-only, копирование | KI-197 | 3 ч |
| **R6.3** | LLM upgrade — system/reasoning/maxTokens | KI-192, 193, 183 | 3 ч |
| **R6.4** | Canvas UX — 8 фич | KI-185..191, 195 | 6 ч |
| **R6.5** | Node types — http/condition/output/note/compare | KI-105, 194 | 5 ч |
| **R6.6** | Export/Import/Templates | KI-108, 109 | 3 ч |
| **R6.7** | Sub-workflows — executor, UI, версионирование | KI-200 | 4 ч |

**Итого:** ~28 ч чистой работы dsh + ревью (7 номеров R6.1..R6.7,
8 сессий: R6.4 разбит на a/b).

**Порядок важен:**
- R6.1 **первым** — auth нужен для share.
- R6.2 после R6.1 — share использует `userId`.
- R6.3 независимо.
- R6.4 независимо.
- R6.5 после R6.4 (Canvas UX даёт snap/duplicate для новых узлов).
- R6.6 после R6.5.
- R6.7 **последним** — использует все предыдущие.

---

## 12. Что НЕ входит в v0.8

| KI | Что | Куда |
|---|---|---|
| **KI-196** | Медиа-инструменты (upscale, bg-removal, lipsync, 3D, motion) | v0.9 |
| **KI-128** | Vector DB / Memory / Agent | v0.9 |
| **KI-105 (part)** | Video / Audio / Music узлы | v0.9 |
| **KI-067** | Per-provider семафоры | v0.8.x |
| **KI-048** | Бюджет вызовов на запуск | v0.8.x |
| **KI-062** | Retryable `APIConnectionError` | v0.8.x |
| **KI-077** | `GET /runs/:id/nodes` | v0.8.x |
| **KI-061** | `GET /runs` (список) | v0.8.x |
| **KI-063** | Финальность в snapshot | v0.8.x |
| **KI-150, 155, 066** | Мелкие фиксы | v0.8.x |
| **KI-177, 178** | LM Studio refresh / Zod валидация *_MODELS | v0.8.x |

---

## 13. Риски и открытые вопросы

### 13.1. Риски

1. **Auth ломает существующие workflow.** Backfill `demo-user` →
   системный. **Митигация:** флаг `AUTH_DISABLED` в dev/CI.

2. **Sub-workflow рекурсия.** Глубина 5, `visitedWorkflows`.
   **Митигация:** unit-тесты на цикл.

3. **Canvas UX — 8 фич в одном подшаге.** Возможны конфликты
   хоткеев, React Flow. **Митигация:** делать по одной фиче, коммит
   каждую; или 2 подшага (R6.4a / R6.4b).

4. **Undo/Redo history.** Snapshot всего графа — память. **Митигация:**
   max 50 снапшотов, structural sharing через Immer.

5. **Reasoning mode — SDK-specific.** GPTunnel / OpenAI / DeepSeek
   могут требовать разные поля. **Митигация:** capability flag в
   `ModelInfo`; для моделей без поддержки — поле скрыто.

6. **Condition-узел — sandbox.** `new Function` — RCE-риск.
   **Митигация:** MVP — только простой DSL (`>`, `<`, `===`,
   `includes`), sandbox в v0.9.

7. **Zod strip** (KI-149) — новые поля в SSE-событиях нужно явно
   добавлять в frontend-схему. **Митигация:** checklist для каждого
   подшага.

### 13.2. Открытые вопросы к ревью

1. **Auth: httpOnly cookie или localStorage?**
   - **A)** cookie (безопаснее, но CORS).
   - **B)** localStorage (проще, но XSS-риск).
   **Рекомендую A** (httpOnly + sameSite=strict).

2. **Sub-workflows: снимок или ссылка?**
   - **A)** Ссылка (всегда актуальный).
   - **B)** Снимок (стабильно, но устаревает).
   **Рекомендую A** + явный warning при изменении родителя.

3. **Canvas UX: 1 подшаг (R6.4) или 2 (R6.4a/R6.4b)?**
   - **A)** 1 — 6ч, риск конфликтов.
   - **B)** 2 — 3ч+3ч, безопаснее.
   **Рекомендую B.**

4. **Condition DSL: минимальный или sandbox?**
   - **A)** MVP — простые операции.
   - **B)** Sandbox (isolated-vm) — v0.9.
   **Рекомендую A.**

5. **Templates: где хранить?**
   - **A)** JSON-файлы в репо (`src/templates/*.json`).
   - **B)** Таблица в БД.
   **Рекомендую A** (проще, версионируется с кодом).

---

## 14. Решения (после ревью)

| # | Решение | Дата |
|---|---------|------|
| 1 | Auth: httpOnly cookie + sameSite=strict | 2026-10-15 |
| 6 | R6.1a — MVP (access-only, 24h, scrypt); R6.1b — refresh-cookie | 2026-10-15 |
| 7 | DEMO_USER_ID — детерминированный uuid `000...001` (system@workflow-builder.local) | 2026-10-15 |
| 2 | Sub-workflows: ссылка на workflow (снимок версии опционален), warning при изменении родителя | 2026-10-15 |
| 3 | Canvas UX: 2 подшага — R6.4a (вставка/snap/duplicate/auto-save), R6.4b (hotkeys/comments/cursor-hand/minimap toggle) | 2026-10-15 |
| 4 | Condition: MVP DSL (`>`, `<`, `===`, `includes`), sandbox — v0.9 | 2026-10-15 |
| 5 | Templates: JSON-файлы в `src/templates/*.json`, версионируются с кодом | 2026-10-15 |

**Итог ревью:** все 5 решений приняты без изменений. DESIGN v0.8 — **Approved** (Draft → Approved).

---

**Конец документа.**