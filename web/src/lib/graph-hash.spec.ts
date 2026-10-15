import { describe, expect, it } from 'vitest';
import { computeGraphHash } from './graph-hash';
import type { AppNode } from '@/types/graph';
import type { Edge } from '@xyflow/react';

/**
 * Собирает текстовый узел для тестов.
 *
 * @param id - id узла
 * @param value - текст узла
 * @returns узел графа
 */
function node(id: string, value: string): AppNode {
  return {
    id,
    type: 'text',
    position: { x: 0, y: 0 },
    data: { kind: 'text', value },
  } as AppNode;
}

/**
 * Собирает связь для тестов.
 *
 * @param id - id связи
 * @returns связь
 */
function edge(id: string): Edge {
  return { id, source: 'a', target: 'b' };
}

describe('computeGraphHash (KI-195)', () => {
  it('стабилен для одинакового графа', () => {
    expect(computeGraphHash([node('a', 'x')], [edge('e1')])).toBe(
      computeGraphHash([node('a', 'x')], [edge('e1')]),
    );
  });

  it('меняется при изменении связей', () => {
    expect(computeGraphHash([node('a', 'x')], [edge('e1')])).not.toBe(
      computeGraphHash([node('a', 'x')], []),
    );
  });

  it('меняется при изменении данных узла', () => {
    expect(computeGraphHash([node('a', 'x')], [])).not.toBe(
      computeGraphHash([node('a', 'y')], []),
    );
  });

  it('не зависит от выделения узла (перерисовка не делает граф «грязным»)', () => {
    const plain = node('a', 'x');
    const selected = { ...plain, selected: true } as AppNode;

    expect(computeGraphHash([selected], [])).toBe(computeGraphHash([plain], []));
  });
});
