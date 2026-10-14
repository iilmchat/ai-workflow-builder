# DESIGN v0.7 — UI-срезы: тема, i18n, каталог, уборка типов

**Файл:** `docs/development/v0.7/DESIGN_UI_SLICES.md`
**Версия:** 1.0 (черновик)
**Дата:** 2026-10-14
**Статус:** Draft → к ревью
**Закрывает:** KI-125 (тема), KI-126 (i18n), KI-127 (каталог, частично), KI-129 (уборка типов)
**Связанные:** KI-008 (chunk 526 kB), KI-068 (frontend-тесты), RULES § 2.5, § 1.14

---

## 1. Контекст

После v0.6.1 в `KNOWN_ISSUES.md` накопились четыре задачи, которые пересекаются в одних и тех же файлах (`web/src/components/nodes/*`, `web/src/lib/node-registry.ts`, `web/src/types/graph.ts`, `web/src/stores/workflow.ts`):

| KI | Приоритет | Что |
|---|---|---|
| **KI-125** | 🟡 Medium | Нет тёмной темы. Tailwind v4 без dark-mode стратегии. |
| **KI-126** | 🟡 Medium | Нет i18n. Все строки — захардкоженный русский в JSX. RULES 1.14. |
| **KI-127** | 🟡 Medium | Плоский Toolbar из 3 кнопок, нет каталога с категориями. Скелет `NODE_CATEGORIES` готов. |
| **KI-129** | 🟢 Low | `NodeData` — пустая индексная сигнатура, `kind` не связан с `node.type`, `imageUrl: undefined` в сторе. |

**Почему одним документом, а не четырьмя задачами:**

Если делать по отдельности:

1. **Тема** → правка классов в 6+ компонентах.
2. **i18n** → правка строк в тех же 6+ компонентах.
3. **Каталог** → правка `Toolbar` + `node-registry` (тоже пересекается).
4. **Уборка типов** → правка `NodeData` → задевает те же компоненты.

**Каждая задача дважды трогает одни и те же файлы** → конфликты, регрессии, лишний ревью. Один DESIGN + 4 последовательных подшага = один рефакторинг компонентов.

**Ключевая идея:** единый реестр `NODE_REGISTRY` (создан в v0.6.1, KI-121) становится точкой сборки всех четырёх срезов.

---

## 2. Ключевое архитектурное решение — реестр как точка сборки

В v0.6.1 `NODE_REGISTRY` уже есть:

    export const NODE_REGISTRY: Record<NodeType, NodeRegistryEntry> = {
      text:             { label: 'Текст', icon: 'T', iconEmoji: '📝',
                          labelEn: 'Text', category: 'input', component: TextNode },
      llm:              { label: 'LLM', icon: 'LLM', iconEmoji: '🤖',
                          labelEn: 'LLM', category: 'ai', component: LLMNode },
      image_generation: { label: 'Генерация изображения', icon: 'IMG',
                          iconEmoji: '🖼', labelEn: 'Image Generation',
                          category: 'ai', component: ImageGenNode },
    };

**Проблема:** реестр уже дублирует метаданные (`label` + `labelEn`, `icon` + `iconEmoji`), потому что не было i18n. При введении i18n это разъедется.

**Решение v0.7:** реестр хранит ключи локализации и CSS-классы через переменные, а не строки:

    export const NODE_REGISTRY = {
      text: {
        /** i18n-ключ. Строки — в web/src/i18n/{ru,en}.json */
        labelKey: 'node.text.label',
        /** Иконка каталога: SVG или эмодзи. */
        icon: '📝',
        /** Категория (KI-127). */
        category: 'input',
        /** Компонент. */
        component: TextNode,
        /**
         * Capabilities (задел под KI-128, KI-130).
         * Канонический набор: { externalState, userConfig }.
         * - externalState — узел хранит внешнее состояние
         *   (БД, индекс, память).
         * - userConfig — true, если без явного выбора пользователя
         *   узел не запускаем (image_generation без модели = fail;
         *   llm с DEFAULT_LLM_MODEL_ID = работает, поэтому false).
         */
        capabilities: { externalState: false, userConfig: false },
      },
      // ...
    } as const satisfies Record<NodeType, NodeRegistryEntry>;

`Toolbar` использует `t(entry.labelKey)`, `BaseNode` использует `t(entry.labelKey)`, каталог — `t(entry.labelKey)`.

**Что это даёт:**

