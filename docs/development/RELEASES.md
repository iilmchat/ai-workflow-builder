# RELEASES — чек-лист выпуска версии

**Файл:** `docs/development/RELEASES.md`
**Версия документа:** 1.0 (2026-10-18)
**Область:** выпуск релиза `vX.Y.Z` проекта **IIChatTools AI Workflow Builder**
**Связанные правила:** [RULES](RULES.md) § 2.1, § 2.7, § 2.9, § 2.16, § 2.17,
§ 3.6, § 3.7, § 3.20

> **Главное правило:** релиз — это не «git tag», а законченный пакет
> «код + тесты + документация + версия + Release Notes». Пропущенный пункт =
> релиз не выпущен.
>
> Чек-лист проходится **сверху вниз**. Все команды — из корня репозитория,
> если не указано иное.

---

## 0. Быстрый TL;DR

```powershell
# 1. Код и тесты
pnpm install --frozen-lockfile
pnpm --dir web install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test                 # backend: 1001
pnpm --dir web test       # frontend: 339
pnpm build                # 0 errors, 0 warnings
pnpm --dir web build

# 2. Документация (release gate)
#    USER_GUIDE.md, MANUAL_TESTING_GUIDE.md, PROMPT_CURRENT.md,
#    CHANGELOG.md, KNOWN_ISSUES.md, README.md, docs/README.md

# 3. Версия и тег
#    package.json (root + web), CHANGELOG, README badge
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main
git push origin vX.Y.Z

# 4. GitHub Release
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file .tmp/release-notes-vX.Y.Z.md --latest
```

---

## 1. Подготовка

| # | Шаг | Команда / действие | Готово |
|---|---|---|---|
| 1.1 | Зафиксировать состав релиза | список KI и фич в `CHANGELOG.md` → `[Unreleased]` | ☐ |
| 1.2 | Убедиться, что `main` зелёный | последний CI run — success | ☐ |
| 1.3 | Обновить рабочую копию | `git fetch --all --prune` · `git switch main` · `git pull` | ☐ |
| 1.4 | Проверить чистоту дерева | `git status --short` — пусто (кроме намеренных правок) | ☐ |
| 1.5 | Создать release-ветку (если принято в команде) | `git switch -c release/vX.Y.Z` | ☐ |
| 1.6 | Зафиксировать HEAD | `git log -1 --oneline` — записать в Release Notes | ☐ |

> ⚠️ Незакоммиченные файлы и «случайные» правки в релиз не попадают.
> Всё, что нужно, коммитится **до** старта чек-листа.

---

## 2. Код, тесты и сборка

### 2.1. Зависимости

```powershell
pnpm install --frozen-lockfile
pnpm --dir web install --frozen-lockfile
```

- [ ] Lockfile не изменился без причины. Если изменился — коммит `pnpm-lock.yaml`
  (RULES § 3.9).

### 2.2. Линт и типы

```powershell
pnpm lint
pnpm typecheck
```

- [ ] Backend: 0 ошибок.
- [ ] `typecheck` покрывает спеки (`tsconfig.spec.json`, KI-317).

> ℹ️ В `web/` отдельного lint-скрипта нет (KI-333); типы проверяются в
> `pnpm --dir web build` (`tsc -b`).

### 2.3. Миграции БД

```powershell
pnpm db:generate
git status --short drizzle/
```

- [ ] Если схема менялась — миграция создана и закоммичена.
- [ ] Если схема не менялась — `drizzle/` пуст, генератор ничего не создал.
- [ ] Локально применены миграции: `pnpm db:migrate`.

> **RULES § 3.10.** Перед правкой Drizzle-схемы — `db:generate`, затем
> `db:migrate`. В CI шаг `Apply migrations` идёт **до** тестов (KI-298).

### 2.4. Тесты

```powershell
pnpm test
pnpm --dir web test
```

| Пакет | Ожидание | Факт |
|---|---|---|
| Backend | **1001** passed, 0 failed | ☐ |
| Frontend | **339** passed, 0 failed | ☐ |

- [ ] Все тесты зелёные (RULES § 3.7).
- [ ] Новые фичи покрыты тестами; исправленные KI — регрессионным тестом.
- [ ] Если менялась схема БД — дополнительно `pnpm test:parity` (нужны `.env`
  и живая БД, RULES § 3.19).

### 2.5. Сборка

```powershell
pnpm build
pnpm --dir web build
```

