---
title: "S16: Dark Theme & UI Polish — токены статусов узлов (KI-448)"
date: 2026-10-19
version: v0.11.0
steps: [S16]
status: accepted
related_ki: [KI-448, KI-509, KI-510, KI-511, KI-512]
related_adr: []
---

# Отчёт S16 — Dark Theme & UI Polish

**Статус:** реализовано; код и документация лежат в рабочем дереве, коммитов
в этой сессии нет (`git add -A` не использовался). `pnpm --dir web build` —
0 ошибок / 0 предупреждений, `pnpm --dir web test` — 50 файлов / 412 тестов
зелёные; CDP-смоук обеих тем — 14/14 проверок.

**Точка старта.** HEAD `ffeee36` (S12+S13). В рабочем дереве уже были
незакоммиченные backend-правки S14/S15 (SSRF, throttler, nest-cli, Docker) —
S16 их не касался: изменены только `web/` и `docs/`, поэтому пакет изолирован
и не смешивается с предыдущим. Перед правками `pnpm --dir web build` был
зелёным (exit 0) — это база сравнения для сборки.

**Формулировка задачи ↔ DESIGN.** Промпт и DESIGN v0.11 § 3.6 совпадают
буквально по токенам и словарям `BaseNode`; расхождение одно: DESIGN оставлял
`topBar`-бейджи за границей среза (KI-509), а RunResultPanel в аудите не
упоминал. В отчёте это отражено в § 5.

---

## 1. Файлы (+/−)

Frontend (13 изменённых + 1 новый; целиком `web/`):

| Файл | +/− | Что |
|---|---:|---|
| [web/src/styles/theme.css](../../../../web/src/styles/theme.css) | +62 / −0 | Токены статусов узлов (`--color-node-bg-*`, `--color-node-border-*`) в `@theme`/`.dark`; семейство `--color-status-*-foreground` + `--color-status-warning-bg/-border`; комментарии-обоснования (KI-448, RULES 4.32) |
| [web/src/components/nodes/BaseNode.tsx](../../../../web/src/components/nodes/BaseNode.tsx) | +15 / −13 | `STATUS_BORDER`/`STATUS_BACKGROUND` — на токены; `pending`/`cancelled`/`skipped` больше не светлые; кнопка удаления — `hover:bg-node-bg-failed hover:text-foreground` |
| [web/src/components/nodes/BaseNode.spec.tsx](../../../../web/src/components/nodes/BaseNode.spec.tsx) *(new)* | +135 / −0 | Таблица «статус → токен-классы» для всех 6 статусов + `idle`; отдельный тест `running`; регресс-гард «ни один статус не возвращает светлые литералы»; ховер кнопки удаления |
| [web/src/components/nodes/DocumentGenNode.tsx](../../../../web/src/components/nodes/DocumentGenNode.tsx) | +7 / −7 | `DOWNLOAD_CLASS` → `bg-node-bg-completed`/`border-node-border-completed`/`text-foreground`/`hover:bg-muted`; плашка missing-переменных → warning-токены; 4 ошибки `text-red-600` → `text-status-danger-foreground` |
| [web/src/components/nodes/ImageGenNode.tsx](../../../../web/src/components/nodes/ImageGenNode.tsx) | +3 / −3 | Плейсхолдеры `running`/`failed`/`invalid` — node/warning токены |
| [web/src/components/nodes/ImageToolNode.tsx](../../../../web/src/components/nodes/ImageToolNode.tsx) | +4 / −4 | То же + подсказка `audioUrl` → `text-status-danger-foreground` (рамка `border-red-500` оставлена — читается в обеих темах) |
| [web/src/components/nodes/VideoGenNode.tsx](../../../../web/src/components/nodes/VideoGenNode.tsx) | +3 / −3 | Плейсхолдеры — токены |
| [web/src/components/nodes/AudioGenNode.tsx](../../../../web/src/components/nodes/AudioGenNode.tsx) | +3 / −3 | Плейсхолдеры — токены |
| [web/src/components/nodes/MusicGenNode.tsx](../../../../web/src/components/nodes/MusicGenNode.tsx) | +3 / −3 | Плейсхолдеры — токены |
| [web/src/components/nodes/WriteFileNode.tsx](../../../../web/src/components/nodes/WriteFileNode.tsx) | +2 / −2 | `saved` → `text-status-success-foreground`, `failed` → `text-status-danger-foreground` |
| [web/src/components/nodes/SubWorkflowNode.tsx](../../../../web/src/components/nodes/SubWorkflowNode.tsx) | +3 / −3 | `outdated` → warning, `foreign`/`load-error` → danger |
| [web/src/components/nodes/WebSearchNode.tsx](../../../../web/src/components/nodes/WebSearchNode.tsx) | +1 / −1 | Ссылка результата → `text-status-info-foreground` |
| [web/src/components/nodes/CommentNode.tsx](../../../../web/src/components/nodes/CommentNode.tsx) | +1 / −1 | Кнопка удаления — та же ховер-пара, что в `BaseNode` |
| [web/src/components/RunResultPanel.tsx](../../../../web/src/components/RunResultPanel.tsx) | +7 / −7 | `text-blue-600`/`text-green-700`/`text-red-700`/`text-emerald-700` → `text-status-*-foreground` |