- **Один источник** для подписи (не «label + labelEn»).
- **i18n бесплатна** для новых узлов — добавил `labelKey`, добавил строки в `ru.json`/`en.json`, готово.
- **Тема бесплатна** — компоненты получают классы через переменные (`bg-background`), а не `dark:` в каждом месте.
- **Каталог строится** из `category` + `labelKey` + `icon` — как только узлы зарегистрированы.

**Это ключевое архитектурное решение всего v0.7.** Остальные секции — следствия.

---

## 3. Тема (KI-125)

### 3.1. Стратегия — CSS-переменные + Tailwind v4 `@theme`

**Решение:** вариант A (переменные). Обоснование:

- 6 компонентов сейчас, будет 10+ после v0.8.
- `dark:` в каждом классе = двойная работа при каждой правке.
- `@theme` — нативная фича Tailwind v4, не костыль.
- Будущие темы (sepia, high-contrast, «тёмно-синяя») — просто новый набор переменных.

### 3.2. Структура переменных

**Файл:** `web/src/styles/theme.css` (новый).

    @import 'tailwindcss';

    @theme {
      /* Светлая тема — дефолт. */
      --color-background: theme(colors.white);
      --color-foreground: theme(colors.slate.900);
      --color-muted: theme(colors.slate.100);
      --color-muted-foreground: theme(colors.slate.500);
      --color-border: theme(colors.slate.200);
      --color-primary: theme(colors.blue.500);
      --color-primary-foreground: theme(colors.white);
      --color-canvas-bg: theme(colors.slate.50);
      --color-canvas-dot: theme(colors.slate.200);
      --color-node-bg: theme(colors.white);
      --color-node-border: theme(colors.slate.200);
      --color-node-shadow: color-mix(in oklab, black 5%, transparent);
    }

    .dark {
      --color-background: theme(colors.slate.950);
      --color-foreground: theme(colors.slate.100);
      --color-muted: theme(colors.slate.800);
      --color-muted-foreground: theme(colors.slate.400);
      --color-border: theme(colors.slate.800);
      --color-primary: theme(colors.blue.400);
      --color-canvas-bg: theme(colors.slate.900);
      --color-canvas-dot: theme(colors.slate.700);
      --color-node-bg: theme(colors.slate.900);
      --color-node-border: theme(colors.slate.700);
      --color-node-shadow: color-mix(in oklab, black 40%, transparent);
    }

**Tailwind v4 сам маппит** `--color-background` в утилиты `bg-background`, `text-background`, `border-background` — пишем один раз, работает везде.

### 3.3. Переключение темы

**Хук** `web/src/hooks/use-theme.ts`:

    type Theme = 'light' | 'dark' | 'system';

    /**
     * Читает тему из localStorage, ставит .dark на <html>, подписывается
     * на изменения системной темы (matchMedia).
     */
    export function useTheme(): {
      theme: Theme;
      resolved: 'light' | 'dark';
      setTheme: (t: Theme) => void;
    };

**Класс `.dark`** ставится на `<html>` — до первого рендера (inline-скрипт в `index.html`, чтобы не было вспышки):

    <script>
      (() => {
        const t = localStorage.getItem('theme');
        const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
        if (dark) document.documentElement.classList.add('dark');
      })();
    </script>

**Кнопка переключения** — в `TopBar` (иконка солнца/луны).

### 3.4. Рефакторинг компонентов

**Все компоненты** меняют классы:

- `bg-white` → `bg-node-bg` (или `bg-background`).
- `text-slate-700` → `text-foreground` / `text-muted-foreground`.
- `border-slate-200` → `border-border`.

**React Flow** — стилизация нод через `className` (уже так), стрелки/фон через CSS-переменные React Flow (`--xy-edge-stroke`, `--xy-background-pattern-color`).

**Оценка:** ~6 компонентов + `index.css` + `index.html`. ~2 ч.

---

## 4. i18n (KI-126)

### 4.1. Стек — `react-i18next` + `i18next`

**Решение:** вариант A. Обоснование: стандарт, lazy-loading, `Intl`-плюрализация, интерполяция, tooling. +40 kB к бандлу — терпимо.

### 4.2. Структура ключей

**Файлы:**

- `web/src/i18n/ru.json` — русский (дефолт).
- `web/src/i18n/en.json` — английский.
- `web/src/i18n/index.ts` — инициализация.

