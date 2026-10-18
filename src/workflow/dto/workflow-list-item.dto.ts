import type { Workflow } from '../../db/schema.js';
import type { WorkflowAccessRoleWithOwner } from '../workflow-access.js';

/**
 * Элемент списка `GET /workflow` (KI-398).
 *
 * Это строка `workflows` плюс вычисленная роль текущего пользователя:
 * `owner` — собственный workflow, `editor`/`viewer` — чужой, доступный через
 * `workflow_collaborators`. Отдельного поля `isOwner` нет намеренно: одна
 * величина не даёт UI противоречивого состояния («владелец и viewer
 * одновременно»).
 */
export interface WorkflowListItem extends Workflow {
  /** Роль текущего пользователя в этом workflow. */
  accessRole: WorkflowAccessRoleWithOwner;
}