- [ ] Backend: **0 errors, 0 warnings** (RULES § 3.6).
- [ ] Frontend: сборка успешна, размер основного чанка не превышает порог
  (ориентир v0.9.3–v0.9.4 — **141 kB**; `chunkSizeWarningLimit` — **500 kB**).
- [ ] `dist/` и `web/dist/` не коммитятся.

### 2.6. Ручная приёмка

- [ ] Пройти **P1-кейсы** из [MANUAL_TESTING_GUIDE](../qa/MANUAL_TESTING_GUIDE.md).
- [ ] Проверить ключевые сценарии релиза (новые фичи + затронутые области).
- [ ] Для UI-проверок «закрылось / не открылось / не изменилось» — снимок
  **до** и **после** (RULES § 4.33).

---

## 3. Документация (release gate)

> **RULES § 2.16.** Перед каждым релизом обязательно актуализировать
> `docs/user_guide/USER_GUIDE.md` и `docs/qa/MANUAL_TESTING_GUIDE.md`.
> **RULES § 2.17.** При изменении системных инструкций — обновить
> `PROMPT_CURRENT.md`, старую версию перенести в `archive/prompts/`.

### 3.1. Руководство пользователя

**Файл:** [`docs/user_guide/USER_GUIDE.md`](../user_guide/USER_GUIDE.md)

- [ ] Обновлена **версия продукта** в шапке — должна совпадать с версией релиза.
- [ ] Описаны новые/изменённые элементы UI и узлы.
- [ ] Обновлены ограничения и раздел «Вопросы и ограничения».
- [ ] Актуализированы скриншоты/подписи, если менялся интерфейс.
- [ ] Проверены внутренние ссылки и оглавление.

**Когда обязательна правка:** любое изменение UI/UX, новые узлы, роли, бюджет,
Share, сообщения об ошибках, поведение сохранения/запуска.

### 3.2. Гайд по ручному тестированию

**Файл:** [`docs/qa/MANUAL_TESTING_GUIDE.md`](../qa/MANUAL_TESTING_GUIDE.md)

- [ ] Обновлена **версия продукта** в шапке.
- [ ] Добавлены кейсы на новые фичи (с приоритетом P1/P2/P3).
- [ ] Обновлены ожидаемые значения по `api-contract.json` / `sse-contract.json`.
- [ ] Пересчитана сводка блоков и итоговое число кейсов (по факту, не по памяти).
- [ ] Проверены ссылки на DESIGN и KNOWN_ISSUES.

### 3.3. Промпт ассистента

**Файл:** [`docs/development/PROMPT_CURRENT.md`](PROMPT_CURRENT.md)

- [ ] Старая версия сохранена в `docs/development/archive/prompts/`
  (имя — `PROMPT_V<версия>.md`).
- [ ] Обновлены: релиз, метрики тестов, номера KI, состав фич, открытые KI.
- [ ] Обновлён план следующего релиза.
- [ ] Ссылка «Заменяет» указывает на архивную версию.

```powershell
# Пример архивации перед обновлением
Copy-Item docs/development/PROMPT_CURRENT.md `
  docs/development/archive/prompts/PROMPT_V7.0.md
```

### 3.4. CHANGELOG

**Файл:** [`docs/CHANGELOG.md`](../CHANGELOG.md)

- [ ] Все значимые изменения из `[Unreleased]` перенесены в новую секцию.
- [ ] Заголовок: `## [X.Y.Z] — YYYY-MM-DD`.
- [ ] Сверху добавлена пустая секция `## [Unreleased]`.
- [ ] Использованы типы: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
  `Security`, `Documented` (RULES § 2.2).
- [ ] Для каждого Fixed указан KI и, при необходимости, коммит.

### 3.5. KNOWN_ISSUES

**Файл:** [`docs/KNOWN_ISSUES.md`](../KNOWN_ISSUES.md)

- [ ] Закрытые KI получили `**Статус:** Fixed` и `**Исправлено в:** vX.Y.Z`.
- [ ] Новые проблемы заведены с номерами `KI-XXX` (номера не переиспользуются).
- [ ] **Сводка пересчитана grep'ом, а не по памяти** (RULES § 3.20):

```powershell
(Select-String -Path docs/KNOWN_ISSUES.md -Pattern '^### KI-').Count
(Select-String -Path docs/KNOWN_ISSUES.md -Pattern '\*\*Статус:\*\*').Count
```

