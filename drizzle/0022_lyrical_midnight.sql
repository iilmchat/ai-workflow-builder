CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "workflows_user_id_idx" ON "workflows" USING btree ("user_id");--> statement-breakpoint
-- KI-018: страховка от остаточного drift'а `timestamp without time zone`.
--
-- Исторические колонки уже приведены миграцией 0006 (KI-293), а в
-- `src/db/schema.ts` все `timestamp` объявлены с `{ withTimezone: true }`.
-- Этот блок оставлен намеренно: он доводит до timestamptz **только** колонки,
-- которые всё ещё naive, поэтому повторный запуск безопасен и не сдвигает
-- значения у уже корректных timestamptz. `AT TIME ZONE 'UTC'` фиксирует
-- семантику старых значений (они писались при session TZ = UTC) и не зависит
-- от TimeZone клиента, применяющего миграцию.
DO $$
DECLARE
  column_to_convert record;
BEGIN
  FOR column_to_convert IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'timestamp without time zone'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE ''UTC''',
      column_to_convert.table_schema,
      column_to_convert.table_name,
      column_to_convert.column_name,
      column_to_convert.column_name
    );
  END LOOP;
END $$;