**Итого код:** 14 файлов, **+249 / −50** (включая новый тест +135).
Удалены все светлые статусные литералы в узлах; `border-red-500` у полей
ввода оставлен намеренно (ошибка ввода, контрастна в обеих темах).

Документация:

| Файл | +/− | Что |
|---|---:|---|
| [docs/CHANGELOG.md](../../../CHANGELOG.md) | +31 / −0 | `[Unreleased]`: Added (токены), Changed (перевод узлов), Fixed (KI-448), Docs (KI + сводка) со ссылкой на этот отчёт (RULES 2.18) |
| [docs/KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md) | +120 / −7 | KI-448 → `Fixed` (+«Исправлено в»); новые KI-509…512; сводка пересчитана grep'ом (RULES 3.20): **500** записей |
| [docs/development/reports/README.md](../README.md) | +1 / −0 | Строка отчёта S16 |
| `docs/development/reports/v0.11.0/S16-dark-theme.md` *(new)* | этот отчёт | — |

Артефакты смоука (gitignored `.smoke/`, не часть deliverable):
`.smoke/s16-dark-theme-smoke.mjs` (715 строк), `s16-dark-theme-smoke-report.json`,
`s16-light.png`, `s16-dark.png`.

Сводка реестра KI после правки (grep, RULES 3.20): заголовков `### KI-` — 500;
статусы: Fixed 221 (включая «Fixed (частично)»), Open 266, Documented 7
(включая «Documented (не воспроизводится)»), Planned 1, Deferred 1, Won't Fix 4,
In Progress 0 → сумма 500. Попутно исправлена устаревшая сводка: до сессии в
файле стояло 492 записи / Open 261 при фактических 496 / Open 264
(расхождение накопилось в предыдущих пакетах).

Зависимости, миграции, env и `.env.example` не менялись. Backend не тронут.

---

## 2. Build / test

`pnpm --dir web build` → **exit 0, tsc -b + vite: 0 errors, 0 warnings**;
`pnpm --dir web test` → **50 test files / 412 tests passed** (новый
`BaseNode.spec.tsx` — 11 тестов, все файлы узлов и `RunResultPanel` — зелёные).

Сборка CSS: `web/dist/assets/index-DTkRT3Qd.css` (production-сборка, именно её
проверял смоук). Backend `pnpm build` / `pnpm test` не прогонялись: S16 не
трогает backend, а незакоммиченные S14/S15 в дереве проверяются своим пакетом.

---

## 3. Диагностика

### 3.1 Tailwind v4: `theme(colors.*)` в `@theme` резолвится в готовые значения

Новые токены объявлены через `theme(colors.blue.50)` и т.п. — как уже было в
`theme.css`. В собранном CSS `theme(...)` не остаётся: значения инлайнятся в
`oklch(...)`, утилиты ссылаются на `var(--color-…)`:

```
.bg-node-bg-running{background-color:var(--color-node-bg-running)}
.border-node-border-running{border-color:var(--color-node-border-running)}
--color-node-bg-running:oklch(97% .014 254.604);          /* @theme */
--color-node-bg-running:oklch(28.2% .091 267.935);        /* .dark  */
```

