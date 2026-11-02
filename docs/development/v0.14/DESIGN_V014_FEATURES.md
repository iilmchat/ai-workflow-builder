# DESIGN v0.14 — Run History Browser & Web Search Expansion

**Файл:** `docs/development/v0.14/DESIGN_V014_FEATURES.md`
**Версия:** 1.0 (2026-11-02)
**Статус:** Draft — ожидает ревью
**Закрывает:** Новые фичи (History, Search)
**Связанные:** KI-105, KI-461, KI-106, KI-431

## 1. Контекст

В v0.11 мы научились восстанавливать *текущий* запуск после F5 (через `?runId=` и `GET /runs/:id/nodes`). Но у пользователя нет способа посмотреть *предыдущие* запуски workflow.
Также узел `web_search` поддерживает только Tavily, что ограничивает выбор провайдера.

## 2. Что делаем

1. **Run History Browser:**
   - API: `GET /workflow/:id/runs` (список запусков с пагинацией).
   - API: `GET /runs/:id` уже есть.
   - UI: Модальное окно (или страница) «История», где виден список запусков (статус, дата, длительность, стоимость), и можно кликнуть на любой, чтобы открыть его результаты.
2. **Web Search Expansion:**
   - Добавить провайдеров `Bing`, `Google` (Custom Search), `Brave Search`.
   - Настройка через env `WEB_SEARCH_PROVIDER` (сейчас `tavily`).

## 3. Технические срезы

### 3.1 Run History API
- **`GET /workflow/:id/runs`**
  - Возвращает `{ runs: RunSummary[], total: number }`.
  - Пагинация: `?limit=20&offset=0`.
  - `RunSummary`: `id`, `status`, `startedAt`, `finishedAt`, `durationMs`, `costUsd`, `costRub`.
- **`GET /runs/:id/nodes`** — уже есть (v0.11).
- Обновить `api-contract.json`.

### 3.2 Run History UI
- В `TopBar` добавить кнопку «История» (иконка 🕒).
- Модалка `RunHistoryModal.tsx`:
  - Список запусков (таблица или карточки).
  - При клике на запуск: загрузка `fetchRunNodesAsync(runId)` и открытие панели результатов (`RunResultPanel`) для этого запуска.
- i18n: `history.title`, `history.empty`, `history.status.*`.

### 3.3 Web Search Expansion
- Создать `src/web-search/providers/bing.provider.ts` и т.д.
- Расширить `WebSearchOptions` (например, `searchDepth` для Tavily, `freshness` для Brave).
- Env: `BING_API_KEY`, `GOOGLE_SEARCH_API_KEY`, `BRAVE_API_KEY`.
- В UI узла `WebSearchNode` добавить селект провайдера (если сконфигурировано несколько).

## 4. Совместимость
- Старые графы `web_search` используют `Tavily` по умолчанию.
- История не ломает текущий запуск (просто добавляет новый API).

## 5. План работ

| # | Подшаг | ~сессий | Зависит от | Выход |
|---|---|---:|---|---|
| S1 | Run History API (`GET /workflow/:id/runs`) | 1.0 | — | API, DTO, тесты |
| S2 | Run History UI (`RunHistoryModal`) | 1.0 | S1 | UI, интеграция с RunResultPanel |
| S3 | Web Search Providers (Bing, Brave, Google) | 1.5 | — | Новые провайдеры, env, тесты |
| S4 | Релиз v0.14.0 | 1.0 | S2, S3 | Docs, CHANGELOG, тег |

**Итого:** ~5 сессий.

## 6. Что НЕ входит в v0.14
- Сравнение запусков side-by-side.
- 3D/Motion.
- OAuth для Web Search.

## 7. Риски
| Риск | Митигация |
|---|---|
| Bing/Google API имеют строгие лимиты | Указать в документации, что ключ оператора. |
| История запусков может расти бесконечно | Ввести retention policy (например, хранить только 100 последних запусков на workflow) в v0.15. |

## 8. Решения
*Ожидает ревью.*
