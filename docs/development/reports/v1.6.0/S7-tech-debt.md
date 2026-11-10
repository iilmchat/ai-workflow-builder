---
title: "S7: Tech Debt & Enterprise Foundations"
date: 2026-11-10
version: v1.6.0
steps: [S7]
status: accepted
related_ki: [KI-012, KI-017, KI-018, KI-019, KI-214, KI-215]
related_adr: []
---

# Отчёт S7: технический долг и foundations для v1.6.0

Шаг закрывает шесть Medium-KI, накопившихся до релиза v1.5.0: единый формат
ошибок API, валидацию формы графа, fail-fast Redis, индексы `workflows` и
`refresh_tokens`, очистку истёкших refresh-токенов и остаточный drift
`timestamp`/`timestamptz`. Код и миграции изменены; коммит не делался
(RULES § 2.1, § 8).

## 1. Файлы (+/−)

| Файл | Статус | Строк (+/−) | Что именно |
|---|---|---:|---|
| `src/db/schema.ts` | изменён | 76 / 36 | индексы `workflows_user_id_idx` и `refresh_tokens_expires_at_idx`; комментарии KI-214/KI-215; Prettier выровнял несколько существующих длинных строк |
| `drizzle/0022_lyrical_midnight.sql` | новый | 30 / 0 | оба индекса + идемпотентный DO-блок KI-018 (`timestamp without time zone` → `timestamptz` через `AT TIME ZONE 'UTC'`) |
| `drizzle/meta/0022_snapshot.json` | новый | 1537 / 0 | snapshot Drizzle после генерации |
| `drizzle/meta/_journal.json` | изменён | 7 / 0 | запись миграции `0022` |
| `src/common/filters/http-exception.filter.ts` | новый | 175 / 0 | глобальный фильтр `{ success: false, message, errorCode? }` (KI-012) |
| `src/common/filters/http-exception.filter.spec.ts` | новый | 195 / 0 | 7 тестов: строки/массивы сообщений, `errorCode`/`code`, 500 без утечки, query не логируется, `headersSent` |
| `src/main.ts` | изменён | 10 / 1 | `app.useGlobalFilters(new HttpExceptionFilter())` |
| `src/workflow/dto/workflow-graph.validation.ts` | новый | 220 / 0 | чистые проверки графа: форма узлов/связей, дубликаты `id`, ссылки на существующие узлы |
| `src/workflow/dto/workflow-graph.validation.spec.ts` | новый | 175 / 0 | 10 тестов Zod-схем и `ZodValidationPipe` → 400 |
| `src/workflow/dto/create-workflow.dto.ts` | изменён | 61 / 12 | `superRefine` на узлы/связи/ссылки; `any[]` заменён на `unknown[]` (KI-017) |
| `src/workflow/dto/update-workflow.dto.ts` | изменён | 41 / 5 | проверки для частичного PATCH; общие `WorkflowNameSchema`/`WorkflowDescriptionSchema` |
| `src/workflow/dto/index.ts` | изменён | 1 / 0 | экспорт проверок графа |
| `src/workflow/workflow.service.ts` | изменён | 92 / 26 | `assertGraphValid` в `createAsync` и проверка итогового графа в `updateAsync`; касты `NodeDto[]`/`EdgeDto[]` |
| `src/workflow/workflow.service.spec.ts` | изменён | 129 / 19 | валидные графы в существующих тестах + 3 теста отказа (create, edges-only, удаление узла) |
| `src/redis/redis.module.ts` | изменён | 93 / 2 | `OnModuleInit`, `pingRedisWithTimeoutAsync` (3 с), fail-fast `Error` (KI-019) |
| `src/redis/redis.module.spec.ts` | новый | 68 / 0 | 6 тестов ping/таймаута/`onModuleInit` |
| `src/auth/auth.service.ts` | изменён | 41 / 6 | `cleanupExpiredTokensAsync(now)` — `DELETE ... WHERE expires_at < now` (KI-215) |
| `src/auth/auth.service.spec.ts` | изменён | 83 / 14 | мок top-level `delete` + 2 теста очистки (SQL и количество) |
| `src/auth/refresh-token-cleanup.service.ts` | новый | 119 / 0 | очередь `auth-maintenance`, cron `0 4 * * *`, `upsertJobScheduler`, воркер |
| `src/auth/refresh-token-cleanup.service.spec.ts` | новый | 72 / 0 | регистрация расписания, сбой регистрации не роняет приложение, вызов очистки |
| `src/runs/runs.module.ts` | изменён | 37 / 0 | регистрация очереди `auth-maintenance` и `RefreshTokenCleanupProcessor` |
| `src/auth/auth.module.ts` | изменён | 5 / 0 | комментарий, почему очистка живёт в `RunsModule` (без Redis-зависимости) |
| `docs/KNOWN_ISSUES.md` | изменён | 41 / 12 | шесть KI → `Fixed` + `Fix (S7)`; сводка 294/280, сумма 657 |
| `docs/CHANGELOG.md` | изменён | 25 / 0 | записи S7 в `[Unreleased]` (Added/Fixed) |
| `docs/development/reports/v1.6.0/S7-tech-debt.md` | новый | этот файл | отчёт по RULES § 2.15/2.18 |

