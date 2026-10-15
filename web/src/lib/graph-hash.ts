import type { Edge } from '@xyflow/react';
import type { AppNode } from '@/types/graph';

/**
 * Считает хэш графа для индикатора «есть несохранённые изменения» (KI-195).
 *
 * Хэш нужен только UI-индикатору, поэтому это не криптография, а быстрый
 * 32-битный djb2 по каноническому JSON. В снимок входят только значимые поля:
 * id/позиция/data узла и id/source/target связи — иначе перерисовка (например,
 * `selected`) считалась бы изменением графа.
 *
 * @param nodes - узлы графа
 * @param edges - связи графа
 * @returns хэш в виде hex-строки
 */
export function computeGraphHash(
  nodes: readonly AppNode[],
  edges: readonly Edge[],
): string {
  const canonical = JSON.stringify([
    nodes.map((node) => ({
      id: node.id,
      p: node.position,
      d: node.data,
    })),
    edges.map((edge) => ({
      id: edge.id,
      s: edge.source,
      t: edge.target,
      sh: edge.sourceHandle ?? null,
      th: edge.targetHandle ?? null,
    })),
  ]);

  let hash = 5381;

  for (let index = 0; index < canonical.length; index += 1) {
    // djb2: hash * 33 + char, с приведением к 32 битам через `| 0`.
    hash = ((hash << 5) + hash + canonical.charCodeAt(index)) | 0;
  }

  return (hash >>> 0).toString(16);
}
