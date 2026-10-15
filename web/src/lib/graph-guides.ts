/**
 * Ширина узла в редакторе (px).
 *
 * Fallback для направляющих: React Flow v12 хранит размеры в `node.measured`,
 * но у узлов, ещё не измеренных (или пришедших из нестандартного источника),
 * поле может отсутствовать — тогда считаем ширину фиксированной.
 */
export const NODE_WIDTH = 240;

/** Направляющие выравнивания (KI-189). */
export interface HelperLines {
  vertical?: number;
  horizontal?: number;
}

/**
 * Ищет направляющие по совпадению центров перетаскиваемого узла с соседями.
 *
 * Чистая функция — вынесена из `Canvas`, чтобы покрыть тестами и не зависеть
 * от React Flow.
 *
 * @param dragged - перетаскиваемый узел (позиция + размер)
 * @param others - остальные узлы графа
 * @param tolerance - допуск совпадения центров, px
 * @returns линии (пустой объект — совпадений нет)
 */
export function findGuides(
  dragged: {
    id: string;
    position: { x: number; y: number };
    width?: number;
    height?: number;
  },
  others: ReadonlyArray<{
    id: string;
    position: { x: number; y: number };
    width?: number;
    height?: number;
  }>,
  tolerance: number,
): HelperLines {
  const width = dragged.width ?? NODE_WIDTH;
  const height = dragged.height ?? 0;
  const centerX = dragged.position.x + width / 2;
  const centerY = dragged.position.y + height / 2;
  const result: HelperLines = {};

  for (const other of others) {
    if (other.id === dragged.id) {
      continue;
    }

    const otherWidth = other.width ?? NODE_WIDTH;
    const otherHeight = other.height ?? 0;
    const otherCenterX = other.position.x + otherWidth / 2;
    const otherCenterY = other.position.y + otherHeight / 2;

    if (
      result.vertical === undefined &&
      Math.abs(otherCenterX - centerX) <= tolerance
    ) {
      result.vertical = otherCenterX;
    }

    if (
      result.horizontal === undefined &&
      Math.abs(otherCenterY - centerY) <= tolerance
    ) {
      result.horizontal = otherCenterY;
    }
  }

  return result;
}
