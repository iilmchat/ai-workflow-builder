# Синхронизация KNOWN_ISSUES.md с GitHub Issues

**Версия:** 1.0
**Дата:** 2026-10-13
**Статус:** Implemented (v0.3.1)
**Адаптировано из:** IIChatTools (KI-214).

---

## § 1. Зачем

`docs/KNOWN_ISSUES.md` — единый реестр KI в плоском Markdown. Плюсы: git-blame,
diff-able, источник истины. Минусы: нет фильтрации, сортировки, поиска по labels.

GitHub Issues дают нативный UI, но полный рефакторинг на Issues потеряет
`git-blame` и Markdown-историю.

**Подход B (витрина):**
- `KNOWN_ISSUES.md` — **единственный source of truth** (скрипт только читает).
- `scripts/sync-known-issues.ps1` — **парсит** MD и создаёт/обновляет Issues.
- Двусторонней синхронизации **нет** (правки в Issues игнорируются).

---

## § 2. Требования

- `gh` CLI ≥ 2.40 ([install](https://cli.github.com/)).
- Авторизация с правами `repo` + `issues:write`:

  ```powershell
  gh auth status
  # Ожидание: "Logged in to github.com account <user>"
  # Token scopes: 'repo', 'workflow', ...
  ```

- Права `ADMIN` или `WRITE` на репозиторий:

  ```powershell
  gh repo view iilmchat/ai-workflow-builder --json viewerPermission
  # Ожидание: { "viewerPermission": "ADMIN" }
  ```

---

## § 3. Как запускать

### 3.1. Dry-run (проверка без gh)

```powershell
cd D:\Projects\AI\workflow-builder
pwsh scripts/sync-known-issues.ps1 -DryRun
```

Показывает, что было бы создано/обновлено. **Никаких вызовов gh не делает.**

### 3.2. Точечный прогон

```powershell
pwsh scripts/sync-known-issues.ps1 -Filter "KI-005,KI-007"
```

### 3.3. Полный прогон

```powershell
pwsh scripts/sync-known-issues.ps1
```

Первый полный прогон: ~9 Issues за ~30 секунд.

### 3.4. Только создание (не обновлять существующие)

```powershell
pwsh scripts/sync-known-issues.ps1 -SkipExisting
```

---

## § 4. Что делает скрипт

1. **Парсит** `docs/KNOWN_ISSUES.md` → секции `### KI-XXX — Title`.
2. **Извлекает** для каждой секции:
   - `Id` (`KI-XXX`).
   - `Title`.
   - `Priority` (эмодзи: 🔴/🟠/🟡/🟢).
   - `Status` (regex `**Статус:** XXX`).
   - `Body` (полное содержимое секции).
3. **Дедуплицирует** по `KI-id` — первое вхождение побеждает.
4. **Создаёт labels** (idempotent):
   - `ki` — все Issues.
   - `priority-{critical|high|medium|low|unknown}`.
   - `status-{fixed|resolved|implemented|documented|deferred|wontfix|planned|in-progress|partially-fixed|open|unknown}`.
5. **Для каждой секции:**
   - Нет Issue с title `KI-XXX: ...` → `gh issue create`.
   - Есть → `gh issue edit` (body + labels delta).
   - Состояние: **closed** для Fixed/Resolved/Implemented/Documented/Deferred/Won't Fix;
     **open** для Planned/Open/In Progress/Partially Fixed/Unknown.
6. **Отчёт:** created / updated / skipped / errors.

---

## § 5. Ограничения

- **Двусторонней синхронизации нет.** Правки в Issues (заголовок, тело,
  комментарии) будут перезаписаны или проигнорированы при следующем прогоне.
- **Комментарии к Issues не отключаются** (API GitHub не позволяет отключить
  их при создании — нужно вручную через UI).
- **Все KI** получают Issues, включая `Fixed` и `Documented`. Fixed — закрытые
  (`state = CLOSED`).
- **CI-триггер** (`.github/workflows/sync-issues.yml`) — на push в `main`
  при изменении `docs/KNOWN_ISSUES.md`.

---

## § 6. Когда запускать

- **Вручную** — по мере накопления изменений в `KNOWN_ISSUES.md`.
- **Автоматически** — GitHub Actions сработает при push в `main` (если изменён
  `docs/KNOWN_ISSUES.md`).
- **Перед релизом** — чтобы витрина соответствовала source of truth.

---

## § 7. Troubleshooting

### `gh issue create` → "label not found"

Скрипт создаёт labels сам при первом прогоне. Если не создался (нет прав
`issues:write`) — создайте вручную:

```powershell
gh label create ki --repo iilmchat/ai-workflow-builder --color ededed
```

### `gh` печатает кракозябры

```powershell
chcp 65001
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
```

Скрипт уже ставит эти настройки в начале.

### `504 Gateway Timeout` при `gh issue edit`

Это transient 5xx от GitHub API. Скрипт **автоматически ретраит** 3 раза
(2s → 5s → 10s). Если после retry всё ещё падает — запустите ещё раз:

```powershell
pwsh scripts/sync-known-issues.ps1
```

Transient-ошибки не приводят к `exit 1` (скрипт вернёт 0). Постоянные (4xx) —
приводят.

### Дубликаты Issues

Если в `KNOWN_ISSUES.md` есть дублирующиеся секции одного KI — скрипт
дедуплицирует (берёт первое вхождение). В Issues создаётся один Issue.

Если Issue уже создан с другим title — матч по префиксу `KI-XXX` не сработает.
Решение: вручную переименовать старый или закрыть как «duplicate».

---

## § 8. Результат первого прогона (2026-10-13, v0.3.1)

**До прогона:** `KNOWN_ISSUES.md` содержал 9 KI (KI-001..009).

**Ожидаемый результат:**
- Создано: 9 Issues.
- Labels: `ki`, `priority-*`, `status-*`.
- `Fixed`/`Documented` — закрыты (`state = CLOSED`).
- `Planned` — открыты (`state = OPEN`).

---

## § 9. Будущее

- **Уведомления в комментарии** на регрессию KI (если Issue закрыт, а в MD —
  снова Planned) — не реализовано.
- **Bidirectional sync** — не планируется (подход B — только витрина).
- **Интеграция с реестром коммитов** — если в commit message есть `KI-XXX`,
  автоматически комментировать Issue с ссылкой на коммит. Возможно в v0.4.0+.