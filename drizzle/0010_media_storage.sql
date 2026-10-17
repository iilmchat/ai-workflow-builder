-- R7.8 (KI-362): своя (стабильная) ссылка на media-результат.
-- `stored_url` — файл, скачанный к нам (LocalMediaStorage/S3) сразу после
-- успешной генерации; `stored_expires_at` — когда ссылка перестанет быть
-- доступной (TTL). `node_runs.outputs` не меняется: `resultUrls` остаются
-- fallback-ом на случай, если сохранение не удалось.
ALTER TABLE "node_runs" ADD COLUMN "stored_url" text;--> statement-breakpoint
ALTER TABLE "node_runs" ADD COLUMN "stored_expires_at" timestamp with time zone;
