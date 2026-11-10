import { z } from 'zod';
import {
  applyGraphIssues,
  collectEdgeReferenceIssues,
  collectEdgeShapeIssues,
  collectNodeIssues,
} from './workflow-graph.validation.js';

/**
 * Ограничения на имя workflow.
 *
 * Вынесено отдельной схемой, чтобы `UpdateWorkflowSchema` переиспользовал
 * правило, не завязываясь на `.shape` схемы с `superRefine` (в Zod 4 такая
 * схема уже не объект, и `.shape` у неё отсутствует).
 */
export const WorkflowNameSchema = z
  .string()
  .min(1, 'name обязателен')
  .max(200, 'name не длиннее 200 символов');

/** Ограничения на описание workflow. */
export const WorkflowDescriptionSchema = z
  .string()
  .max(2000, 'description не длиннее 2000 символов')
  .optional();

/**
 * Узлы графа: форма элемента и уникальность `id` (KI-017).
 *
 * Элемент остаётся `unknown`: конкретные поля узла зависят от его типа, а
 * UI-поля React Flow должны сохраняться. Проверяются только инварианты,
 * без которых граф нельзя хранить.
 */
const WorkflowNodesSchema = z
  .array(z.unknown())
  .default([])
  .superRefine((nodes, ctx) => {
    applyGraphIssues(ctx, collectNodeIssues(nodes));
  });

/** Связи графа: форма `source`/`target` (ссылки проверяются вместе с узлами). */
const WorkflowEdgesSchema = z
  .array(z.unknown())
  .default([])
  .superRefine((edges, ctx) => {
    applyGraphIssues(ctx, collectEdgeShapeIssues(edges));
  });

/**
 * Zod-схема создания workflow.
 *
 * KI-204: `userId` убран — владелец берётся из access-токена. Zod по умолчанию
 * отбрасывает неизвестные ключи, поэтому старый клиент с `userId` в теле
 * получит 201, а поле будет проигнорировано (совместимость до R6.1b.2).
 *
 * KI-017: форма графа проверяется на входе, а не только в engine. Битый граф
 * (связь на несуществующий узел, дубликат `node.id`) отклоняется с 400 ещё до
 * записи в БД. `superRefine` на объекте нужен, потому что ссылки проверяются
 * между двумя массивами.
 */
export const CreateWorkflowSchema = z
  .object({
    name: WorkflowNameSchema,
    description: WorkflowDescriptionSchema,
    nodes: WorkflowNodesSchema,
    edges: WorkflowEdgesSchema,
  })
  .superRefine((data, ctx) => {
    applyGraphIssues(ctx, collectEdgeReferenceIssues(data.nodes, data.edges));
  });

/** Входные данные создания workflow (до применения default). */
export type CreateWorkflowInput = z.input<typeof CreateWorkflowSchema>;
/** Валидированный DTO создания workflow. */
export type CreateWorkflowDto = z.infer<typeof CreateWorkflowSchema>;