**Формат ключей** — плоский dot-notation (RULES § 1.14 требует en.json + ru.json):

    {
      "node.text.label": "Текст",
      "node.llm.label": "LLM",
      "node.image_generation.label": "Генерация изображения",

      "toolbar.add.text": "Текст",
      "toolbar.add.llm": "LLM",
      "toolbar.add.image_generation": "Генерация изображения",

      "topbar.save": "Сохранить",
      "topbar.load": "Загрузить",
      "topbar.run": "Запустить",
      "topbar.running": "Выполняется…",

      "run.status.pending": "Ожидает",
      "run.status.running": "Выполняется",
      "run.status.completed": "Готово",
      "run.status.failed": "Ошибка",

      "runResultPanel.title": "Узел {{label}} · {{duration}} мс",
      "runResultPanel.noSelection": "Выберите узел",

      "catalog.title": "Добавить узел",
      "catalog.search": "Поиск…",
      "catalog.category.input": "Ввод",
      "catalog.category.ai": "AI",
      "catalog.category.tools": "Инструменты",
      "catalog.category.output": "Вывод",
      "catalog.empty": "Ничего не найдено",

      "theme.light": "Светлая",
      "theme.dark": "Тёмная",
      "theme.system": "Системная"
    }

**Интерполяция** — `{{label}}`, `{{duration}}`.

**Плюрализация** — `key_one`, `key_few`, `key_many` (русский), `key_one`, `key_other` (английский). Формат — `i18next`-native.

### 4.3. Язык

- `localStorage.getItem('lang')` → `'ru'` | `'en'`.
- Fallback → `navigator.language` → `'ru'`.
- Кнопка переключения — в `TopBar` (RU/EN).
- `document.documentElement.lang` — синхронизируется с выбором.

### 4.4. Тест на паритет

**Файл:** `web/src/i18n/i18n.spec.ts` (Vitest).

    /**
     * Паритет ключей: каждому ключу в ru.json соответствует ключ в en.json.
     * RULES § 1.14 — новый UI-текст идёт в оба файла, проверяется тестом.
     */
    it('ru.json и en.json содержат одинаковый набор ключей', () => {
      const ru = Object.keys(ruJson).sort();
      const en = Object.keys(enJson).sort();
      expect(ru).toEqual(en);
    });

**Оценка:** ~2.5 ч.

### 4.5. Chunk 526 kB (KI-008)

С `react-i18next` бандл → ~566 kB. **Решение — открытый вопрос (§ 10.2):**

- **A)** Живём с warning, `chunkSizeWarningLimit: 700` в
  `vite.config.ts`. Быстро. **Выбрано (v0.7).**
- **B)** Dynamic import для `react-i18next` — грузим после первого рендера.
  Сложнее.
- **C)** Code-splitting по узлам (`React.lazy`) — крупный рефакторинг.

---

## 5. Каталог узлов (KI-127)

### 5.1. UI — поповер

**Решение:** вариант A (поповер по «+» из `Toolbar`).

**Что внутри:**

- Секции по `NODE_REGISTRY[type].category` (`input` / `ai` / `media` / `tools` / `output`), порядок — из `NODE_CATEGORIES`.
- Внутри секции — карточки узлов: `icon` + `t(labelKey)`.
- **Секции:** `input / ai / media / tools / output` (5 категорий,
  `media` — задел под KI-128: video/audio узлы).
- **Поиск** сверху (фильтр по подписи).
- **Клик** — добавить узел в центр Canvas (или рядом с последним добавленным).
- **Закрытие** — Escape, клик вне, после выбора.

**Компонент:** `web/src/components/NodeCatalogPopover.tsx` (новый).

### 5.2. Интеграция с реестром

Каталог строится только из `NODE_REGISTRY` — ни одной строки дублирования:

    // Группировка из реестра.
    const grouped = NODE_CATEGORIES.map((cat) => ({
      category: cat,
      label: t(`catalog.category.${cat}`),
      nodes: NODE_TYPES
        .filter((type) => NODE_REGISTRY[type].category === cat)
        .map((type) => ({
          type,
          label: t(NODE_REGISTRY[type].labelKey),
          icon: NODE_REGISTRY[type].icon,
        })),
    }));

**Это закрывает KI-127** (полностью, в отличие от v0.6.1 где был только скелет).

### 5.3. Toolbar

**Решение:** топ-3 быстрые кнопки (Text / LLM / Image Generation)
**сохраняются** — 90% случаев. Рядом добавляется **«+»** для поповера
каталога (остальные узлы). Это привычно и не ломает v0.6.x-визуал.

### 5.4. UX детали

- **Клавиатура:** ↑/↓ — навигация, Enter — добавить, Esc — закрыть.
- **Ховер:** подсветка карточки.
- **Стиль:** в тёмной теме — тёмный фон (из переменных).
- **Анимация:** fade-in 100ms.

