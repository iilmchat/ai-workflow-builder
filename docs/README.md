# Документация — IIChatTools AI Workflow Builder

> **Навигационный хаб проекта.** Здесь собраны все документы: от руководства
> пользователя до правил разработки и чек-листа релиза.
>
> **Версия продукта:** `v0.10.1` · **Обновлено:** 2026-10-19 · **HEAD:** актуальный

---

## С чего начать

Найдите свою роль — и переходите по ссылке. Если сомневаетесь, начните
с [руководства пользователя](user_guide/USER_GUIDE.md) или
[быстрого старта для разработчика](development/GETTING_STARTED.md).

| Роль | Задача | Начните здесь |
|---|---|---|
| 👤 **Пользователь** | Собрать первый сценарий, разобраться с узлами и Share | [USER_GUIDE.md](user_guide/USER_GUIDE.md) |
| 🧪 **Тестировщик** | Пройти приёмку релиза по кейсам | [MANUAL_TESTING_GUIDE.md](qa/MANUAL_TESTING_GUIDE.md) |
| 🛠️ **Новый разработчик** | Поднять проект за ~20 минут | [GETTING_STARTED.md](development/GETTING_STARTED.md) |
| 💻 **Разработчик** | Соблюдать правила кода и документации | [RULES.md](development/RULES.md) |
| 🤖 **Ассистент / dsh** | Получить актуальные системные инструкции | [PROMPT_CURRENT.md](development/PROMPT_CURRENT.md) |
| 🚦 **Релиз-менеджер** | Выпустить версию без пропущенных шагов | [RELEASES.md](development/RELEASES.md) |
| 🔎 **Все** | Найти известную проблему или ограничение | [KNOWN_ISSUES.md](KNOWN_ISSUES.md) |

---

## 👤 Для пользователей

**Кому:** маркетологам, авторам контента, продуктовым аналитикам — всем, кто
собирает AI-сценарии мышкой, без программирования.

| Документ | Что внутри | Когда читать |
|---|---|---|
| [**USER_GUIDE.md**](user_guide/USER_GUIDE.md) | Быстрый старт Text → LLM → Output, обзор интерфейса, каталог **22 узлов** с бизнес-кейсами, совместная работа и роли, бюджет и стоимость, словарь | Первый запуск; перед настройкой нового сценария |

**Основные разделы гайда:**

