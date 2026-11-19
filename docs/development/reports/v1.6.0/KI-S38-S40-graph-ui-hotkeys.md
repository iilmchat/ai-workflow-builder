---
title: "KI-спринты 38–40: граф, UI и хоткеи"
date: 2026-11-19
version: v1.6.0
steps: [S38, S39, S40]
status: done
related_ki: [KI-253, KI-254, KI-255, KI-262, KI-264, KI-267, KI-270, KI-272, KI-273, KI-276, KI-277, KI-279]
---

# KI-спринты 38–40 — отчёт

Отчёт объединяет три спринта по 4 KI (итого 12): 11 `Fixed`, 1 `Documented`.
Коммиты: S38 `74bae8a`, S39 `f550eae`, S40 — текущий.

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `web/src/stores/workflow.ts` | +126 / −6 — WeakMap-кэш (S38), Ctrl+D (S38), console.warn/DTO/fatal SSE (S39), clipboard + селектор + очистка prompt + история Load (S40) |
| `web/src/stores/workflow-nodes.spec.ts` | +160 / −3 — 11 тестов S37–S40 (LLM-Load, сетка, Ctrl+D, диагностика, DTO, хоткеи, история) |
| `web/src/components/Canvas.tsx` | +38 — 5 новых хоткеев, `allow` для Ctrl+Z, общий `SNAP_GRID` |
| `web/src/lib/graph-hash.ts`, `graph-hash.spec.ts` | +29 / −1, +18 / −1 — кэш по ссылкам и тест через `vi.spyOn(JSON, 'stringify')` |
| `web/src/lib/graph-edit.ts`, `graph-edit.spec.ts` | +34 / −1, +28 — `cloneNodeData` с fallback'ами и 2 теста |
| `web/src/lib/node-registry-handles.spec.tsx` | +80 — рендер всех узлов, сверка Handle ↔ `canBeInsertedOnEdge` |
| `web/src/lib/node-registry.ts`, `node-registry.spec.ts` | +3 / −2, +4 / −2 — `text` теперь вставляется в связь |
| `web/src/components/nodes/TextNode.tsx` | +2 / −1 — актуализирован комментарий о портах |
| `web/src/lib/hotkeys-utils.ts`, `hotkeys-utils.spec.ts` | +18, +28 — `allowUndoInNodeField` и тесты |
| `web/src/lib/api.ts` | +1 / −2 — `userId` удалён из DTO создания |
| `web/src/stores/workflow.spec.ts` | +21 — тест `onFatalError` |
| `src/engine/node-ports.ts`, `node-ports.spec.ts` | +37 / −1, +26 — `COMPARE_INPUT_SLOTS`, `resolveCompareInputKey`, 3 теста |
| `src/engine/engine.service.ts`, `engine.service.spec.ts` | +18 / −4, +26 — слоты a/b в плане выполнения + тест без handle'ов |
| `docs/development/SMOKE_CDP.md` | +65 — памятка CDP-смоука (KI-264) |
| `docs/KNOWN_ISSUES.md` | +89 / −23 — 12 статусов, fix/documented-заметки, сводка 365/112 (657 = 657) |
| `docs/CHANGELOG.md` | +32 — 12 записей и блок спринтов 38–40 |
| `docs/development/ROADMAP_KI.md` | +16 / −13 — галочки и лог спринтов 38–40 |
| `docs/development/reports/v1.6.0/KI-S38-S40-graph-ui-hotkeys.md` | настоящий отчёт |

## 2. Build / test

`pnpm build` 0/0, `pnpm typecheck`, `pnpm test` — **2154 passed / 26 skipped**
(142 файла, 4 skipped); `pnpm --dir web build` 0/0, `pnpm --dir web test` —
**641 passed** (69 файлов); `node scripts/check-known-issues.mjs` — OK
(657 KI = 657 статусов). CI всех трёх push'ов (S38/S39) — success по job
`web`, `build`, `Docker Publish`, `Sync KNOWN_ISSUES.md`.

## 3. Диагностика

- **KI-253:** `computeGraphHash` вызывался не только в deps-эффекте Canvas, но и
  в селекторе `isDirty` TopBar — то есть при любом `set()` стора (SSE-статусы,
  тосты, загрузка). Граф сериализовался целиком на каждый чих.
- **KI-254/255:** `duplicateNodes` одновременно переводил `selectedNodeId` на
  копию (панель результата показывала пустой узел) и использовал голый
  `structuredClone` для `data` из БД.
- **KI-262:** при написании рендер-теста обнаружилось не гипотетическое, а
  реальное расхождение: KI-349 добавил TextNode `text-input`, но реестр всё
  ещё говорил `canBeInsertedOnEdge: false`. Тест упал на `text` — баг исправлен.
- **KI-264:** скрипты смоука находятся вне репозитория, править нечего;
  зафиксированы только правила драйвера (7 классов дефектов) в отдельной
  памятке, как и предлагал KI.
- **KI-270:** backend `CreateWorkflowSchema` не содержит `userId`, но фронт
  продолжал слать `'demo-user'`, противореча DESIGN v0.8 § 3.6.
- **KI-272:** `run-stream.ts` вызывает `onFatalError` и закрывает поток; стор
  при этом менял только `runError`/`notice`, оставляя `runStatus` активным.
