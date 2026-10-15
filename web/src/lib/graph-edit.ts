import type { AppNode } from '@/types/graph';

/** Смещение копии узла при дублировании (KI-191). */
export const DUPLICATE_OFFSET = 30;

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
