import { describe, expect, it } from 'vitest';
import { cloneNodesForDuplicate, DUPLICATE_OFFSET } from './graph-edit';
import type { AppNode } from '@/types/graph';

/**
 * Собирает текстовый узел для тестов.
 *
 * @param id - id узла
 * @param x - координата X
 * @param y - координата Y
 * @returns узел графа
 */
function node(id: string, x: number, y: number): AppNode {
  return {
    id,
    type: 'text',
    position: { x, y },
    data: { kind: 'text', value: id },
  } as AppNode;
}

/** Генератор предсказуемых id для тестов. */
function idSequence(): () => string {
  let counter = 0;

  return () => {
    counter += 1;

    return `copy-${counter}`;
  };
}

describe('cloneNodesForDuplicate (KI-191)', () => {
  it('копирует только выбранные узлы и выдаёт новые id', () => {
    const nodes = [node('a', 0, 0), node('b', 100, 100)];
    const copies = cloneNodesForDuplicate(nodes, ['b'], idSequence());

    expect(copies).toHaveLength(1);
    expect(copies[0]?.id).toBe('text-copy-1');
    expect(copies[0]?.id).not.toBe('b');
  });

  it('смещает копию на +30/+30 и выделяет её', () => {
    const copies = cloneNodesForDuplicate([node('a', 10, 20)], ['a'], idSequence());

    expect(copies[0]?.position).toEqual({
      x: 10 + DUPLICATE_OFFSET,
      y: 20 + DUPLICATE_OFFSET,
    });
    expect(copies[0]?.selected).toBe(true);
  });

  it('данные копии не связаны с оригиналом, связи не копируются', () => {
    const original = node('a', 0, 0);
    const [copy] = cloneNodesForDuplicate([original], ['a'], idSequence());

    if (copy) {
      copy.data.value = 'изменено';
    }

    expect(original.data.value).toBe('a');
    // Функция работает только с узлами: рёбра в неё не передаются вовсе.
    expect(copy).not.toHaveProperty('edges');
  });
});