- **KI-276:** хук `useHotkeys` по умолчанию игнорирует все поля ввода. Версия
  «разрешить Ctrl+Z везде» сломала бы отмену набора текста в любом инпуте —
  выбрано точечное исключение для полей внутри карточки узла.
- **KI-279:** `compare` не имеет `NODE_PORT_CONTRACT` (там один вход на тип),
  а ключ `inputs` выводился из `targetHandle ?? sourceHandle ?? edge.id`. Две
  связи без хендлов или с одинаковым `sourceHandle` схлопывались в один ключ.

## 4. Smoke

- **Кэш хэша:** `vi.spyOn(JSON, 'stringify')` — 2 вызова с одними ссылками дают
  1 сериализацию; с новым массивом узлов — 2. Старые тесты стабильности хэша
  не изменились.
- **Ctrl+D:** тест стора — `selectedNodeId` остаётся на оригинале, `selected`
  true у оригинала и копии, копия смещена на +30/+30.
- **Клон данных:** тест с функцией в `data` (structuredClone бросает) — копия
  создаётся через JSON-fallback без функции; тест с циклической ссылкой —
  structuredClone сохраняет независимый цикл.
- **Handle-гейт:** все узлы реестра рендерятся в jsdom (`ReactFlowProvider` +
  `Suspense`); количество `.react-flow__handle.target` сверяется с флагом.
  Comment (0 handle) и text (1 target) оба проходят после исправления флага.
- **Load:** `console.warn('[loadWorkflow]', error)` проверен через spy; новая
  история `past`/`future` пуста после Load, `canUndo() === false`.
- **DTO:** в payload `createWorkflowAsync` нет `userId`, есть `name`/`nodes`/`edges`.
- **Fatal SSE:** хендлеры из мок-подписки вызываются напрямую — после
  `onFatalError(3)` статус `failed`, `runError` = ключ `toast.stream_stalled`,
  notice error.
- **Хоткеи:** Ctrl+A → все узлы выделены; Ctrl+C/Ctrl+V → копия с позицией
  {30,30} и независимым `data`; Ctrl+Shift+Backspace → `prompt: ''` + шаг
  истории. `allowUndoInNodeField` пропускает textarea внутри
  `.react-flow__node` и не пропускает input вне него.
- **Compare:** граф A/B → compare без `targetHandle` и с одинаковым
  `sourceHandle` даёт `inputs.a.fromNode='A'`, `inputs.b.fromNode='B'`; юнит
  `resolveCompareInputKey` покрывает явные слоты и 3+ связи (`extra-N`).
- **Реестр:** сводка пересчитана grep'ом до и после каждой правки: Fixed 365,
  Open 112, Documented 78, итого 657, уникальных номеров 657.

## 5. Что не так

- Ctrl+Z в поле узла теперь отменяет действие графа, а не последний введённый
  символ — осознанный компромисс KI-276; отмена набора текста в карточке
  доступна только через контекстное меню браузера.
- Буфер Ctrl+C/Ctrl+V живёт в памяти вкладки и сбрасывается после F5 — как и
  требовал KI («буфер в памяти»); persistent clipboard между вкладками не
  делался.
- `resolveCompareInputKey` назначает a/b по порядку связей; если UX вместо
  этого пришлёт явные `a`/`b` в `targetHandle`, они будут уважены, но текущий
  UI такие хендлы не шлёт — полный per-handle контракт остаётся KI-278.
- Паритет UI↔backend для `targetHandle` compare не введён: тест проверяет
  движок, а не генератор графа в `web/src/stores/workflow.ts`.
- CDP-смоук в браузере не проводился: для KI-264 создана памятка, но сами
  перехваты и получение скриншотов остаются вне репозитория; визуальная
  проверка новых хоткеев — при следующем ручном прогоне.
- `pnpm lint` выдаёт 2 pre-existing `no-base-to-string` в
  `src/media/providers/openai-images.provider.spec.ts` (567/588) — не наши
  файлы; `pnpm build` — 0/0.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

- KI-253 решён мемоизацией в самом `computeGraphHash`, а не `useMemo` в
  TopBar: выигрывают оба потребителя (селектор и автосейв), а контракт
  иммутабельности массивов уже соблюдается zustand.
- Для KI-254 выделение оригинала сохранено вместе с визуальным выделением
  копий — панель результата и карточки не противоречат друг другу.
- KI-262 выбран рендер-тест вместо статического AST-скана: он проверяет
  фактический DOM и сразу нашёл настоящий баг в реестре.
- KI-264 закрыт как `Documented`, а не `Fixed`: скрипты вне репо, и фикс
  памяти драйвера в репозитории — максимально возможный по KI результат.
- KI-273 реализован новыми actions стора, а не локальными переменными Canvas:
  буфер и история живут рядом с графом и покрываются юнит-тестами без
  монтирования ReactFlow.
- KI-276 — `allow`-исключение с проверкой `.react-flow__node`, чтобы не
  перехватывать Ctrl+Z в поиске/логине.
- KI-279 — явные слоты a/b вместо нового `NodePortContract`: контракт моделирует
  один вход на тип и при втором входе снова склеил бы операнды (KI-035).
- Документация (CHANGELOG, KNOWN_ISSUES, ROADMAP) обновлялась в каждом
  коммите спринта по RULES 2.1/2.12/3.17; отчёт — один на три спринта по
  указанию пользователя.
