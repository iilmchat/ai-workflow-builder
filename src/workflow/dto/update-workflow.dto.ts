import { z } from 'zod';
import { CreateWorkflowSchema } from './create-workflow.dto.js';

/**
 * Zod-схема обновления workflow.
 *
 * Все поля, кроме `userId`, становятся необязательными: `userId` исключён
 * через `.omit()`, чтобы владельца нельзя было сменить через PATCH
 * (привязка к пользователю будет меняться только вместе с auth-модулем).
 */
export const UpdateWorkflowSchema = CreateWorkflowSchema.omit({
  userId: true,
}).partial();

/** Входные данные обновления workflow (до применения default). */
export type UpdateWorkflowInput = z.input<typeof UpdateWorkflowSchema>;
/** Валидированный DTO обновления workflow. */
export type UpdateWorkflowDto = z.infer<typeof UpdateWorkflowSchema>;
