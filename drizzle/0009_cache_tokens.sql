-- R7.7 (KI-055, KI-150): кэш-токены провайдера в истории узла.
-- `cache_read_tokens` — сколько входных токенов пришло из промпт-кэша
-- (Anthropic `cache_read_input_tokens`, OpenAI `cached_tokens`, DeepSeek
-- `prompt_cache_hit_tokens`). `cache_creation_tokens` — сколько токенов
-- записано в кэш (только Anthropic `cache_creation_input_tokens`).
-- Обе колонки nullable: NULL — провайдер метрику не отдал.
ALTER TABLE "node_runs" ADD COLUMN "cache_read_tokens" integer;--> statement-breakpoint
ALTER TABLE "node_runs" ADD COLUMN "cache_creation_tokens" integer;