**Оценка:** ~2 ч.

---

## 6. Уборка типов (KI-129)

### 6.1. Дискриминированный `NodeData` по `kind`

**Проблема:** сейчас `NodeData` — `{ [key: string]: unknown }`, `kind?: 'text' | 'llm' | 'image'` опционален и не связан с `node.type`.

**Решение:** `kind` — обязательный дискриминатор, union по `NodeData`:

    /** Дискриминированный union данных узла по `kind`. */
    export type NodeData =
      | { kind: 'text'; value: string }
      | { kind: 'llm'; model: string }
      | { kind: 'image'; model?: string; aspectRatio?: string; imageUrl?: string };

**Важно:** каждый подтип (TextNodeData / LlmNodeData / ImageGenNodeData)
должен `extends Record<string, unknown>`. Это требование React Flow
(`Node<TData extends Record<string, unknown>>`) и API-слоя
(`ApiGraphNode.data` — `z.record(z.string(), z.unknown())`). Без
индексной сигнатуры компиляция падает.

**Плюс** — дискриминатор `kind` в `*NodeData` становится обязательным (`kind: 'text'`, не `kind?: 'text'`).

**`satisfies` для реестра:**

    /** Соответствие `kind` ↔ `NodeType`. */
    export const NODE_REGISTRY = {
      text: { kind: 'text', labelKey: 'node.text.label', /* ... */ },
      llm: { kind: 'llm', labelKey: 'node.llm.label', /* ... */ },
      image_generation: { kind: 'image', labelKey: 'node.image_generation.label', /* ... */ },
    } as const satisfies Record<NodeType, NodeRegistryEntry>;

**Это даёт:**

- `node.type='llm'` с `data.kind='image'` — ошибка компиляции.
- Добавление нового `NodeType` → tsc требует запись в реестр → tsc требует запись в `NodeData`.

### 6.2. Явные `case` без `default:`

**В `createNode` / `nodeDataFromApi`:** убрать `default:`, добавить явный `case 'text'`. Тогда новый тип узла → tsc требует обработки.

    function createNode(type: NodeType, /* ... */): AppNode {
      switch (type) {
        case 'text': return { /* ... */ data: { kind: 'text', value: '' } };
        case 'llm': return { /* ... */ data: { kind: 'llm', model: defaultModelId } };
        case 'image_generation': return { /* ... */ data: { kind: 'image', model: defaultMediaModelId } };
        // нет default: — новый тип поймает tsc
      }
    }

### 6.3. `imageUrl: undefined` в сторе

**В `nodeDataFromApi`:** не присваивать `imageUrl: undefined` явно — использовать условное добавление:

    case 'image_generation': {
      const data: NodeData = { kind: 'image' };
      if (typeof raw.model === 'string') data.model = raw.model;
      if (typeof raw.aspectRatio === 'string') data.aspectRatio = raw.aspectRatio;
      if (typeof raw.imageUrl === 'string') data.imageUrl = raw.imageUrl;
      return data;
    }

**Оценка:** ~1.5 ч.

---

## 7. Совместимость и миграция

### 7.1. Старые workflow в БД

- **`data.label`** — уже игнорируется после v0.6.1, при следующем Save исчезает. Ничего не делаем.
- **`data.kind`** — в старых workflow всегда есть, обязателен. Ничего не делаем.
- **`data.imageUrl: undefined`** — в БД не попадает. Ничего не делаем.

**Вывод:** миграция не нужна.

### 7.2. Локальная разработка

- **`.env.example`** — не меняется (тема/i18n — frontend-only).
- **`vite.config.ts`** — если решим A по chunk (см. § 4.5), добавим `build.chunkSizeWarningLimit: 700`.
- **`package.json` (web)** — новые зависимости: `react-i18next`, `i18next`.

### 7.3. RULES — обновления

- **§ 1.14** — уточнить формат ключей (`node.text.label`, `catalog.category.input`).
- **§ 1.16** — добавить требование дискриминированного union для `NodeData`.
- **§ 2.5** — упомянуть `DESIGN_UI_SLICES.md` как пример.

### 7.4. CI (KI-068)

**Сейчас:** frontend в CI не проверяется (KI-005). В v0.7 — время завести frontend-тесты (хотя бы i18n-паритет + smoke).

**Мой план:** в R5.3 (i18n) включить `cd web && pnpm build` в CI + `web/src/i18n/i18n.spec.ts`. Это закрывает KI-005 и KI-068 частично.

