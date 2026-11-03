# DESIGN v1.1 — Enterprise Polish (SMTP, Team, Audit Filters, Metrics)

**Файл:** `docs/development/v1.1/DESIGN_V110_FEATURES.md`
**Версия:** 1.0 (2026-11-03)
**Статус:** Draft — ожидает ревью
**Закрывает:** KI-574, KI-576, KI-577, KI-581, KI-582, KI-583, KI-584, KI-585, KI-586, KI-587, KI-589, KI-590
**RULES:** 2.5, 2.14, 2.15

## 1. Контекст

v1.0.0 заложил фундамент Enterprise: организации, изоляция, аудит, метрики. Но остались «дыры» в UX и инфраструктуре:
- Приглашения в команду не отправляются на почту (только строка в БД).
- Нельзя пригласить уже зарегистрированного пользователя.
- Нет управления участниками (смена роли, удаление).
- В аудите нет фильтров.
- Метрики используют deprecated-библиотеку и не покрывают ошибки агента.

## 2. Что делаем

1. **SMTP & Invitations (S1):** Интеграция с nodemailer. Отправка писем с приглашениями. Шаблон письма.
2. **Team Management (S2):** Смена роли и удаление участника (KI-586).
3. **Audit Filters (S3):** Фильтры по действию, пользователю и дате в `GET /admin/audit` (KI-585).
4. **Metrics Improvement (S4):** Переход на `@prometheus-io/client` (KI-574), добавление `status` в agent-метрику (KI-576), инструментация `llm_call` (KI-577), process-метрики (KI-581), Grafana dashboard (KI-582).
5. **Security Polish (S5):** `orgId` из БД для аудита (KI-587), маскировка email в metadata (KI-589).

## 3. Технические срезы

### 3.1 Срез 1 — SMTP & Invitations
- **Зависимость:** `nodemailer`, `@types/nodemailer`.
- **Env:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
- **Сервис:** `EmailService` (отправка письма с ссылкой на регистрацию).
- **Интеграция:** `OrgMembersService.inviteAsync` после создания приглашения вызывает `EmailService.sendInvitationAsync(email, orgName, inviteLink)`.
- **Шаблон:** HTML-письмо с кнопкой «Присоединиться» (ссылка на регистрацию с параметром `?invite=token`).
- **Безопасность:** если SMTP не настроен — WARN и приглашение создаётся (fallback).

### 3.2 Срез 2 — Team Management
- **API:** `PATCH /admin/members/:userId` (смена роли), `DELETE /admin/members/:userId` (удаление).
- **Права:** только owner.
- **БД:** `users.role` уже есть.
- **UI:** в `TeamPage` добавить кнопки управления для owner.

### 3.3 Срез 3 — Audit Filters
- **API:** `GET /admin/audit?action=...&userId=...&from=...&to=...`.
- **UI:** фильтры в `TeamPage` (вкладка Аудит).

### 3.4 Срез 4 — Metrics Improvement
- **Замена:** `prom-client` → `@prometheus-io/client` (API совместим).
- **Agent:** добавить label `status` (success/error) в `agent_step_duration_seconds`.
- **llm_call:** отдельная метрика `llm_call_duration_seconds`.
- **Process:** `collectDefaultMetrics` (CPU, RSS, event loop).
- **Grafana:** добавить `grafana/dashboard.json` и `prometheus.yml` в репозиторий.

### 3.5 Срез 5 — Security Polish
- **KI-587:** `GET /admin/audit` читает `organization_id` из БД (по `user.sub`), а не из токена.
- **KI-589:** в metadata аудита маскировать email (`a***@example.com`).

## 4. Совместимость
- SMTP опционален (при отсутствии — WARN).
- Замена `prom-client` — обратная совместимость API.
- Новые эндпоинты аддитивны.

## 5. План работ

| # | Подшаг | ~сессий | Зависит от | Выход |
|---|---|---:|---|---|
| S1 | SMTP & Invitations | 1.0 | — | `EmailService`, шаблон, тесты |
| S2 | Team Management | 1.0 | — | PATCH/DELETE members, UI |
| S3 | Audit Filters | 1.0 | — | Фильтры API + UI |
| S4 | Metrics Improvement | 1.5 | — | Замена библиотеки, новые метрики, Grafana |
| S5 | Security Polish | 0.5 | — | orgId из БД, маскировка |
| S6 | Релиз v1.1.0 | 1.0 | все | Docs, тег, миграция |

**Итого:** ~6 сессий.

## 6. Что НЕ входит в v1.1.0
- Приглашение существующих пользователей (KI-583) — требует `organization_members` (v1.2+).
- SMTP-шаблоны на разных языках (только EN/RU по locale).
- OAuth для почты.

## 7. Риски
| Риск | Митигация |
|---|---|
| SMTP-провайдер блокирует отправку | Использовать `nodemailer` с fallback на WARN. |
| Замена prom-client ломает дашборды | Проверить совместимость метрик. |

## 8. Решения
*Ожидает ревью.*
