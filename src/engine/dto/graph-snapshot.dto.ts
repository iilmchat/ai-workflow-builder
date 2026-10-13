import { z } from 'zod';
import { EdgeSchema, NodeSchema } from './graph.dto.js';

/**
 * Zod-схема снимка графа workflow.
 *
 * Снимок — это копия `nodes` + `edges` на момент запуска (`workflow_runs.snapshot`,
 * KI-014). Схема объявлена отдельно от `GraphSchema` осознанно: снимок
 * хранится в БД и должен уметь эволюционировать независимо от DTO графа
 * (например, в v0.4+ в него добавится версия графа).
 *
 * `.default([])` нужен для толерантного чтения старых строк БД, где поле могло
 * отсутствовать.
 */
export const GraphSnapshotSchema = z.object({
  nodes: z.array(NodeSchema).default([]),
  edges: z.array(EdgeSchema).default([]),
});

/** Валидированный снимок графа workflow. */
export type GraphSnapshotDto = z.infer<typeof GraphSnapshotSchema>;
