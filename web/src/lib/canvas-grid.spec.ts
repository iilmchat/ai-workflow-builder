import { describe, expect, it } from 'vitest';
import { SNAP_GRID, snapToGridPosition } from './canvas-grid';

describe('snapToGridPosition (KI-252)', () => {
  it('шаг сетки — 8×8', () => {
    expect(SNAP_GRID).toEqual([8, 8]);
  });

  it('округляет дробные координаты до ближайшего узла сетки', () => {
    expect(snapToGridPosition({ x: 13, y: 200.5 })).toEqual({ x: 16, y: 200 });
    expect(snapToGridPosition({ x: 3, y: -5 })).toEqual({ x: 0, y: -8 });
  });

  it('не меняет уже выровненные позиции', () => {
    expect(snapToGridPosition({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(snapToGridPosition({ x: 240, y: 128 })).toEqual({ x: 240, y: 128 });
  });
});
