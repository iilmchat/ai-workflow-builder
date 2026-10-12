import { z } from 'zod';

/** Zod-схема позиции узла на холсте. */
export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

/** Позиция узла на холсте. */
export type PositionDto = z.infer<typeof PositionSchema>;
