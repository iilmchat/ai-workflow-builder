import { z } from 'zod';

/**
 * Zod-схема создания workflow.
 *
 * KI-204: `userId` убран — владелец берётся из access-токена. Zod по умолчанию
 * отбрасывает неизвестные ключи, поэтому старый клиент с `userId` в теле
 * получит 201, а поле будет проигнорировано (совместимость до R6.1b.2).
 */
export const CreateWorkflowSchema = z.object({
  name: z
    .string()
    .min(1, 'name обязателен')
    .max(200, 'name не длиннее 200 символов'),
  description: z
    .string()
    .max(2000, 'description не длиннее 2000 символов')
    .optional(),
  nodes: z.array(z.any()).default([]),
  edges: z.array(z.any()).default([]),
});

/** Входные данные создания workflow (до применения default). */
export type CreateWorkflowInput = z.input<typeof CreateWorkflowSchema>;
/** Валидированный DTO создания workflow. */
export type CreateWorkflowDto = z.infer<typeof CreateWorkflowSchema>;
