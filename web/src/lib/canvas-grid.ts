/**
 * Общие параметры сетки привязки узлов (KI-189, KI-252).
 *
 * Раньше шаг 8×8 жил локальной константой в `Canvas.tsx` и работал только при
 * перетаскивании: узлы из Toolbar и вставка в связь получали дробные
 * координаты. Теперь одну и ту же константу используют и React Flow, и стор.
 */

/** Позиция на холсте (структурно совпадает с `Position` из стора). */
export interface GridPosition {
  /** Координата X, px. */
  x: number;
  /** Координата Y, px. */
  y: number;
}

/** Шаг сетки привязки узлов, px. */
export const SNAP_GRID: [number, number] = [8, 8];

/**
 * Округляет позицию до шага сетки.
 *
 * @param position - исходная позиция (в том числе дробная)
 * @returns позиция с координатами, кратными шагу сетки
 */
export function snapToGridPosition(position: GridPosition): GridPosition {
  return {
    x: Math.round(position.x / SNAP_GRID[0]) * SNAP_GRID[0],
    y: Math.round(position.y / SNAP_GRID[1]) * SNAP_GRID[1],
  };
}
