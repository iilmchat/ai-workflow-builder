import { z } from 'zod';

/**
 * Zod-схема создания запуска workflow.
 *
 * Проверяет только формат идентификатора: существование workflow — забота
 * `RunsService` (Zod валидирует границу, а не бизнес-правила, RULES 1.17).
 */
export const CreateRunSchema = z.object({
  workflowId: z.uuid('workflowId должен быть валидным UUID'),
  /**
   * Входные значения запуска (KI-027). Ключ — имя входного порта узла-источника,
   * значение — произвольный JSON. Ограничиваем размер, чтобы один запрос не
   * записал в `workflow_runs.inputs` мегабайты (RULES 1.17).
   */
  inputs: z.record(z.string().min(1).max(128), z.unknown()).optional(),
});

/** Валидированный DTO создания запуска workflow. */
export type CreateRunDto = z.infer<typeof CreateRunSchema>;
