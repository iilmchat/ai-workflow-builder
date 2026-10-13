import { z } from 'zod';

/**
 * Zod-схема создания запуска workflow.
 *
 * Проверяет только формат идентификатора: существование workflow — забота
 * `RunsService` (Zod валидирует границу, а не бизнес-правила, RULES 1.17).
 */
export const CreateRunSchema = z.object({
  workflowId: z.uuid('workflowId должен быть валидным UUID'),
});

/** Валидированный DTO создания запуска workflow. */
export type CreateRunDto = z.infer<typeof CreateRunSchema>;