То есть RULES 4.32 не нарушен: в правилах нет `color-mix()`/`theme()` со
ссылкой на тему Tailwind — только `var(--…)`, объявленные в `@theme`/`.dark`.

### 3.2 `bg-node-bg-running` при существующем `bg-node-bg`: коллизии нет

Риск был реальным: в теме уже есть `--color-node-bg`/`--color-node-border`, а
новые ключи — `--color-node-bg-running`/`--color-node-border-running`, то есть
имена отличаются только суффиксом. Tailwind v4 резолвит кандидата по точному
ключу темы, а не «отрезает по первому дефису»: обе утилиты сгенерированы
раздельно и смотрят каждая в свою переменную (проверено grep'ом по
production-CSS из смоука, `facts.utilities`). Дополнительно `bg-node-bg`
остался в сборке — им пользуются другие места, удалять его не нужно.

### 3.3 `dark:`-утилиты в проекте не работают — почему выбраны токены

В `theme.css` нет `@custom-variant dark (&:where(.dark, .dark *))`, а тема
переключается **классом** `.dark` на `<html>` (inline-script в `index.html` +
`useTheme`). В Tailwind v4 вариант `dark` по умолчанию — `@media
(prefers-color-scheme: dark)`, то есть `dark:text-green-300` реагировал бы на
настройку ОС, а не на переключатель в шапке. Следствие: для статусного текста
нельзя было обойтись парой `text-*-700 dark:text-*-300` — понадобились токены
`--color-status-*-foreground` (см. § 7). Ловушка зарегистрирована как KI-511:
сейчас `dark:`-классов в коде нет, поэтому баг латентный.

### 3.4 Смоук в jsdom не увидел бы CSS — разнесены уровни проверки

Vitest/jsdom не применяет Tailwind-CSS, поэтому `BaseNode.spec.tsx` проверяет
**контракт классов** (статус → литеральные имена токен-утилит, отсутствие
светлых литералов), а **вычисленные цвета** проверяет CDP-смоук на
production-сборке (§ 4). Это осознанное разделение: тест ловит регресс
разметки, смоук — регресс темы.

### 3.5 Аудит литералов: было/стало

До S16 grep по `web/src` находил светлые литералы в 13 файлах (включая
`BaseNode`: `bg-blue-50`/`bg-green-50`/`bg-red-50`, `border-{blue,green,red}-500`,
`hover:bg-red-50`). После правки в production-коде остались только
вне-срезовые места: `TopBar` (5), `ShareModal` (7), `LoadModal` (4),
`LoginPage` (2), `Toast` (2), `InsertableEdge` (1), `ShareViewPage` (1),
`LLMNode` (2 — бейджи) и намеренные `border-red-500` у полей ввода (3).
Они зафиксированы в KI-509/KI-510, а не «забыты».

---

## 4. Smoke

**Как проверяли.** `node .smoke/s16-dark-theme-smoke.mjs`:

1. Берёт **production CSS** из `web/dist/assets` (после `pnpm --dir web build`).
2. Поднимает локальный статический сервер и отдаёт HTML-фикстуру, разметка
   карточек которой повторяет `BaseNode` (`group/node`, `w-60 rounded-xl
   border-2`, шапка, тело); карточки размечены реальными классами компонента.
3. Chrome headless (`--headless=new`, CDP 9334) открывает фикстуру дважды —
   без `.dark` и с `<html class="dark">`; для каждого элемента
   `getComputedStyle` даёт `background-color`/`border-color`/`color`,
   `canvas.fillStyle` нормализует `oklch(...)` в sRGB-компоненты.
4. RULES 4.33: в одной фикстуре есть **«до»** (те же карточки со старыми
   литералами `bg-blue-50`/`bg-green-50`/`bg-red-50`) и **«после»** (токены).
5. `Page.captureScreenshot` (captureBeyondViewport) — два PNG.

**Результат: 14/14 PASS.** Ключевые числа (JSON: `.smoke/s16-dark-theme-smoke-report.json`):

