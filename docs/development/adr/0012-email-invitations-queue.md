# ADR 0012: Письма-приглашения через очередь BullMQ

**Дата:** 2026-11-06
**Статус:** Accepted
**Связано:** DESIGN v1.2 § 3.3; RULES 4.9, 5.1, 5.9; KI-593, KI-622..625

## Контекст

1. В v1.1.0 S1 письмо-приглашение отправлялось синхронно внутри
   `POST /admin/members/invite` (`EmailService.sendInvitationAsync`). При
   недоступном SMTP запрос ждал таймауты и возвращал `emailSent: false`;
   письмо терялось без повторов (KI-593).
2. DESIGN v1.2 § 3.3 требует вынести отправку в BullMQ: приглашение должно
   сохраняться в БД даже при недоступном SMTP, а письмо — повторяться
   (3 попытки с backoff).
3. BullMQ уже используется для workflow-runs (`RunsModule`), включая
   изоляцию инстансов через `BULLMQ_PREFIX`/`REDIS_QUEUE_DB` (KI-387).
   Добавлять второй способ фоновых задач (outbox, in-memory таймеры,
   отдельный воркер) не требуется.
4. Контракт ответа `InviteMemberResponse` (`emailSent: boolean`) зафиксирован
   backend/web гейтами (`api-contract.spec.ts`), поэтому ломать его в S2
   нельзя.

## Решение

1. **Очередь `email-invitations`.** Регистрируется в `EmailModule` через
   `BullModule.registerQueueAsync` с опциями из `createEmailQueueOptions`:
   `REDIS_URL`, `BULLMQ_PREFIX`, `REDIS_QUEUE_DB` (те же, что у
   workflow-runs). `defaultJobOptions`: `attempts: 3`,
   `backoff: { type: 'exponential', delay: 5000 }`,
   `removeOnComplete: { count: 100, age: 24h }`,
   `removeOnFail: { count: 500, age: 7d }`. Те же опции передаются в
   `queue.add`, чтобы поведение не зависело от способа регистрации очереди.
2. **Payload — сериализуемый снимок.** `{ to, orgName, inviteLink }`
   (`EmailInvitationJobData`). Ссылка собирается продюсером
   (`EmailService.buildInvitationLink`), воркеру не нужны `APP_PUBLIC_URL` и
   id приглашения. Zod-схема `EmailInvitationJobSchema` валидирует payload на
   границе воркера (RULES 1.17); битые данные — `UnrecoverableError` без
   повторов.
3. **Разделение продюсера и отправки.** `EmailService.queueInvitationAsync`
   только ставит job и возвращает `boolean`; `EmailService.sendInvitationAsync`
   остаётся реальной SMTP-отправкой (его контракт «никогда не бросает»
   сохранён). `EmailProcessor` (`@Processor`, `WorkerHost`) вызывает
   `sendInvitationAsync` и превращает `false` в `throw` — только так BullMQ
   повторяет job.
4. **HTTP не ждёт SMTP.** `OrgMembersService.inviteAsync` после INSERT
   вызывает `queueInvitationAsync` и возвращает `emailSent: false`. Ошибка
   Redis логируется, но не отменяет приглашение.
5. **Контракт не меняется.** `emailSent` остаётся в ответе, но с S2 всегда
   `false`: доставка асинхронна. Различать «в очереди» и «не поставлено»
   API пока не умеет — это KI-622 и работа S3.
6. **PII.** Email в логи не пишется (маскируется), `orgName` из логов убран
   (у личной организации он содержит email). Payload в Redis содержит email и
   ссылку-приглашение; TTL/лимиты `removeOn*` ограничивают окно (KI-623).

## Последствия

**Лучше:**
- HTTP-ручка приглашения отвечает за единицы миллисекунд и не зависит от
  доступности SMTP (смоук: 16 мс при 5-секундном retry).
- Сбой SMTP не теряет письмо: 3 попытки с backoff 5/10 с; после исчерпания
  job остаётся в `failed` для разбора.
- Приглашение создаётся всегда, даже если Redis/очередь недоступны.
- Очередь изолирована по префиксу/БД Redis, как workflow-runs.

**Хуже / ограничения:**
- `emailSent` в ответе всегда `false`; UI временно показывает «письмо не
  отправлено», даже когда оно в очереди (KI-622).
- PII и ссылка-приглашение лежат в Redis (KI-623).
- Нет ручки повторной постановки/переотправки после `failed` (KI-624).
- Без `SMTP_HOST` job всё равно делает 3 попытки и падает (KI-625).
- Появился второй воркер в процессе backend'а; при горизонтальном
  масштабировании каждый инстанс слушает очередь (это нормально для BullMQ,
  задания распределяются).
