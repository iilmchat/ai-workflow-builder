import { z } from 'zod';
import { requestAsync } from './api';

/** Ответ `POST /workflow/:id/share` (R6.2.1). */
export const ShareTokenSchema = z.object({
  shareToken: z.string(),
  shareUrl: z.string(),
});

/** Публичное представление графа по share-ссылке (без владельца). */
export const SharedWorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  createdAt: z.string(),
});

/** Токен share-ссылки и относительный путь. */
export type ShareToken = z.infer<typeof ShareTokenSchema>;
/** Публичный граф. */
export type SharedWorkflow = z.infer<typeof SharedWorkflowSchema>;

/**
 * Создаёт (или перевыпускает) share-ссылку workflow.
 *
 * Повторный вызов перевыпускает токен: старая ссылка становится недействительной
 * (KI-237).
 *
 * @param workflowId - uuid сохранённого workflow
 * @returns токен и относительный путь ссылки
 */
export async function createShareTokenAsync(workflowId: string): Promise<ShareToken> {
  const body = await requestAsync<unknown>(`/workflow/${workflowId}/share`, {
    method: 'POST',
  });

  return ShareTokenSchema.parse(body);
}

/**
 * Отзывает share-ссылку (`share_token = NULL`).
 *
 * @param workflowId - uuid сохранённого workflow
 * @returns промис без значения
 */
export async function revokeShareTokenAsync(workflowId: string): Promise<void> {
  await requestAsync<unknown>(`/workflow/${workflowId}/share`, { method: 'DELETE' });
}

/**
 * Читает публичный граф по share-токену (без аутентификации).
 *
 * @param token - share-токен (uuid)
 * @returns публичное представление графа
 */
export async function fetchSharedWorkflowAsync(token: string): Promise<SharedWorkflow> {
  const body = await requestAsync<unknown>(`/workflow/share/${token}`);

  return SharedWorkflowSchema.parse(body);
}