| Проверка | Результат |
|---|---|
| CSS: `.bg-node-bg-running{…var(--color-node-bg-running)}` | ✅ |
| CSS: `.border-node-border-running{…var(--color-node-border-running)}` | ✅ |
| CSS: `.text-status-success-foreground{…}` эмитится | ✅ |
| `.dark` на `<html>` распознан страницей | ✅ |
| «До»: `bg-blue-50`/`bg-green-50`/`bg-red-50` в `.dark` светлые (luminance 0.915 / 0.953 / 0.910) — KI-448 воспроизведён | ✅ |
| «После»: фон всех 6 статусов в `.dark` тёмный (luminance 0.009…0.022) | ✅ |
| «После»: фон всех 6 статусов в light светлый (luminance 0.908…1.000) | ✅ |
| Light: фон `running`/`completed`/`failed` совпал со старыми литералами (239,246,255 / 240,253,244 / 254,242,242) — светлая тема не поплыла | ✅ |
| Dark: рамки новых токенов контрастнее заливки (3.07…8.40:1) | ✅ |
| Dark: нейтральная рамка `pending` различима (1.72:1, поведение до S16 — KI-512) | ✅ |
| Dark: `text-green-700` ниже AA (4.08 < 4.5) — «до» | ✅ |
| Dark: `text-status-success-foreground` выше AA (14.39) — «после» | ✅ |
| Dark: danger/warning-foreground — 10.5 / 16.19 (≥ 4.5) | ✅ |
| Скриншоты обеих тем сняты | ✅ |

Dark computed styles (карточки «после», sRGB):

| Статус | фон | рамка | контраст рамки к фону |
|---|---|---|---|
| pending | `oklch(.208 .042 265.755)` = (15,23,43) | `oklch(.372 .044 257.287)` = (49,65,88) | 1.72 |
| running | `oklch(.282 .091 267.935)` = (22,37,86) | `oklch(.707 .165 254.624)` = (80,162,255) | 5.55 |
| completed | `oklch(.266 .065 152.934)` = (3,46,21) | `oklch(.792 .209 151.711)` = (5,223,114) | 8.40 |
| failed | `oklch(.258 .092 26.042)` = (70,8,9) | `oklch(.704 .191 22.216)` = (255,100,103) | 5.60 |
| cancelled | `oklch(.279 .041 260.031)` = (29,41,61) | `oklch(.554 .046 257.417)` = (98,116,142) | 3.07 |
| skipped | `oklch(.279 .041 260.031)` = (29,41,61) | `oklch(.554 .046 257.417)` = (98,116,142) | 3.07 |

Скриншоты: `.smoke/s16-light.png`, `.smoke/s16-dark.png`. На тёмном снимке
видно ровно расхождение «до/после»: верхний ряд (литералы) остаётся
светло-голубым/зелёным/розовым на тёмном фоне, нижний ряд (токены) — тёмные
карточки со светлыми цветными рамками.

**Ограничение смоука.** Проверялась production-CSS на фикстуре,
повторяющей разметку `BaseNode`, а не живой холст приложения: для реального
канваса нужны backend + PostgreSQL + Redis + логин (это сценарий S17). Связка
«компонентный тест классов + CDP на боевом CSS» закрывает риск, но визуальная
приёмка на живом графе остаётся в чек-листе S17.

---

## 5. Что не так

1. **Коммитов нет** — по условию задачи; изменения лежат в рабочем дереве
   вместе с незакоммиченными S14/S15 (backend). Перед коммитом нужно
   разделять пакеты: `web/` + документация S16 — отдельно от backend S14/S15.
2. **Светлые литералы вне узлов остались** (осознанно, DESIGN § 3.6 вынес
   бейджи за срез): `TopBar` (статусные бейджи), `Toast`, `ShareModal`,
   `LoadModal`, `LoginPage`, `InsertableEdge`, `ShareViewPage`, `LLMNode`
   (бейджи возможностей). Это KI-509/KI-510 — в тёмной теме они дают светлые
   плашки и ховеры, а `text-red-600`/`text-blue-600` на `slate-950` ниже AA.