- [ ] Сумма `Fixed + Open + Documented + Planned + Deferred + Won't Fix +
  In Progress` равна числу KI-записей (минус строка-легенда KI-001).
- [ ] Обновлена таблица «Сводка по статусам».

### 3.6. README и индекс документации

**Файлы:** [`README.md`](../../README.md) · [`docs/README.md`](../README.md)

- [ ] В корневом `README.md` обновлены: бейдж версии, таблица «Статус проекта»,
  список фич, ссылки на документацию.
- [ ] В `docs/README.md` обновлены: версия, метрики, статусы DESIGN, ссылки.
- [ ] Все относительные ссылки ведут на существующие файлы.
- [ ] Нет ссылок на перемещённые/удалённые документы.

### 3.7. RULES

**Файл:** [`docs/development/RULES.md`](RULES.md)

- [ ] Если менялись правила — обновлена версия файла и § 8 «История изменений».
- [ ] Новые правила не дублируют существующие; нумерация сквозная.

### 3.8. Финальная проверка docs

- [ ] `git diff --check` — нет проблем с пробелами/переводами строк.
- [ ] Все code fence'ы закрыты, таблицы не «съехали».
- [ ] В текстах нет реальных API-ключей и паролей (RULES § 2.13, § 5).
- [ ] Нет битых якорей в оглавлениях.

---

## 4. Версия

### 4.1. Обновить версию

| Файл | Что менять |
|---|---|
| `package.json` (корень) | `"version": "X.Y.Z"` |
| `web/package.json` | `"version": "X.Y.Z"` |
| `docs/CHANGELOG.md` | заголовок релиза |
| `README.md` | бейдж версии + таблица статуса |
| `docs/README.md` | версия и метрики |
| `docs/user_guide/USER_GUIDE.md` | версия продукта |
| `docs/qa/MANUAL_TESTING_GUIDE.md` | версия продукта |
| `docs/development/PROMPT_CURRENT.md` | релиз и метрики |

```powershell
# Проверить, не осталось ли старой версии
git grep -n "0\.9\.4"
```

- [ ] Версия единообразна во всех файлах.
- [ ] `pnpm install --lockfile-only` — lockfile синхронизирован (если нужно).
- [ ] Коммит: `chore(release): vX.Y.Z`.

### 4.2. Семантическое версионирование

| Тип | Когда | Пример |
|---|---|---|
| **MAJOR** | ломающие изменения API, схемы БД или формата workflow | `1.0.0` |
| **MINOR** | новые фичи, обратная совместимость | `0.10.0` |
| **PATCH** | исправления, docs, производительность | `0.9.5` |

> Предрелизные версии — `X.Y.Z-rc.N`. В `main` не должно быть «вечных» `-rc`.

---

## 5. Тег и GitHub Release

### 5.1. Merge и CI

- [ ] PR `release/vX.Y.Z` → `main` (если использовалась ветка).
- [ ] CI на `main` — **зелёный** (build, typecheck, migrations, tests, web).
- [ ] `git status` — чисто, `git log -1` — ожидаемый коммит.

### 5.2. Тег

```powershell
git switch main
git pull
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

- [ ] Тег аннотированный (`-a`), а не легковесный.
- [ ] Тег указывает на коммит релиза.
- [ ] Тег не перезаписывается: при ошибке — новый patch-релиз, а не
  `git push --force` тега (RULES § 6.6).

### 5.3. Release Notes

Создать файл `.tmp/release-notes-vX.Y.Z.md`:

```markdown
# vX.Y.Z — YYYY-MM-DD

**Тип:** patch / minor / major
**HEAD:** <short-sha>

## Added
- ...

## Changed
- ...

## Fixed
- ... (KI-XXX)

## Security
- ...

## Docs
- ...

## Метрики
- Backend: <N> tests
- Frontend: <N> tests
- KI: KI-XXX (последний номер)

## Обновление
- миграции: есть / нет
- действия оператора: ...
```

```powershell
gh release create vX.Y.Z `
  --title "vX.Y.Z" `
  --notes-file .tmp/release-notes-vX.Y.Z.md `
  --latest
```

- [ ] Release Notes содержат разделы Added/Changed/Fixed/Security (если есть).
- [ ] Указаны миграции и действия оператора (env, S3, Redis).
- [ ] Релиз помечен **Latest**.
- [ ] `.tmp/` не коммитится.

---

## 6. После релиза

