import type { AppNode } from '@/types/graph';
import { NODE_WIDTH } from './graph-guides';

/** Смещение копии узла при дублировании (KI-191). */
export const DUPLICATE_OFFSET = 30;

/**
 * Зазор между вставленным узлом и линией связи (KI-263), px.
 *
 * Складывается с половиной габарита нового узла: именно на столько его центр
 * уходит в сторону от середины связи, чтобы карточка не легла поверх соседей.
 */
export const INSERT_PERPENDICULAR_GAP = 40;

/**
 * Порог «тесной» раскладки (KI-263), px.
 *
 * Если центры источника и приёмника ближе этого расстояния, карточка нового
 * узла физически не помещается между ними (ширина карточки — 240 px, а шаг
 * раскладки Toolbar — 280 px). В таком случае вставка сдвигается
 * перпендикулярно связи; на просторной раскладке узел остаётся на её центре.
 */
export const TIGHT_EDGE_DISTANCE = 300;

/**
 * Ширина узла по умолчанию, px (KI-260).
 *
 * Берётся из `graph-guides`, где та же константа задаёт fallback для
 * направляющих: ширина карточки (`w-60` = 240 px) должна совпадать в обоих
 * расчётах.
 */
export const NODE_DEFAULT_WIDTH = NODE_WIDTH;

/**
 * Высота узла по умолчанию, px (KI-260).
 *
 * Приблизительная: точный размер React Flow знает только после первого рендера
 * (`node.measured`), а позицию вставляемого узла нужно вычислить до него.
 * Поэтому для уже существующего узла того же типа стор подставляет его
 * `measured.height`, а это значение — только запасной вариант.
 */
export const NODE_DEFAULT_HEIGHT = 100;

/** Размер узла в потоке, px. */
export interface NodeSize {
  readonly width: number;
  readonly height: number;
}

/** Узел для расчёта позиции: левый верхний угол + известный размер. */
export interface NodeAnchor {
  readonly position: { x: number; y: number };
  readonly width?: number;
  readonly height?: number;
}

/**
 * Позиция нового узла по центру связи (KI-260) со сдвигом в тесной раскладке
 * (KI-263).
 *
 * Середина связи считается по граням портов: по X — между правой гранью
 * источника и левой гранью приёмника (связи в редакторе идут слева направо),
 * по Y — между вертикальными центрами узлов. Новый узел ставится так, чтобы
 * его центр совпал с этой точкой.
 *
 * Если центры источника и приёмника ближе {@link TIGHT_EDGE_DISTANCE}, карточка
 * (240 px) не помещается в зазор между ними и накрыла бы соседей. Тогда центр
 * сдвигается перпендикулярно связи: для горизонтальной — вниз по Y, для
 * вертикальной — вправо по X. Величина сдвига — половина габарита нового узла
 * плюс {@link INSERT_PERPENDICULAR_GAP}; направление всегда положительное,
 * чтобы узел не уезжал в отрицательные координаты холста.
 *
 * Прежний расчёт использовал среднее `top-left` углов источника и приёмника,
 * поэтому узел «съезжал» вправо-вниз от линии связи и накрывал соседей.
 *
 * @param source - узел-источник связи
 * @param target - узел-приёмник связи
 * @param size - ожидаемый размер вставляемого узла (по умолчанию 240×100)
 * @returns позиция левого верхнего угла вставляемого узла
 */
export function insertPositionOnEdge(
  source: NodeAnchor,
  target: NodeAnchor,
  size: NodeSize = { width: NODE_DEFAULT_WIDTH, height: NODE_DEFAULT_HEIGHT },
): { x: number; y: number } {
  const sourceWidth = source.width ?? NODE_DEFAULT_WIDTH;
  const sourceHeight = source.height ?? NODE_DEFAULT_HEIGHT;
  const targetWidth = target.width ?? NODE_DEFAULT_WIDTH;
  const targetHeight = target.height ?? NODE_DEFAULT_HEIGHT;

  const centerX =
    (source.position.x + sourceWidth + target.position.x) / 2;
  const centerY =
    (source.position.y +
      sourceHeight / 2 +
      target.position.y +
      targetHeight / 2) /
    2;

  // Вектор между центрами узлов задаёт ориентацию связи и её длину. Считаем по
  // центрам, а не по граням портов: сдвигать нужно относительно карточек,
  // которые могут быть разной ширины.
  const deltaX =
    target.position.x + targetWidth / 2 - (source.position.x + sourceWidth / 2);
  const deltaY =
    target.position.y +
    targetHeight / 2 -
    (source.position.y + sourceHeight / 2);

  let offsetX = 0;
  let offsetY = 0;

  if (Math.hypot(deltaX, deltaY) < TIGHT_EDGE_DISTANCE) {
    if (Math.abs(deltaX) >= Math.abs(deltaY)) {
      // Горизонтальная связь: уходим вниз, под линию.
      offsetY = size.height / 2 + INSERT_PERPENDICULAR_GAP;
    } else {
      // Вертикальная связь: уходим вправо, в сторону от линии.
      offsetX = size.width / 2 + INSERT_PERPENDICULAR_GAP;
    }
  }

  return {
    x: centerX - size.width / 2 + offsetX,
    y: centerY - size.height / 2 + offsetY,
  };
}

/**
 * Готовит копии узлов для дублирования (KI-191).
 *
 * Логика вынесена из стора в чистую функцию: так её можно покрыть тестами без
 * поднятия zustand-стора. Связи не копируются — это осознанное решение
 * (DESIGN v0.8 § 7): дубликат узла без рёбер не создаёт «двойной» поток.
 *
 * @param nodes - все узлы графа
 * @param ids - id узлов, которые нужно скопировать
 * @param makeId - генератор новых id (в сторе — `crypto.randomUUID`)
 * @param offset - смещение копии по X и Y
 * @returns копии узлов в порядке исходного массива
 */
export function cloneNodesForDuplicate(
  nodes: readonly AppNode[],
  ids: readonly string[],
  makeId: () => string,
  offset: number = DUPLICATE_OFFSET,
): AppNode[] {
  const wanted = new Set(ids);

  return nodes
    .filter((node) => wanted.has(node.id))
    .map(
      (node) =>
        ({
          ...node,
          id: `${node.type ?? 'node'}-${makeId()}`,
          position: {
            x: node.position.x + offset,
            y: node.position.y + offset,
          },
          // Данные копируем глубоко: иначе правка копии меняла бы оригинал.
          data: structuredClone(node.data),
          selected: true,
        }) as AppNode,
    );
}