3. **`pending`-рамка в тёмной теме почти не видна** (1.72:1): DESIGN § 3.6
   оставил для неё старый `--color-node-pending` и не добавил
   `--color-node-border-pending`. Не менял состав токенов самовольно —
   зарегистрировано KI-512.
4. **Асимметрия имён токенов унаследована от DESIGN:** `--color-node-bg-*`
   для всех шести статусов, `--color-node-border-*` — для пяти, а `pending`
   использует старый `--color-node-pending`. Выглядит непоследовательно, но
   это буквально спецификация § 3.6; переименование затронуло бы minimap
   (KI-445) и добавило бы ещё один токен без пользы.
5. **`RunResultPanel`: светлых фонов не было.** Промпт просил проверить
   «если есть светлые фоны» — их нет, но есть статусный текст
   (`text-blue-600`/`text-green-700`/`text-red-700`/`text-emerald-700`),
   который в `.dark` даёт 3–4:1. Перевёл его на те же `--color-status-*`,
   чтобы панель не выбивалась из узлов.
6. **Светлая тема изменилась в трёх мелочах:** плашки невалидной ссылки и
   missing-переменных стали `amber-800`/`amber-200` вместо `amber-600`/`yellow-800`
   (контраст выше), ховер DOCX-кнопки — `bg-muted` вместо `bg-green-100`,
   `skipped`-узел — `slate-100` вместо `bg-muted/30` (менее прозрачный).
   Это осознанные решения (§ 7), но визуальный дифф в светлой теме есть.
7. **Токены `--color-node-*` (pending/running/completed/failed/skipped)
   остались** и теперь дублируют часть новой палитры: их использует
   `web/src/lib/minimap.ts` для цвета узлов миникарты (RULES 4.36, KI-445).
   Удалять нельзя; в отчёте это зафиксировано как осознанное дублирование.
8. **Тест не ловит деградацию CSS.** `BaseNode.spec.tsx` проверяет только
   имена классов: если кто-то удалит токен из `theme.css`, jsdom-тест
   останется зелёным. Именно поэтому смоук проверяет ещё и production-CSS
   (`facts.utilities`), но в CI его нет (аналогично KI-507).
9. **Смоук-артефакты не в репозитории** (`.smoke/` gitignored): PNG не
   попадают в git, в отчёте — числа и пути; при необходимости скриншоты
   прикладываются к релизному чек-листу вручную.
10. **JSON-отчёт смоука** содержит «сырые» `oklch()` и sRGB-компоненты;
    в отчёте приведены только ключевые строки, полный — в `.smoke/`.

---

## 6. Новые KI

- **KI-509** (Medium, Open) — бейджи статусов `TopBar` и бейджи возможностей
  `LLMNode` остаются светлыми `bg-*-100` плашками в тёмной теме. Нужны токены
  `--color-status-badge-*`; DESIGN § 3.6 прямо вынес это за срез KI-448.
- **KI-510** (Low, Open) — глобальные поверхности (`Toast`, `ShareModal`,
  `LoadModal`, `LoginPage`, `InsertableEdge`): светлые тосты, `text-red-600`
  ниже AA на тёмном фоне, `hover:bg-red-50` как вспышка. Решение —
  переиспользовать `--color-status-*`/`bg-muted`.
- **KI-511** (Low, Documented) — `dark:`-вариант Tailwind v4 не привязан к
  классу `.dark`: в проекте нет `@custom-variant dark`, тема переключается
  классом. Латентная ловушка для будущих правок; в S16 обошлись токенами.
- **KI-512** (Low, Open) — рамка `pending`-узла в тёмной теме 1.72:1
  (в светлой ~1.3:1): контур карточки де-факто не читается. Нужен
  `--color-node-border-pending` или осознанное решение оставить нейтрально.

Все четыре внесены в `docs/KNOWN_ISSUES.md` перед «Сводкой по статусам»,
сводка пересчитана grep'ом (RULES 3.20).

---

## 7. Обоснование решений