| # | Шаг | Проверка |
|---|---|---|
| 6.1 | CI на теге | GitHub Actions — success |
| 6.2 | GitHub Release | `gh release view vX.Y.Z` — заметки и тег на месте |
| 6.3 | Документация на GitHub | ссылки в `README.md` и `docs/README.md` открываются |
| 6.4 | Деплой (если автоматизирован) | прод отвечает, версия в шапке UI — `vX.Y.Z` |
| 6.5 | Миграции в проде | применены до старта нового backend |
| 6.6 | Мониторинг | 15–30 минут: ошибки 5xx, OTel-трейсы, очередь BullMQ |
| 6.7 | Анонс | команда/пользователи уведомлены |
| 6.8 | Следующий цикл | `[Unreleased]` в CHANGELOG пуст и готов к работе |

---

## 7. Hotfix

Если после релиза найден критичный дефект:

1. Ветка от тега: `git switch -c hotfix/vX.Y.(Z+1) vX.Y.Z`.
2. Минимальная правка + регрессионный тест.
3. Тот же чек-лист (разделы 2–5), версия — **PATCH**.
4. CHANGELOG: секция `[X.Y.(Z+1)] — YYYY-MM-DD`, тип `Fixed`/`Security`.
5. Новый тег и Release Notes со ссылкой на проблемный релиз.

> Hotfix не «дописывает» старый тег. История релизов неизменяема.

---

## 8. Откат

| Ситуация | Действие |
|---|---|
| Плохой деплой, код откатывается | Задеплоить предыдущий тег `vX.Y.(Z-1)` |
| Плохие миграции | Остановить backend → откатить миграцию/восстановить БД из бэкапа → задеплоить предыдущий тег |
| Ошибка только в Release Notes | Отредактировать Release Notes, тег не трогать |
| Сломанный тег | Не удалять без решения команды; выпустить patch |

**Правило:** откат кода — это redeploy предыдущего тега, а не `git reset` в
`main`. История `main` не переписывается.

---

## 9. Definition of Done релиза

Релиз считается выпущенным, когда одновременно выполнено:

- [ ] `pnpm test` — **1001** зелёных.
- [ ] `pnpm --dir web test` — **339** зелёных.
- [ ] `pnpm build` и `pnpm --dir web build` — **0 warnings**.
- [ ] `USER_GUIDE.md` и `MANUAL_TESTING_GUIDE.md` актуализированы (RULES § 2.16).
- [ ] `PROMPT_CURRENT.md` обновлён, старая версия — в `archive/prompts/`
  (RULES § 2.17).
- [ ] `CHANGELOG.md` содержит `[X.Y.Z] — YYYY-MM-DD`.
- [ ] `KNOWN_ISSUES.md` закрыт/дополнен, сводка пересчитана grep'ом.
- [ ] Версия едина в `package.json`, `web/package.json`, README и docs.
- [ ] Тег `vX.Y.Z` создан и запушен.
- [ ] GitHub Release опубликован и помечен Latest.
- [ ] CI на теге — зелёный.
- [ ] Прод проверен (если применимо).

---

## 10. Копируемый чек-лист

```markdown
## Release vX.Y.Z

### Code
- [ ] pnpm install --frozen-lockfile (+ web)
- [ ] pnpm lint
- [ ] pnpm typecheck
- [ ] pnpm db:generate — без неожиданных миграций
- [ ] pnpm test — 1001
- [ ] pnpm --dir web test — 339
- [ ] pnpm build — 0 warnings
- [ ] pnpm --dir web build
- [ ] P1-кейсы QA пройдены

### Docs
- [ ] USER_GUIDE.md — версия, UI, ограничения
- [ ] MANUAL_TESTING_GUIDE.md — новые кейсы, сводка
- [ ] PROMPT_CURRENT.md — метрики, KI, план; старая версия в archive/prompts/
- [ ] CHANGELOG.md — [X.Y.Z], пустой [Unreleased]
- [ ] KNOWN_ISSUES.md — статусы, сводка grep'ом
- [ ] README.md — бейдж и статус
- [ ] docs/README.md — метрики и ссылки
- [ ] RULES.md — правила/история (если менялись)

### Release
- [ ] package.json + web/package.json — X.Y.Z
- [ ] git grep старой версии — чисто
- [ ] Merge в main, CI зелёный
- [ ] git tag -a vX.Y.Z
- [ ] git push origin main vX.Y.Z
- [ ] gh release create --latest
- [ ] CI на теге зелёный
- [ ] Прод проверен
```
