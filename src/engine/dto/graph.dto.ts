import { z } from 'zod';
import { PositionSchema } from './position.schema.js';

/**
 * Zod-схема узла графа.
 *
 * `data` — параметры конкретного типа узла, поэтому валидируется как
 * произвольный объект (конкретную схему задаёт сам тип узла).
 * `position` и `order` необязательны: схема принимает и «сырые» узлы без
 * координат, а значения по умолчанию подставляет парсинг.
 */
export const NodeSchema = z.object({
  id: z.string().min(1, 'id узла обязателен'),
  type: z.string(),
  position: PositionSchema.optional(),
  data: z.record(z.string(), z.unknown()).default({}),
  order: z.number().optional(),
});

/** Zod-схема связи между узлами графа. */
export const EdgeSchema = z.object({
  id: z.string().min(1, 'id связи обязателен'),
  source: z.string().min(1, 'source связи обязателен'),
  target: z.string().min(1, 'target связи обязателен'),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});

/** Zod-схема графа workflow: узлы + связи. */
export const GraphSchema = z.object({
  nodes: z.array(NodeSchema).default([]),
  edges: z.array(EdgeSchema).default([]),
});

/** Валидированный узел графа. */
export type NodeDto = z.infer<typeof NodeSchema>;
/** Валидированная связь графа. */
export type EdgeDto = z.infer<typeof EdgeSchema>;
/** Валидированный граф workflow. */
export type GraphDto = z.infer<typeof GraphSchema>;
