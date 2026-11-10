import { z } from 'zod';
import {
  WorkflowDescriptionSchema,
  WorkflowNameSchema,
} from './create-workflow.dto.js';
import {
  applyGraphIssues,
  collectEdgeReferenceIssues,
  collectEdgeShapeIssues,
  collectNodeIssues,
} from './workflow-graph.validation.js';

/** Сообщение об ошибке, когда PATCH не содержит ни одного поля. */
export const EMPTY_UPDATE_MESSAGE = 'Не передано ни одного поля для обновления';

/** Узлы в PATCH: проверяются, только если поле передано (KI-017). */
const UpdateNodesSchema = z
  .array(z.unknown())
  .superRefine((nodes, ctx) => {
    applyGraphIssues(ctx, collectNodeIssues(nodes));
  })
  .optional();

/** Связи в PATCH: форма проверяется независимо от наличия узлов (KI-017). */
const UpdateEdgesSchema = z
  .array(z.unknown())
  .superRefine((edges, ctx) => {
    applyGraphIssues(ctx, collectEdgeShapeIssues(edges));
  })
  .optional();

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
 *
 * **KI-017 и частичный PATCH.** Ссылки `edge.source`/`edge.target` можно
 * проверить здесь, только когда в запросе есть оба массива. PATCH только
 * `edges` (или только `nodes`) проверяется в `WorkflowService.updateAsync`
 * против текущего графа из БД — иначе клиент мог бы удалить узел, оставив
 * висячие связи.
 */
export const UpdateWorkflowSchema = z
  .object({
    name: WorkflowNameSchema.optional(),
    description: WorkflowDescriptionSchema,
    nodes: UpdateNodesSchema,
    edges: UpdateEdgesSchema,
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: EMPTY_UPDATE_MESSAGE,
  })
  .superRefine((data, ctx) => {
    if (data.nodes !== undefined && data.edges !== undefined) {
      applyGraphIssues(ctx, collectEdgeReferenceIssues(data.nodes, data.edges));
    }
  });

/** Входные данные обновления workflow (до применения default). */
export type UpdateWorkflowInput = z.input<typeof UpdateWorkflowSchema>;
/** Валидированный DTO обновления workflow. */
export type UpdateWorkflowDto = z.infer<typeof UpdateWorkflowSchema>;
