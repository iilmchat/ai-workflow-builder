import { z } from 'zod';

/**
 * Zod-схема экспортированного workflow (R6.6.1, DESIGN v0.8 § 9).
 *
 * Артефакт **sharable**: его можно передать другому пользователю или положить
 * в репозиторий как шаблон, поэтому в схеме нет ни `id`, ни `userId`, ни
 * `shareToken`, ни `createdAt` — только граф и его имя. `version` — версия
 * **формата экспорта** (литерал `1`), а не колонка `workflows.version` из БД:
 * иначе строка с `version = 2` экспортировалась бы в файл, который потом
 * невозможно импортировать (см. KI-288).
 *
 * `nodes`/`edges` намеренно `unknown[]`: форма узла зависит от типа
 * (`text`/`llm`/`http`/…), а свободные UI-поля React Flow (`selected`,
 * `measured`) обязаны переживать round-trip. Строгая схема узла сломала бы
 * forward-compat (RULES 1.17 / 4.15) — глубокая валидация графа живёт в
 * engine (RULES 4.15: `unknown` + narrowing, без `any`).
 */
export const ExportWorkflowSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  exportedAt: z.string(),
});

/** Валидированный DTO экспорта workflow. */
export type ExportWorkflowDto = z.infer<typeof ExportWorkflowSchema>;

/** Импортируемый workflow — та же схема (round-trip экспорт → импорт). */
export const ImportWorkflowSchema = ExportWorkflowSchema;

/** Валидированный DTO импорта workflow. */
export type ImportWorkflowDto = z.infer<typeof ImportWorkflowSchema>;
