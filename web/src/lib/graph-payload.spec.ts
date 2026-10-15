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

describe('graph-payload: граница с backend (KI-187, KI-266)', () => {
  it('local-only фильтр пуст — backend поддерживает аннотации (KI-266)', () => {
    expect([...LOCAL_ONLY_NODE_TYPES]).toEqual([]);
    expect(isLocalOnlyNodeType('comment')).toBe(false);
    expect(isLocalOnlyNodeType('text')).toBe(false);
    expect(isLocalOnlyNodeType('нечто-новое')).toBe(false);
  });

  it('toBackendNodes сохраняет комментарии и порядок узлов (KI-266)', () => {
    const nodes = [textNode('t1'), commentNode('c1'), textNode('t2'), commentNode('c2')];

    expect(toBackendNodes(nodes).map((node) => node.id)).toEqual([
      't1',
      'c1',
      't2',
      'c2',
    ]);
  });

  it('toBackendNodes возвращает тот же список, когда комментариев нет', () => {
    const nodes = [textNode('t1'), textNode('t2')];

    expect(toBackendNodes(nodes)).toEqual(nodes);
  });

  it('toBackendEdges сохраняет связи с комментариями, но режет связи с чужими узлами', () => {
    const nodes = [textNode('t1'), textNode('t2'), commentNode('c1')];
    const edges = [
      edge('e1', 't1', 't2'),
      edge('e2', 't1', 'c1'),
      edge('e3', 'c1', 't2'),
      // Узла `ghost` в payload нет — такая связь стала бы 400 на backend.
      edge('e4', 't1', 'ghost'),
    ];

    expect(toBackendEdges(edges, nodes).map((item) => item.id)).toEqual([
      'e1',
      'e2',
      'e3',
    ]);
  });

  it('toBackendEdges сохраняет все связи, когда комментариев нет', () => {
    const nodes = [textNode('t1'), textNode('t2')];
    const edges = [edge('e1', 't1', 't2')];

    expect(toBackendEdges(edges, nodes)).toHaveLength(1);
  });
});