---

## 8. План работ — 4 подшага

### R5.1 — Уборка типов (KI-129)

**Время:** ~1.5 ч
**Файлы:** `web/src/types/graph.ts`, `web/src/stores/workflow.ts`, `web/src/lib/node-registry.ts`, `web/src/components/nodes/*.tsx`
**Тесты:** типы (tsc) + smoke (Save/Load round-trip)
**Закрывает:** KI-129

### R5.2 — Тема (KI-125)

**Время:** ~2 ч
**Файлы:** `web/src/styles/theme.css` (новый), `web/src/hooks/use-theme.ts` (новый), `web/index.html`, все компоненты
**Тесты:** smoke (переключение, F5, system theme)
**Закрывает:** KI-125

### R5.3 — i18n (KI-126) + CI фронтенда

**Время:** ~2.5 ч
**Файлы:** `web/src/i18n/{index,ru,en}.ts/json` (новые), все компоненты, `.github/workflows/ci.yml`
**Тесты:** `i18n.spec.ts` (паритет), smoke (переключение RU/EN)
**Закрывает:** KI-126, частично KI-005, KI-068

### R5.4 — Каталог узлов (KI-127)

**Время:** ~2 ч
**Файлы:** `web/src/components/NodeCatalogPopover.tsx` (новый), `web/src/components/Toolbar.tsx`
**Тесты:** smoke (открыть, поиск, добавить)
**Закрывает:** KI-127 (полностью)

**Итого:** ~8 ч чистой работы dsh + ревью.

**Порядок важен:**

- R5.1 первым — типы устойчивы, на них строится всё.
- R5.2 вторым — компоненты переписаны на переменные, дальше не трогаем.
- R5.3 третьим — строки переводятся на `t(...)`, компоненты уже стабильны.
- R5.4 последним — каталог использует готовый реестр + i18n + тему.

---

## 9. Что НЕ входит в v0.7

| KI | Что | Куда |
|---|---|---|
| **KI-124** | Кнопки Открыть/Скачать в ImageGenNode | v0.6.2 (быстрый фикс) |
| **KI-128** | Узлы-сервисы (веб-поиск, векторная БД, память) | v0.8 |
| **KI-061** | `GET /runs` (список запусков) | v0.8 |
| **KI-066** | Heartbeat аренды в БД | v0.8 |
| **KI-067** | Per-provider семафоры | v0.8 |
| **KI-048** | Бюджет вызовов на запуск | v0.8 |
| **KI-077** | `GET /runs/:id/nodes` | v0.8 |
| **KI-105, 118** | Хранение media 48 ч | v0.8 |
| **KI-008** | Chunk 526 kB | v0.8 (если решим code-splitting) |
| **KI-130** (новый?) | Code-splitting узлов через React.lazy | v0.8+ |

---

## 10. Риски и открытые вопросы

### 10.1. Риски

1. **React Flow + CSS-переменные** — React Flow использует свой CSS. Проверить, что `--xy-*` переменные маппятся на наши темы. **Митигация:** smoke в тёмной теме до релиза.

2. **`react-i18next` + Vite** — иногда проблемы с SSR-импортами. **Митигация:** используем `initReactI18next` с явным lazy-loading.

3. **Chunk 566 kB после i18n** — предупреждение станет заметнее. **Митигация:** § 4.5 — решение A/B/C.

4. **TypeScript 6 + `as const satisfies`** — фича появилась в TS 4.9, в TS 6 точно есть. Проверено.

### 10.2. Открытые вопросы к ревью

Все три вопроса закрыты 2026-10-14 (см. § 11 «Решения»):

1. **Toolbar:** топ-3 + «+» для каталога. (§ 5.3)
2. **Chunk:** A — warning limit 700. (§ 4.5)
3. **Категории:** 5 — `input / ai / media / tools / output`. (§ 5.2)

---

## 11. Решения (после ревью)

| # | Решение | Дата |
|---|---------|------|
| 1 | i18n — `react-i18next` (вариант A) | 2026-10-14 |
| 2 | Тема — CSS-переменные + `@theme` (вариант A) | 2026-10-14 |
| 3 | Каталог — поповер (вариант A) | 2026-10-14 |
| 4 | **Toolbar:** топ-3 + «+» для каталога (вариант A) | 2026-10-14 |
| 5 | **Chunk:** warning limit 700 в vite.config.ts (вариант A) | 2026-10-14 |
| 6 | **Категории:** 5 — `input / ai / media / tools / output` | 2026-10-14 |

---

**Конец документа.**