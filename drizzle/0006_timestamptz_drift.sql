-- KI-293: приведение naive-колонок к timestamptz.
--
-- Значения писались через now() при session TZ = UTC (`SHOW timezone` → UTC),
-- поэтому существующие naive-значения интерпретируются как UTC.
-- `USING <col> AT TIME ZONE 'UTC'` задаёт эту семантику явно и не зависит от
-- session TimeZone клиента, применяющего миграцию.
--
-- workflow_runs.started_at/finished_at и node_runs.started_at/finished_at —
-- nullable: NULL остаётся NULL (`AT TIME ZONE` от NULL даёт NULL).
ALTER TABLE "workflows"
  ALTER COLUMN "created_at" SET DATA TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" SET DATA TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "workflow_runs"
  ALTER COLUMN "started_at" SET DATA TYPE timestamptz USING "started_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "finished_at" SET DATA TYPE timestamptz USING "finished_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "node_runs"
  ALTER COLUMN "started_at" SET DATA TYPE timestamptz USING "started_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "finished_at" SET DATA TYPE timestamptz USING "finished_at" AT TIME ZONE 'UTC';--> statement-breakpoint
-- Довесок `drizzle-kit generate`: в snapshot 0005 workflows.created_at/updated_at
-- записаны как nullable и без типа с таймзоной, а в схеме — `.notNull()` и
-- `{ withTimezone: true }`. Без синхронизации snapshot 0006 разошёлся бы с
-- фактической БД — тот же класс дефекта, что и KI-293 (snapshot врёт про БД).
-- NULL-значений в колонках нет (проверено: 86/86 строк заполнены), поэтому
-- SET NOT NULL безопасен и не требует backfill.
ALTER TABLE "workflows"
  ALTER COLUMN "created_at" SET DEFAULT now(),
  ALTER COLUMN "created_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET DEFAULT now(),
  ALTER COLUMN "updated_at" SET NOT NULL;
