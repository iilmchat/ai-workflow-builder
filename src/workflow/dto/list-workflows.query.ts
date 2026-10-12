import { z } from 'zod';

/**
 * Zod-схема query-параметров списка workflow.
 *
 * `limit`/`offset` приходят строками, поэтому приводятся через `z.coerce`.
 */
export const ListWorkflowsQuerySchema = z.object({
  userId: z
    .string()
    .min(1, 'userId обязателен')
    .max(100, 'userId не длиннее 100 символов')
    .optional(),
  limit: z.coerce
    .number()
    .int('limit должен быть целым числом')
    .min(1, 'limit должен быть не меньше 1')
    .max(100, 'limit не больше 100')
    .default(50),
  offset: z.coerce
    .number()
    .int('offset должен быть целым числом')
    .min(0, 'offset не может быть отрицательным')
    .default(0),
});

/** Валидированные query-параметры списка workflow. */
export type ListWorkflowsQueryDto = z.infer<typeof ListWorkflowsQuerySchema>;