## 2. Build / test

| Проверка | Команда | Результат |
|---|---|---|
| Typecheck | `pnpm typecheck` | **0 ошибок** |
| Сборка | `pnpm build` | **0 ошибок, 0 предупреждений** |
| Тесты | `pnpm test` | **2096 passed / 26 skipped** (2122), 137 файлов passed + 4 skipped; до шага было 2065 passed, добавлен 31 тест |
| Lint | `pnpm lint` | **0 ошибок**; 2 pre-existing warning в `openai-images.provider.spec.ts` (не связаны с S7) |
| Генерация миграций | `pnpm db:generate` | первый запуск создал `0022`; повторный — `No schema changes, nothing to migrate` |
| Применение миграций | `pnpm db:migrate` | **23 миграции** применены к локальной БД `127.0.0.1:5433/workflow_builder` |
| Проверка БД | SQL-запрос к `pg_indexes`/`information_schema` | индексы `workflows_user_id_idx`, `workflows_organization_id_idx`, `refresh_tokens_expires_at_idx` есть; колонок `timestamp without time zone` — **0** |

## 3. Диагностика

### 3.1. KI-018: типы времени

`src/db/schema.ts` уже объявлял все 22 `timestamp`-колонки с
`{ withTimezone: true }`, а drift исторических таблиц закрыла миграция
`0006_timestamptz_drift` (KI-293). То есть на уровне схемы и snapshot'ов
чинить было нечего — `pnpm db:generate` не видел изменений.

Чтобы требование «привести все колонки к `timestamptz`» выполнялось и для
сред, где `0006` не применялась (или колонка добавлена вручную), в `0022`
добавлен идемпотентный DO-блок: он переводит **только** колонки с
`data_type = 'timestamp without time zone'` и использует
`USING <col> AT TIME ZONE 'UTC'`. Уже корректные `timestamptz` не трогаются,
поэтому значения не сдвигаются при session TZ ≠ UTC. После `pnpm db:migrate`
проверка вернула 0 naive-колонок.

### 3.2. KI-012: формат ошибок

Фильтр отдаёт `{ success: false, message, errorCode? }`:

- `HttpException` со строковым ответом → сообщение как есть;
- объект с `message: string[]` (Nest/`ValidationPipe`) → склейка через `; `;
- `errorCode` берётся из `errorCode`, затем из `code`; из HTTP-статуса код не
  выдумывается;
- не-`HttpException` → 500 и общий текст `Внутренняя ошибка сервера`, детали
  и стек — только в лог; query-строка не логируется (в ней бывают токены);
- если `headersSent`, фильтр не пишет второй ответ.

Фильтр подключён в `main.ts` через `app.useGlobalFilters`, то есть покрывает
контроллеры, пайпы и guard'ы. Юнит-тесты контроллеров фильтр не используют,
поэтому их ожидания менять не потребовалось.

### 3.3. KI-017: форма графа

В DTO добавлены проверки:

