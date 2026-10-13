import { z } from 'zod';

/**
 * Zod-схема payload задания очереди `workflow-runs`.
 *
 * Payload возвращается из Redis и является внешними данными, поэтому на
 * границе worker'а он проверяется повторно (RULES 1.17): продюсер и
 * консюмер могут разъехаться по версиям.
 */
export const ExecuteRunJobSchema = z.object({
  runId: z.uuid('runId должен быть валидным UUID'),
});

/** Валидированный payload задания очереди `workflow-runs`. */
export type ExecuteRunJobDto = z.infer<typeof ExecuteRunJobSchema>;
