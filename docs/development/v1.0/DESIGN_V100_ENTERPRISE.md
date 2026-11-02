# DESIGN v1.0 — Enterprise Readiness (Multi-tenancy, Audit, Observability)

**Файл:** `docs/development/v1.0/DESIGN_V100_ENTERPRISE.md`
**Версия:** 1.0 (2026-11-02)
**Статус:** Draft — ожидает ревью
**RULES:** 2.5, 2.14, 2.15

## 1. Контекст

Проект прошел путь от MVP (v0.4) до стабильной версии (v0.15.0). Теперь у нас есть:
- 25+ типов узлов
- MCP-интеграции
- DOCX/PDF генерация
- История запусков
- Три поисковых провайдера

Чтобы выйти на рынок Enterprise (B2B), нам не хватает фундаментальных вещей: **безопасности данных (арендаторы), прозрачности (аудит) и управляемости (лимиты).**

## 2. Ключевые архитектурные решения (Pillars of v1.0.0)

### 2.1 Multi-tenancy (Workspaces / Organizations)
- **Проблема:** Сейчас `userId` — это просто UUID. Нет командной работы.
- **Решение:** Вводим сущность `Organization`. Каждый workflow, шаблон и ключ API привязан к `organizationId`.
- **Роли:** Owner (владелец), Admin (управление командой), Member (создание workflow), Viewer (просмотр).
- **Биллинг:** (Задел) Учет токенов и стоимости запусков агрегируется по `organizationId` для будущих тарифов.

### 2.2 Audit Logging (Аудит)
- **Проблема:** Мы не знаем, кто удалил workflow или изменил шаблон.
- **Решение:** Таблица `audit_logs`. Записываем все действия: Login, CreateWorkflow, UpdateWorkflow, DeleteWorkflow, ShareAccess, RunWorkflow. Поля: `timestamp`, `userId`, `orgId`, `action`, `resourceId`, `metadata` (JSON).

### 2.3 Advanced Observability (Мониторинг)
- **Проблема:** OTel есть, но нет метрик для Prometheus.
- **Решение:** Экспорт метрик:
  - `http_request_duration_seconds` (по эндпоинтам).
  - `run_execution_duration_seconds` (по типам узлов).
  - `run_cost_total` (в USD/RUB).
  - Эндпоинт `/metrics` (через `prom-client`).

### 2.4 Security Hardening (Безопасность)
- **Проблема:** Нет политики паролей, нет 2FA.
- **Решение:** Интеграция с `otplib` для TOTP (Google Authenticator).

## 3. Технические срезы

### 3.1 Срез 1 — Organizations (База)
- Миграция: таблица `organizations`, поле `organization_id` в `users`, `workflows`, `document_templates`, `workflow_runs`.
- Middleware/Guard: `OrgContext` (извлекается из JWT).
- Рефакторинг `WorkflowService`: все запросы фильтруются по `orgId`.

### 3.2 Срез 2 — Audit Logs
- Миграция: таблица `audit_logs`.
- Interceptor: `AuditInterceptor` перехватывает мутирующие запросы (POST/PATCH/DELETE).
- API: `GET /admin/audit` (только для Admin).

### 3.3 Срез 3 — Prometheus Metrics
- Пакет `prom-client`.
- Контроллер `GET /metrics` (без auth, для скрейпера Prometheus).
- Метрики: кастомные гистограммы для узлов.

## 4. Совместимость
- Миграция `users` и `workflows`: создаем дефолтную организацию для каждого существующего пользователя (например, `Personal Workspace`).
- Старые JWT инвалидируются (меняется payload).

## 5. План работ

| # | Подшаг | ~сессий | Зависит от | Выход |
|---|---|---:|---|---|
| S1 | Organization DB & Auth | 1.5 | — | Миграции, JWT, `OrgContext` |
| S2 | Workflow Isolation | 1.0 | S1 | `WorkflowService` фильтрует по `orgId` |
| S3 | Audit Logs | 1.0 | S1 | Таблица, Interceptor, API |
| S4 | Metrics (Prometheus) | 1.0 | — | `GET /metrics`, `prom-client` |
| S5 | UI: Команда и Аудит | 1.0 | S3 | Страница настроек команды |
| S6 | Релиз v1.0.0 | 1.0 | S2, S4, S5 | Docs, тег, миграция |

**Итого:** ~6-7 сессий.

## 6. Что НЕ входит в v1.0.0
- Оплата подписки (Stripe/Yookassa) — только задел в БД.
- SSO (SAML/OAuth) — только 2FA.
- Интеграция с внешними SIEM (Splunk и т.д.).

## 7. Риски
| Риск | Митигация |
|---|---|
| Утечка данных между организациями | Все SQL-запросы проверяются на наличие `WHERE orgId = ...`. Код-ревью каждого метода. |
| Сложность миграции данных | Написать скрипт миграции (backfill), который создаст "Personal Workspace" для каждого юзера. |

## 8. Решения
*Ожидает ревью.*
