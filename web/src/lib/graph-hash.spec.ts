import { describe, expect, it, vi } from 'vitest';
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

  it('меняется при смене типа узла (KI-324)', () => {
    const plain = node('a', 'x');
    const retyped = { ...plain, type: 'llm' } as AppNode;

    expect(computeGraphHash([plain], [])).not.toBe(
      computeGraphHash([retyped], []),
    );
  });

  it('кэширует хэш по ссылкам на nodes/edges (KI-253)', () => {
    const nodes = [node('a', 'x')];
    const edges = [edge('e1')];
    const stringify = vi.spyOn(JSON, 'stringify');

    computeGraphHash(nodes, edges);
    computeGraphHash(nodes, edges);
    // Два вызова с теми же массивами → одна сериализация.
    expect(stringify).toHaveBeenCalledTimes(1);

    // Новый массив узлов — граф изменился, хэш пересчитан.
    computeGraphHash([...nodes], edges);
    expect(stringify).toHaveBeenCalledTimes(2);

    stringify.mockRestore();
  });
});
