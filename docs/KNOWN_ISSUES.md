# Известные проблемы IIChatTools AI Workflow Builder

Файл ведётся с версии 0.1.0 (октябрь 2026).
Формат: `KI-XXX` — название, приоритет, статус, файлы.

Приоритеты: 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low
Статусы: Open / In Progress / Fixed / Documented / Deferred / Won't Fix / Resolved

---

## v0.1.0 — Initial scaffold (2026-10-12)

> На старте проекта реестр пуст. Все проблемы, найденные при разработке,
> добавляются сюда с номерами `KI-001`, `KI-002`, ...

### KI-001 — Шаблон записи (Documented)
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-10-12
- **Файлы:** —
- **Описание:** Это шаблон. Реальные проблемы начинаются с `KI-002`. Каждая
  запись содержит: приоритет, статус, файлы, описание проблемы, возможные
  решения, оценку, связанные KI.
- **Формат полей:**
  - **Приоритет:** 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low
  - **Статус:** Open / In Progress / Fixed / Documented / Deferred / Won't Fix / Resolved
  - **Исправлено в:** vX.Y.Z (для Fixed)
  - **Запланировано:** vX.Y.Z (для Planned / Deferred)
- **Связанные:** —

---

### KI-002 — `EngineService.validateGraphAsync` — синхронный метод с суффиксом Async
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/engine.service.ts`
- **Описание:** Метод `validateGraphAsync` возвращает `GraphValidationResult`
  (не `Promise<>`), но имеет суффикс `Async` по конвенции проекта. Сбивает
  с толку — читатель ожидает `await`.
- **Возможные решения:**
  1. Переименовать в `validateGraph` (правка контроллера + тестов).
  2. Обернуть в `Promise.resolve()` (костыль, не рекомендуется).
- **Не блокер:** косметика. Исправить при следующей правке Engine.

---

### KI-003 — `executionMap` теряет данные при нескольких входах без `targetHandle`
- **Приоритет:** 🟡 Medium | **Статус:** Documented | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/engine.service.ts` (метод `buildExecutionPlanAsync`)
- **Описание:** Если у узла несколько входящих связей и у них не задан
  `targetHandle`, все они пишутся в ключ `input` (дефолт) и перезаписывают
  друг друга. Для multi-input узлов (`merge`, `condition`) данные теряются.
  Для текущих MVP-нод (`text`, `llm`, `image_generation`) — не проблема
  (у всех один вход).
- **Возможные решения:**
  1. Ключ = `edge.id` — исключает коллизии полностью. **Рекомендуется.**
  2. Ключ = `targetHandle ?? sourceHandle ?? edge.id`.
  3. Собирать массив: `inputs: { [targetHandle]: InputRef[] }`.
- **Когда чинить:** перед реализацией Runner (который будет реально исполнять
  граф и потреблять `executionMap`). Не блокер для frontend.

---

### KI-004 — React Flow: лицензия `hideAttribution` при платных плагинах
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-10-13
- **Файлы:** `web/src/components/Canvas.tsx` (`proOptions={{ hideAttribution: true }}`)
- **Описание:** Отключили watermark React Flow в dev. В v12 MIT это разрешено,
  но при подключении проприетарных плагинов (`@xyflow/pro`) условия меняются.
- **Что проверить перед prod:** актуальная лицензия React Flow +
  всех плагинов. Если условия требуют attribution — вернуть.
- **Не блокер:** dev-only.

---

### KI-005 — Frontend не покрыт CI (нет сборки `web/` в GitHub Actions)
- **Приоритет:** 🟡 Medium | **Статус:** Planned | **Запланировано:** v0.3.1
- **Файлы:** `.github/workflows/ci.yml`
- **Описание:** CI собирает только backend (`pnpm build` + `pnpm test`).
  Frontend `web/` не проверяется — сломанный TypeScript или Vite-build
  пройдёт незамеченным.
- **Fix:** добавить в `.github/workflows/ci.yml` новый job:
  - `working-directory: web`
  - `pnpm install --frozen-lockfile`
  - `pnpm build` (tsc -b + vite build)
  - (опционально) `pnpm lint` — после добавления ESLint/oxlint в web