1. [Быстрый старт](user_guide/USER_GUIDE.md#1-быстрый-старт-text--llm--output)
2. [Обзор интерфейса](user_guide/USER_GUIDE.md#2-обзор-интерфейса)
3. [Каталог узлов](user_guide/USER_GUIDE.md#3-каталог-узлов)
4. [Совместная работа](user_guide/USER_GUIDE.md#4-совместная-работа)
5. [Бюджет и стоимость](user_guide/USER_GUIDE.md#5-бюджет-и-стоимость)
6. [Вопросы и ограничения](user_guide/USER_GUIDE.md#6-вопросы-и-ограничения)
7. [Словарь](user_guide/USER_GUIDE.md#7-словарь)

> 💡 **Совет.** Если интерфейс отличается от описанного — сначала проверьте
> [CHANGELOG.md](CHANGELOG.md): возможно, вы смотрите более новую версию.

---

## 🧪 Для тестировщиков

**Кому:** QA, релиз-менеджеру, разработчику на приёмке.

| Документ | Что внутри | Когда читать |
|---|---|---|
| [**MANUAL_TESTING_GUIDE.md**](qa/MANUAL_TESTING_GUIDE.md) | **129 ручных кейсов** с приоритетами P1–P3, предусловиями, шагами и ожидаемым результатом; чек-лист приёмки и шаблон баг-репорта | Перед каждым релизом и при регрессе |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | Реестр KI: приоритет, статус, файлы, решения | Перед тестированием — что уже известно |
| [RELEASES.md](development/RELEASES.md) | Пошаговый чек-лист выпуска версии | При подготовке релиза |

**Блоки кейсов:**

| Блок | Кейсов | Что проверяем |
|---|---:|---|
| AUTH | 12 | вход, регистрация, сессия, лимиты |
| CANVAS | 20 | узлы, связи, каталог, хоткеи, сохранение, файлы |
| ENGINE | 10 | запуск, статусы, ретраи, поток, панель |
| LLM / MEDIA | 18 | модели, промпты, генерации, валидация |
| VECTOR / AGENT | 13 | pgvector, память, цикл агента |
| SHARE / ACCESS | 12 | ссылка, роли, read-only, лимит |
| S3 / STORAGE | 9 | local/S3, TTL, плашка, переподпись |
| EDGE CASES | 18 | бюджет, Redis, ключи, БД, нагрузка |
| CONTRACT | 4 | api/sse/prefixes/enums |
| V0.10 | 13 | Web Search, DOCX, workspace, Docker |
| **Итого** | **129** | |

> ⚠️ **Правило «до/после»** (RULES 4.33). Для проверок «закрылось / не
> открылось / не изменилось» фиксируйте состояние **до** действия.

---

## 💻 Для разработчиков

### Правила и процесс

| Документ | Что внутри | Обязательность |
|---|---|---|
| [**RULES.md**](development/RULES.md) | Единый свод правил: базовые, документация, workflow, TypeScript/NestJS/ESM, безопасность, git | **Обязателен** для всех изменений |
| [**ARCHITECTURE.md**](development/ARCHITECTURE.md) | C4-архитектура, жизненный цикл Run, контракты, Docker-развёртывание | При изучении кода и деплоя |
| [**PROMPT_CURRENT.md**](development/PROMPT_CURRENT.md) | Актуальный системный промпт для ассистента/dsh: статус, метрики, открытые KI, план | Перед новой сессией |
| [**GETTING_STARTED.md**](development/GETTING_STARTED.md) | Пошаговое разворачивание: Node, pnpm, Docker, миграции, тесты | Первый запуск |
| [**RELEASES.md**](development/RELEASES.md) | Чек-лист релиза: тесты, сборка, docs, версия, тег, Release Notes | Перед каждым релизом |
| [**KI_GITHUB_SYNC.md**](development/KI_GITHUB_SYNC.md) | Синхронизация реестра KI с GitHub Issues | При работе с Issues |

### История и проблемы

| Документ | Что внутри |
|---|---|
| [**CHANGELOG.md**](CHANGELOG.md) | История версий по Keep a Changelog |
| [**KNOWN_ISSUES.md**](KNOWN_ISSUES.md) | Полный реестр KI: приоритеты, статусы, файлы, решения |
| [**api-contract.json**](development/api-contract.json) | REST-контракт: источник правды для паритет-гейтов backend ↔ web |
| [**sse-contract.json**](development/sse-contract.json) | SSE-контракт: события и snapshot-формат |

### DESIGN-документы

| Версия | Документ | Статус | О чём |
|---|---|---|---|
| v0.11 | [DESIGN_V011_FEATURES.md](development/v0.11/DESIGN_V011_FEATURES.md) | Draft (в разработке) | DOCX-шаблоны, MCP Adapter, Reliability/History, dark theme |
| v0.10 | [DESIGN_V010_FEATURES.md](development/v0.10/DESIGN_V010_FEATURES.md) | Released (v0.10.0) | Web Search, Document Generation, safe filesystem, Docker/GHCR |
| v0.9 | [DESIGN_V09_FEATURES.md](development/v0.9/DESIGN_V09_FEATURES.md) | Released (v0.9.0) | медиа, состояние (pgvector/Memory), агенты, sandbox, наблюдаемость |
| v0.8 | [DESIGN_V08_FEATURES.md](development/v0.8/DESIGN_V08_FEATURES.md) | Approved | Auth, Share, sub-workflows, Canvas UX, LLM upgrade |
| v0.7 | [DESIGN_UI_SLICES.md](development/v0.7/DESIGN_UI_SLICES.md) | Draft | тема, i18n, каталог узлов, уборка типов |

> 📐 Новый крупный DESIGN — по шаблону RULES § 2.14:
> `docs/development/vX.Y/DESIGN_<TOPIC>.md`.

---

## 🗄️ Архив

Старые версии системных промптов **не удаляются**: начиная с V5 они переносятся
сюда (RULES § 2.17). Актуальная версия всегда одна:
[PROMPT_CURRENT.md](development/PROMPT_CURRENT.md). Промпты V1–V4 оставлены в
`docs/development/` как исторические.

| Файл | Версия | Статус |
|---|---|---|
| [PROMPT_V5_v6.4.md](development/archive/prompts/PROMPT_V5_v6.4.md) | v6.4 (для v0.9.0) | 🗄️ архив |
| [PROMPT_V5.md](development/archive/prompts/PROMPT_V5.md) | v6.3 (для v0.9.0) | 🗄️ архив |
| [PROMPT_V4.md](development/PROMPT_V4.md) | v4 (исторический) | 🗄️ исторический |
| [PROMPT_V3.md](development/PROMPT_V3.md) | v3 (исторический) | 🗄️ исторический |
| [PROMPT_V2.md](development/PROMPT_V2.md) | v2 (исторический) | 🗄️ исторический |
| [PROMPT_V1.md](development/PROMPT_V1.md) | v1 (исторический) | 🗄️ исторический |

---

## 📊 Метрики и состояние

| Показатель | Значение |
|---|---|
| Версия продукта | **v0.10.1** |
| Backend-тесты | **1123** (17 skipped) |
| Frontend-тесты | **375** |
| Типов узлов | **22** |
| KI-реестр | **KI-480** — последний номер; всего **468** записей |
| Открытых High KI | **6** |
| Языки интерфейса | RU / EN |
| Стек | NestJS 12 · React 19 · PostgreSQL 17 + pgvector · S3 · OTel · Docker/GHCR |

> Цифры обновляются перед каждым релизом по [RELEASES.md](development/RELEASES.md)
> и пересчитываются по факту (RULES 3.20, 3.21).

---

## 🗂️ Структура документации

```text
docs/
├── README.md                      ← вы здесь
├── CHANGELOG.md                   ← история версий
├── KNOWN_ISSUES.md                ← реестр KI
├── user_guide/
│   └── USER_GUIDE.md              ← для пользователей
├── qa/
│   └── MANUAL_TESTING_GUIDE.md    ← для тестировщиков
└── development/
    ├── RULES.md                   ← правила разработки
    ├── ARCHITECTURE.md            ← архитектура и Docker
    ├── PROMPT_CURRENT.md          ← актуальный промпт
    ├── RELEASES.md                ← чек-лист релиза
    ├── GETTING_STARTED.md         ← разворачивание
    ├── KI_GITHUB_SYNC.md          ← синхронизация KI с GitHub
    ├── api-contract.json          ← REST-контракт
    ├── sse-contract.json          ← SSE-контракт
    ├── v0.7/ v0.8/ v0.9/ v0.10/ v0.11/  ← DESIGN-документы
    └── archive/prompts/           ← архив промптов
```

---

## 📝 Как поддерживать документацию

Документация — часть Definition of Done, а не «после релиза».

| Правило | Что требует |
|---|---|
| **RULES § 2.1** | `CHANGELOG.md` обновляется в том же коммите с кодом |
| **RULES § 2.4** | Любая найденная проблема — запись `KI-XXX` в `KNOWN_ISSUES.md` |
| **RULES § 2.9** | Релиз — строго по [RELEASES.md](development/RELEASES.md) |
| **RULES § 2.16** | Перед релизом — актуализировать `USER_GUIDE.md` и `MANUAL_TESTING_GUIDE.md` |
| **RULES § 2.17** | Меняешь системные инструкции — обнови `PROMPT_CURRENT.md`, старое — в `archive/prompts/` |

**Проверка ссылок перед коммитом:** все относительные ссылки в `README.md`
(корень) и `docs/README.md` должны вести на существующие файлы.

---

**© 2026 RuChating (iilmchat) · IIChatTools AI Workflow Builder v0.10.1**
