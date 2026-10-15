import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import {
  LOCAL_ONLY_NODE_TYPES,
  isLocalOnlyNodeType,
  toBackendEdges,
  toBackendNodes,
} from './graph-payload';
import type { AppNode } from '@/types/graph';

/**
 * Собирает узел-комментарий для тестов.
 *
 * @param id - id узла
 * @param text - текст комментария
 * @returns узел графа типа `comment`
 */
function commentNode(id: string, text = ''): AppNode {
  return {
    id,
    type: 'comment',
    position: { x: 0, y: 0 },
    data: { kind: 'comment', text, visible: true },
  } as AppNode;
}

/**
 * Собирает текстовый узел для тестов.
 *
 * @param id - id узла
 * @returns узел графа типа `text`
 */
function textNode(id: string): AppNode {
  return {
    id,
    type: 'text',
    position: { x: 0, y: 0 },
    data: { kind: 'text', value: 'x' },
  } as AppNode;
}

/**
 * Собирает связь для тестов.
 *
 * @param id - id связи
 * @param source - id узла-источника
 * @param target - id узла-приёмника
 * @returns связь React Flow
 */
function edge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

describe('graph-payload: local-only узлы (KI-187)', () => {
  it('comment объявлен local-only', () => {
    expect([...LOCAL_ONLY_NODE_TYPES]).toEqual(['comment']);
    expect(isLocalOnlyNodeType('comment')).toBe(true);
    expect(isLocalOnlyNodeType('text')).toBe(false);
    expect(isLocalOnlyNodeType('нечто-новое')).toBe(false);
  });

  it('toBackendNodes убирает комментарии и сохраняет порядок остальных', () => {
    const nodes = [textNode('t1'), commentNode('c1'), textNode('t2'), commentNode('c2')];

    expect(toBackendNodes(nodes).map((node) => node.id)).toEqual(['t1', 't2']);
  });

  it('toBackendNodes не трогает граф без комментариев', () => {
    const nodes = [textNode('t1'), textNode('t2')];

    expect(toBackendNodes(nodes)).toHaveLength(2);
  });

  it('toBackendEdges отбрасывает связи с отфильтрованным узлом', () => {
    const nodes = [textNode('t1'), textNode('t2')];
    const edges = [
      edge('e1', 't1', 't2'),
      edge('e2', 't1', 'c1'),
      edge('e3', 'c1', 't2'),
    ];

    expect(toBackendEdges(edges, nodes).map((item) => item.id)).toEqual(['e1']);
  });

  it('toBackendEdges сохраняет все связи, когда комментариев нет', () => {
    const nodes = [textNode('t1'), textNode('t2')];
    const edges = [edge('e1', 't1', 't2')];

    expect(toBackendEdges(edges, nodes)).toHaveLength(1);
  });
});
