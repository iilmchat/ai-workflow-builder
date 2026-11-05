# DESIGN v1.2 — GPU Backend Router & Reliability

**Файл:** `docs/development/v1.2/DESIGN_V120_FEATURES.md`
**Версия:** 1.0 (2026-11-06)
**Статус:** Draft
**Закрывает:** KI-500, KI-574, KI-592, KI-593, KI-615

## 1. Контекст

После v1.1.0 у нас есть мультитенантность, аудит и метрики. Но:
1. LLM-вызовы идут только в облако (платно).
2. Нет механизма автоматического fallback при недоступности провайдера.
3. Остались Low/Medium KI.

## 2. Что делаем

1. **BackendRouter (GPU + Cloud):** Умный роутер, который пробует локальный LM Studio (если настроен), а при ошибке падает на облачную LLM.
2. **Healthcheck:** Периодическая проверка доступности LM Studio.
3. **SMTP Retry:** Добавить очередь/ретраи для email.
4. **UI Indicator:** Показать статус GPU в интерфейсе.

## 3. Технические срезы

### 3.1 Срез 1 — LLM Router
- Создать `src/llm/llm-router.service.ts`.
- Логика: `try { LMStudio } catch { fallback to Cloud }`.
- Конфиг: `LLM_ROUTER_ENABLED=true`.
- Добавить `isAvailable()` в `ILlmProvider`.

### 3.2 Срез 2 — Healthcheck
- Периодический пинг `GET /v1/models` (каждые 30 сек).
- При 3 подряд неудачах — переключение на Cloud.

### 3.3 Срез 3 — SMTP Retry
- Вынести `EmailService` в BullMQ очередь.
- Ретраи 3 раза с backoff.

### 3.4 Срез 4 — UI & Docs
- Индикатор в TopBar (`GPU: online/offline`).
- Обновить USER_GUIDE.

## 4. Совместимость
- Без настроенного LM Studio работает как раньше.
- `LLM_ROUTER_ENABLED=false` отключает всю логику.

## 5. План работ
- S1: LLM Router + Healthcheck
- S2: SMTP Retry
- S3: UI + Docs
- S4: Release v1.2.0