1. **Токены в `@theme`/`.dark`, а не `dark:`-варианты.** Причина
   техническая: `dark:` в Tailwind v4 по умолчанию смотрит на
   `prefers-color-scheme`, а тема переключается классом `.dark` (KI-511).
   Плюс DESIGN § 2.8/§ 3.6 уже зафиксировал именно токены. Классы остаются
   литеральными (`bg-node-bg-running`), поэтому сканер Tailwind v4 их находит
   — динамическая склейка имён запрещена (RULES 4.32).
2. **Имена строго по DESIGN:** `--color-node-bg-*` и
   `--color-node-border-*`; `pending`-рамка оставлена на существующем
   `--color-node-pending`, как в § 3.6. Не стал «улучшать» симметрию:
   это изменение спецификации, а не реализация.
3. **Расширение `--color-status-*-foreground` — вынужденное.** DESIGN § 3.6
   упоминает `--color-danger-foreground` как вариант «решить на ревью».
   Аудит показал, что светлые литералы — не только фоны: `text-green-700`
   в `.dark` даёт 4.08:1, `text-red-700`/`text-emerald-700` — ещё ниже AA.
   Заводить отдельный токен на каждый оттенок хуже, чем одно семейство
   «информация/успех/опасность/предупреждение»; оно же переиспользуется в
   `RunResultPanel`, `SubWorkflowNode`, `WebSearchNode`. `warning` получил
   ещё `-bg`/`-border`, чтобы убрать светлые `bg-yellow-50`/`bg-amber-*` из
   `DocumentGenNode` и медиа-плейсхолдеров той же парой токенов.
4. **Внутри цветных плейсхолдеров — `text-foreground`, а не спец-токен.**
   Фон плейсхолдера уже несёт семантику статуса (`bg-node-bg-running` /
   `-failed`), а текст на нём должен быть обычным текстом темы: в light это
   `slate-900` на `blue-50`/`red-50`, в dark — `slate-100` на `*-950`.
   Контраст получается автоматически, токенов меньше.
5. **`hover:bg-muted` для DOCX-кнопки.** В DESIGN ховер не описан, а
   `hover:bg-green-100` — тот же светлый литерал. `bg-muted` — уже принятая
   в узлах нейтральная ховер-подложка (`BUTTON_CLASS`), не требует нового
   токена и работает в обеих темах.
6. **Кнопка удаления — `hover:bg-node-bg-failed hover:text-foreground`.**
   Ровно вариант из DESIGN § 3.6. В светлой теме фон остаётся `red-50`
   (`node-bg-failed` = `red.50`), в тёмной становится `red-950`, текст —
   `foreground`; прежний `text-red-600` в тёмной был тусклым.
7. **`skipped` — отдельный фон `bg-node-bg-skipped` вместо `bg-muted/30`.**
   Прозрачная заливка поверх цветной карточки давала непредсказуемый цвет
   (особенно если узел выбран). Непрозрачный токен одинаков в обеих темах,
   пунктир остался (`border-dashed`) — KI-288 не регрессировал.
8. **Старые `--color-node-*` не удалены.** Их читает
   `web/src/lib/minimap.ts` (KI-445): если удалить — миникарта потеряет
   цвета статусов. Дублирование палитры (карточка vs миникарта) было и до
   S16, новый набор его не увеличивает: миникарта намеренно ярче карточки.
9. **Тест табличный + регресс-гард.** Таблица «6 статусов + `idle`» ловит
   смену классов при добавлении статуса; отдельная проверка
   `not.toHaveClass(...)` на список светлых литералов — именно регресс
   KI-448, а не косметика. Плюс отдельный тест на `running` — как просил
   промпт.
10. **Смоук на фикстуре, а не на живом графе.** Живой канвас требует
    backend/PostgreSQL/Redis/логина и стал бы флаки-тестом на CSS. Фикстура
    использует **боевой** CSS и точную разметку `BaseNode`, поэтому проверяет
    то, что важно: эмиссию утилит, резолв `.dark` и контраст. Визуальная
    приёмка на реальном графе — S17.
11. **Документация в том же дереве, без коммита.** RULES 2.1/2.18 требуют
    CHANGELOG и отчёт вместе с кодом; коммит запрещён условием задачи, поэтому
    правки лежат рядом и готовы к selective-add (`git add web/ docs/`, без
    `-A`).
