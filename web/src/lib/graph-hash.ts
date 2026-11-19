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
 *
 * KI-253: результаты кэшируются по ссылкам на массивы. Селектор «грязного»
 * графа в TopBar вызывается на **любое** изменение стора (SSE-статусы, тосты,
 * загрузка), а массивы `nodes`/`edges` при этом те же — без кэша JSON графа
 * сериализовался бы на каждый чих. Массивы считаются иммутабельными (zustand
 * создаёт новые при правке графа), поэтому замены по ссылке достаточно.
 */
const hashCache = new WeakMap<
  readonly AppNode[],
  WeakMap<readonly Edge[], string>
>();

export function computeGraphHash(
  nodes: readonly AppNode[],
  edges: readonly Edge[],
): string {
  let byEdges = hashCache.get(nodes);

  if (byEdges === undefined) {
    byEdges = new WeakMap<readonly Edge[], string>();
    hashCache.set(nodes, byEdges);
  }

  const cached = byEdges.get(edges);

  if (cached !== undefined) {
    return cached;
  }

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

  const result = (hash >>> 0).toString(16);

  byEdges.set(edges, result);

  return result;
}