1. каждый узел — объект с непустым `id`;
2. `node.id` не дублируются;
3. каждая связь — объект с непустыми `source`/`target`;
4. `source`/`target` ссылаются на существующий `id`.

Элементы остаются `unknown[]`: Zod проверяет инварианты, но не вырезает
UI-поля React Flow (`selected`, `dragging`, `measured`) — это важно для
round-trip сохранения графа.

Ограничение partial-PATCH: если пришёл только `edges` (или только `nodes`),
DTO не знает текущий граф. Поэтому `WorkflowService.updateAsync` читает
текущую строку и проверяет **итоговый** граф (переданное поле + текущее из
БД). `createAsync` повторяет проверку как вторую границу (RULES § 1.17).
Так закрыт сценарий «удалили узел, оставив висячие связи».

### 3.4. KI-019: Redis fail-fast

`RedisModule.onModuleInit` вызывает `pingRedisWithTimeoutAsync(this.redis)`:
`Promise.race` между `PING` и таймером на 3 с. Таймер снимается в `finally`,
поэтому успешный ping не оставляет висящий `setTimeout`. При ошибке или
таймауте модуль бросает `Error` → Nest прерывает старт → контейнер
перезапускается. Строка `REDIS_URL` и тело ошибки соединения в сообщение не
попадают.

### 3.5. KI-214: индексы

Добавлены `workflows_user_id_idx` и (для очистки KI-215)
`refresh_tokens_expires_at_idx`. `workflows_organization_id_idx` уже был и
сохранён. Оба индекса созданы миграцией `0022`, наличие проверено запросом к
`pg_indexes`.

### 3.6. KI-215: очистка refresh-токенов

`AuthService.cleanupExpiredTokensAsync(now = new Date())` удаляет строки
`expires_at < now` и возвращает количество. Очередь `auth-maintenance`
зарегистрирована в `RunsModule` (не в `AuthModule` — см. § 5.2): в
`onModuleInit` она делает `upsertJobScheduler('refresh-token-cleanup-daily',
{ pattern: '0 4 * * *' }, ...)`, воркер вызывает метод и логирует число
удалённых строк. Сбой регистрации логируется и не роняет API: Redis уже
проверен на старте, а очистка вторична.

## 4. Smoke

1. `pnpm db:migrate` — миграции применились без ошибок (23 записи в
   `drizzle.__drizzle_migrations`).
2. SQL-проверка: три ожидаемых индекса на месте, naive `timestamp` — 0.
3. `pnpm db:generate` после миграции — `No schema changes`.
4. `pnpm test` — 2096 passed, включая новые тесты фильтра, Redis, графа,
   очистки токенов и процессора.
5. `pnpm typecheck` и `pnpm build` — без ошибок.
6. Runtime-smoke (`pnpm start`) не выполнялся: локальный Redis на
   `127.0.0.1:6379` не запущен, и после KI-019 приложение обязано упасть на
   старте. Это ожидаемое поведение; для ручной проверки нужен `docker compose
   up redis` (или `REDIS_URL` на живой инстанс).
7. `pnpm test:e2e` не запускался по той же причине (AppModule стартует
   `RedisModule.onModuleInit`).

## 5. Что не так / отклонения

1. **KI-018 был уже исправлен миграцией `0006` (KI-293).** Схема и snapshot
   содержали только `timestamptz`; менять типы в `schema.ts` было нечего.
   Вместо фиктивной миграции в `0022` добавлен идемпотентный convergence-блок,
   который добивает только остаточный naive-drift. Это отклонение от буквы
   задания («приведи все колонки»), но не от цели.
