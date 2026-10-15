import type { Edge } from '@xyflow/react';
import type { AppNode, NodeType } from '@/types/graph';

/**
 * Типы узлов, которые **не отправляются** на backend (KI-187).
 *
 * С KI-266 множество **пусто**: backend научился игнорировать аннотации
 * (`ANNOTATION_NODE_TYPES` в `src/engine/node-executors.ts`) — `comment` не
 * попадает в план выполнения, поэтому `UnsupportedNodeTypeException` в
 * `runNodeAsync` больше не срабатывает, а стикеры переносятся между Save/Load
 * как обычные узлы графа (`workflows.nodes` jsonb).
 *
 * Историческая защита: раньше здесь лежал `comment`, и узлы этого типа
 * отсекались на границе API (Save и `/engine/plan`) — из-за этого заметки
 * терялись после перезагрузки страницы. Точка расширения оставлена на случай
 * нового чисто-UI типа, который backend не должен видеть вовсе.
 *
 * `Set`, а не массив: проверка идёт для каждого узла на каждом Save/Plan.
 */
export const LOCAL_ONLY_NODE_TYPES: ReadonlySet<string> = new Set<NodeType>();

/**
 * Оставляет только узлы, которые backend умеет принимать.
 *
 * Сейчас фильтр пуст (KI-266), поэтому функция возвращает узлы как есть —
 * включая комментарии. Порядок сохраняется.
 *
 * @param nodes - узлы графа из редактора
 * @returns узлы без local-only типов
 */
export function toBackendNodes(nodes: readonly AppNode[]): AppNode[] {
  return nodes.filter((node) => !isLocalOnlyNode(node));
}

/**
 * Проверяет, что узел не отправляется на backend.
 *
 * @param node - узел графа
 * @returns `true`, если тип узла в {@link LOCAL_ONLY_NODE_TYPES}
 */
function isLocalOnlyNode(node: AppNode): boolean {
  return node.type !== undefined && LOCAL_ONLY_NODE_TYPES.has(node.type);
}

/**
 * Оставляет связи, у которых оба конца есть среди отправляемых узлов.
 *
 * С KI-266 фильтр пуст, поэтому связи с комментариями уходят на backend
 * вместе с узлами. Отсев связей с узлами, которых нет в payload, остаётся
 * страховкой: «битая» связь (её конец отфильтрован или удалён) — это ошибка
 * валидации графа на backend (`Связь X ссылается на несуществующий
 * source/target`), то есть 400 на Save/Plan.
 *
 * @param edges - связи графа из редактора
 * @param backendNodes - узлы, уже прошедшие {@link toBackendNodes}
 * @returns связи, оба конца которых остались в payload
 */
export function toBackendEdges(
  edges: readonly Edge[],
  backendNodes: readonly AppNode[],
): Edge[] {
  const ids = new Set(backendNodes.map((node) => node.id));

  return edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
}

/**
 * Проверяет, что тип узла отсекается на границе с backend.
 *
 * @param type - значение `node.type` из API
 * @returns `true`, если тип входит в {@link LOCAL_ONLY_NODE_TYPES}; сейчас —
 *   всегда `false` (KI-266)
 */
export function isLocalOnlyNodeType(type: string): boolean {
  return LOCAL_ONLY_NODE_TYPES.has(type);
}