- **Не блокер:** пока web маленький. Добавить вместе с Task 2 или Task 3.

---

### KI-006 — `imageUrl` рендерится в `<img>` без валидации схемы URL
- **Приоритет:** 🟡 Medium | **Статус:** Planned | **Запланировано:** Task 3
- **Файлы:** `web/src/components/nodes/ImageGenNode.tsx`
- **Описание:** Если `data.imageUrl` придёт с бэкенда/LLM, поле вставится
  в `<img src="...">` без проверки. `data:image/svg+xml` может содержать
  скрипты. Нужна валидация: `http(s):` или `data:image/(png|jpeg|webp|gif);`
  + `onError` заглушка.
- **Когда чинить:** до того, как image-generation провайдеры начнут
  возвращать реальные URL.
- **Связанные:** KI-003.

---

### KI-007 — Отсутствие необязательного пропа React Flow не ловит tsc
- **Приоритет:** 🟡 Medium | **Статус:** Documented | **Обнаружено:** 2026-10-13
- **Файлы:** `web/src/components/Canvas.tsx`
- **Описание:** При рефакторинге `Canvas.tsx` проп `nodeTypes={nodeTypes}`
  исчез. TypeScript не ругался — проп необязательный. Узлы рендерились
  дефолтным компонентом React Flow. Обнаружено только в браузере (headless
  Chrome + CDP): `react-flow__node-default` вместо `react-flow__node-text`.
- **Паттерн:** после рефакторинга React-компонентов с React Flow —
  **обязательная проверка в реальном браузере**. Юнит-тесты и `tsc`
  не ловят этот класс ошибок.
- **Возможные меры:**
  1. Простой smoke-тест в CI: собирать web/ и открывать страницу через
     Playwright/Cypress, проверять наличие `react-flow__node-text` и т.п.
  2. Линт-правило (custom): требовать `nodeTypes` в `<ReactFlow>`.
- **Не блокер:** задокументировано, работает после fix.

---

### KI-008 — Zod в клиентском бандле добавляет ~100 kB
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-10-13
- **Файлы:** `web/src/lib/api.ts`
- **Описание:** Zod-валидация ответов бэкенда даёт безопасность, но тянет
  ~100 kB в bundle (506 kB vs 405 kB до Task 3). Vite предупреждает про
  chunk > 500 kB.
- **Возможные решения:**
  1. Динамический импорт Zod только при получении ответа.
  2. Заменить на лёгкие type-guard'ы (без схем).
  3. Оставить как есть — 506 kB приемлемо для MVP.
- **Не блокер:** заметка на будущее, если размер станет критичным.

---

### KI-009 — `pnpm start` на Windows оставляет node-процесс после завершения
- **Приоритет:** 🟡 Medium | **Статус:** Documented | **Обнаружено:** 2026-10-13
- **Файлы:** —
- **Описание:** На Windows `pnpm start` через родительский pnpm оставляет
  node-процесс живым (типичная проблема Windows — orphaned child). При
  повторном запуске — `EADDRINUSE` на порту 3000.
- **Fix для пользователя:**
  ```powershell
  netstat -ano | Select-String ":3000.*LISTENING"
  Stop-Process -Id <PID> -Force
  ```
- **Возможное улучшение:** добавить npm-скрипт stop:dev, который
  убивает процесс на 3000.  
---

## Сводка по статусам

| Статус | Кол-во |
|--------|--------|
| Fixed | 0 |
| In Progress | 0 |
| Planned | 0 |
| Deferred | 0 |
| Documented | 1 |
| Won't Fix | 0 |
| **Всего** | **1** |

---

## Правила ведения

1. Любая найденная проблема / ограничение → запись с номером `KI-XXX`.
2. Даже если это «не баг» — запись нужна для истории.
3. Приоритет: 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low.
4. Статус: Open / In Progress / Fixed / Documented / Deferred / Won't Fix / Resolved.
5. Для Fixed — обязательно указывается «Исправлено в: vX.Y.Z» и список файлов.
6. Для Deferred — указывается «Запланировано: vX.Y.Z» и причина отсрочки.