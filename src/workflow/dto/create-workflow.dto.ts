import { z } from 'zod';

/** Zod-схема создания workflow. */
export const CreateWorkflowSchema = z.object({
  userId: z
    .string()
    .min(1, 'userId обязателен')
    .max(100, 'userId не длиннее 100 символов'),
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