2. **Очередь очистки перенесена из `AuthModule` в `RunsModule`.** Первая
   версия регистрировала BullMQ прямо в `AuthModule`, и `WebSearchModule`
   (импортирует `AuthModule` ради guard'а) начал требовать `REDIS_URL` —
   5 тестов упали с `Configuration key "REDIS_URL" does not exist`. Задание
   разрешает `AuthModule` **или** `RunsModule`; выбран второй, чтобы
   auth-модуль не тащил Redis во все потребители.
3. **Partial-PATCH нельзя полностью проверить в DTO.** `UpdateWorkflowSchema`
   проверяет ссылки только когда пришли и `nodes`, и `edges`; для одного
   массива проверка идёт в сервисе по текущему графу. Это осознанное
   разделение, иначе DTO пришлось бы делать запрос в БД.
4. **Фильтр не отдаёт `validation`.** `ZodValidationPipe` кладёт детали в
   `validation`, но требуемый контракт — только `message`/`errorCode`. Если
   клиенту понадобятся field-level ошибки, контракт нужно расширять
   отдельно (кандидат в KI, § 6).
5. **`errorCode` появляется редко.** Большинство существующих исключений не
   задают ни `errorCode`, ни `code`, поэтому поле опционально и в этих
   ответах отсутствует. Это соответствует заданию, но не даёт машинных кодов
   «из коробки».
6. **Fail-fast проверяет только pub/sub-клиент.** BullMQ использует свои
   соединения; если Redis примет `PING`, но откажет BullMQ, ошибка всплывёт
   позже. Для полного покрытия нужен отдельный ping очередей (кандидат в KI).
7. **Очистка удаляет только истёкшие токены.** Отозванные, но ещё не
   истёкшие строки остаются — это сохраняет историю повторного использования
   (исходный дизайн `refresh_tokens`). Если нужна очистка и по `revoked_at`,
   это отдельное решение.
8. **Prettier добавил шум в diff.** Репозиторий не полностью отформатирован
   (есть строки > 80 символов), поэтому `prettier --write` переформатировал
   несколько существующих строк в `schema.ts`, `auth.service.ts` и
   `workflow.service.ts`. Семантических изменений нет; при ревью помогает
   `git diff -w`.
9. **Прод-миграция не применялась.** `pnpm db:migrate` выполнен только на
   локальной БД. На проде `0022` нужно применить при следующем деплое; DO-блок
   идемпотентен, индексы создаются штатно.
10. **Open High остаётся 1** — KI-667 (автобэкапы/restore-drill), S7 его не
    затрагивает.
11. **HEAD на старте — `db7a49e` (P2-2), а не релизный `66a47d7`.** Рабочее
    дерево было чистым; изменения сделаны поверх `db7a49e`. На состав S7 это не
    влияет: затронутые файлы не пересекаются с P2-2.

## 6. Новые KI

Новые KI **не заводились**, чтобы не менять проверенный счёт 657 без
необходимости. Кандидаты на следующий шаг:

1. **Field-level ошибки API.** Фильтр теряет `validation` из
   `ZodValidationPipe`; если UI захочет подсвечивать конкретные поля, нужен
   расширенный контракт (`errors?: Array<{ path, message }>`).
2. **Ping BullMQ-соединений на старте.** KI-019 покрывает только
   pub/sub-клиент; BullMQ-очереди проверяются косвенно.
3. **Сбой регистрации cron-очистки.** Сейчас только `logger.error`; при
   желании — метрика/алерт, чтобы пропущенное расписание не осталось
   незамеченным.
4. **Очистка отозванных токенов.** Отозванные, но не истёкшие строки живут до
   `expires_at`; политика хранения истории не формализована.

## 7. Итоговое решение

Шесть KI закрыты: KI-012 (единый формат ошибок), KI-017 (валидация графа),
KI-018 (timestamptz + convergence-блок), KI-019 (fail-fast Redis), KI-214
(индекс `workflows.user_id`), KI-215 (очистка `refresh_tokens`). В
`KNOWN_ISSUES.md` они переведены в `Fixed` с заметками `Fix (S7)`; сводка
обновлена: **657** записей, `Fixed` **294**, `Open` **280**, сумма и число
уникальных номеров — 657. В `CHANGELOG.md` добавлены записи в `[Unreleased]`.

Проверки: `pnpm test` — 2096 passed / 26 skipped, `pnpm typecheck` — 0 ошибок,
`pnpm build` — 0 ошибок, `pnpm lint` — 0 ошибок (2 pre-existing warning),
`pnpm db:generate` — no changes после `0022`, `pnpm db:migrate` — 23 миграции,
в БД 0 naive `timestamp` и все три индекса. Коммит не делался; изменения
остаются в рабочем дереве.
