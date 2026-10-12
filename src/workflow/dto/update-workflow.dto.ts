import { z } from 'zod';
import { CreateWorkflowSchema } from './create-workflow.dto.js';

/** Сообщение об ошибке, когда PATCH не содержит ни одного поля. */
export const EMPTY_UPDATE_MESSAGE = 'Не передано ни одного поля для обновления';

/**
 * Zod-схема обновления workflow.
 *
 * Важно: поля объявлены через `.optional()` без `.default()`. Если вывести эту
 * схему из `CreateWorkflowSchema` через `.partial()`, то `nodes`/`edges`
 * сохранят свои `default([])` и пустой PATCH распарсится в
 * `{ nodes: [], edges: [] }` — тогда `.refine()` ниже никогда не сработает.
 *
 * `userId` намеренно отсутствует: владельца нельзя сменить через PATCH
 * (привязка к пользователю будет меняться только вместе с auth-модулем).
 */
export const UpdateWorkflowSchema = z
  .object({
    name: CreateWorkflowSchema.shape.name.optional(),
    description: CreateWorkflowSchema.shape.description,
    nodes: z.array(z.unknown()).optional(),
    edges: z.array(z.unknown()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: EMPTY_UPDATE_MESSAGE,
  });

/** Входные данные обновления workflow (до применения default). */
export type UpdateWorkflowInput = z.input<typeof UpdateWorkflowSchema>;
/** Валидированный DTO обновления workflow. */
export type UpdateWorkflowDto = z.infer<typeof UpdateWorkflowSchema>;
