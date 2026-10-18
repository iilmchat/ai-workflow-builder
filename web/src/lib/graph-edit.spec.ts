import { describe, expect, it } from 'vitest';
import {
  cloneNodesForDuplicate,
  insertPositionOnEdge,
  DUPLICATE_OFFSET,
  INSERT_PERPENDICULAR_GAP,
  NODE_DEFAULT_HEIGHT,
  NODE_DEFAULT_WIDTH,
  TIGHT_EDGE_DISTANCE,
} from './graph-edit';
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

describe('insertPositionOnEdge (KI-260)', () => {
  it('центрирует новый узел на середине связи (позиции и размеры заданы)', () => {
    // Источник: 200..440 по X, центр по Y = 150; приёмник: 712..912, центр по Y = 250.
    const position = insertPositionOnEdge(
      { position: { x: 200, y: 100 }, width: 240, height: 100 },
      { position: { x: 712, y: 200 }, width: 200, height: 100 },
      { width: 240, height: 100 },
    );

    // Середина по X: (200 + 240 + 712) / 2 = 576; по Y: (150 + 250) / 2 = 200.
    expect(position).toEqual({ x: 576 - 120, y: 200 - 50 });
  });

  it('берёт дефолтные размеры, если `measured` ещё нет', () => {
    const position = insertPositionOnEdge(
      { position: { x: 0, y: 0 } },
      { position: { x: 400, y: 0 } },
    );

    const centerX = (0 + NODE_DEFAULT_WIDTH + 400) / 2;
    const centerY = (NODE_DEFAULT_HEIGHT / 2 + NODE_DEFAULT_HEIGHT / 2) / 2;

    expect(position).toEqual({
      x: centerX - NODE_DEFAULT_WIDTH / 2,
      y: centerY - NODE_DEFAULT_HEIGHT / 2,
    });
  });

  it('не повторяет прежний расчёт по top-left: при разной высоте узлов позиция ниже', () => {
    const source = { position: { x: 0, y: 0 }, width: 240, height: 100 };
    const target = { position: { x: 500, y: 0 }, width: 240, height: 300 };

    const position = insertPositionOnEdge(source, target, {
      width: 240,
      height: 100,
    });

    // Прежняя формула давала y = 0 (среднее top-left) — узел уезжал вверх от линии.
    expect(position.y).toBeGreaterThan(0);
    expect(position.y).toBe((50 + 150) / 2 - 50);
  });
});

describe('insertPositionOnEdge: сдвиг в тесной раскладке (KI-263)', () => {
  it('горизонтальная связь: узел уходит вниз на половину высоты + зазор', () => {
    // Шаг раскладки Toolbar — 280 px при ширине карточки 240 px (KI-263).
    const position = insertPositionOnEdge(
      { position: { x: 0, y: 0 }, width: 240, height: 100 },
      { position: { x: 280, y: 0 }, width: 240, height: 100 },
      { width: 240, height: 100 },
    );

    // Центр связи: x = (240 + 280) / 2 = 260, y = 50.
    // Сдвиг по Y = 100 / 2 + 40 = 90.
    expect(position).toEqual({
      x: 260 - 120,
      y: 50 - 50 + 100 / 2 + INSERT_PERPENDICULAR_GAP,
    });
  });

  it('вертикальная связь: узел уходит вправо на половину ширины + зазор', () => {
    const position = insertPositionOnEdge(
      { position: { x: 0, y: 0 }, width: 240, height: 100 },
      { position: { x: 0, y: 200 }, width: 240, height: 100 },
      { width: 240, height: 100 },
    );

    // Центр связи: x = 120, y = (50 + 250) / 2 = 150.
    // Сдвиг по X = 240 / 2 + 40 = 160.
    expect(position).toEqual({
      x: 120 - 120 + 240 / 2 + INSERT_PERPENDICULAR_GAP,
      y: 150 - 50,
    });
  });

  it('на пороге тесной раскладки сдвига ещё нет', () => {
    const position = insertPositionOnEdge(
      { position: { x: 0, y: 0 }, width: 240, height: 100 },
      { position: { x: TIGHT_EDGE_DISTANCE, y: 0 }, width: 240, height: 100 },
      { width: 240, height: 100 },
    );

    // Расстояние между центрами ровно 300 px — узел остаётся на линии.
    expect(position).toEqual({ x: 150, y: 0 });
  });
});
