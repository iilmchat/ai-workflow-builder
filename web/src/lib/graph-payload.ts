import type { Edge } from '@xyflow/react';
import type { AppNode, NodeType } from '@/types/graph';

/**
 * Типы узлов, которые **не отправляются** на backend (KI-187).
 *
 * `comment` — чистый UI-стикер: backend-движок знает только `text`, `llm` и
 * `image_generation`, а `ExecutionEngineService.runNodeAsync` на любой
 * незнакомый тип бросает `UnsupportedNodeTypeException` — то есть комментарий
 * в графе уронил бы весь запуск. Поэтому узлы этого типа отсекаются на границе
 * с API (Save и `/engine/plan`).
 *
 * Следствие: комментарии живут **только в текущей сессии редактора** — backend
 * их не хранит, и после перезагрузки страницы они не восстанавливаются.
 * Запись в реестре KI — в отчёте R6.4b.2a.
 *
 * `Set`, а не массив: проверка идёт для каждого узла на каждом Save/Plan.
 */
export const LOCAL_ONLY_NODE_TYPES: ReadonlySet<string> = new Set<NodeType>([
  'comment',
]);

/**
 * Оставляет только узлы, которые backend умеет принимать.
 *
 * @param nodes - узлы графа из редактора
 * @returns узлы без local-only типов (порядок сохраняется)
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
 * Связь с отфильтрованным комментарием стала бы «битой» на backend: движок
 * добавляет ошибку `Связь X ссылается на несуществующий source/target`, и
 * сохранение/план падали бы с 400. У комментария портов нет, поэтому на
 * практике таких связей быть не должно — проверка страхует от регрессии.
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
 * Отделяет узлы, которые не уходят на backend, от «настоящих» неизвестных.
 *
 * Нужен при загрузке графа: тип, которого нет в реестре, — это потеря данных
 * (пользователь должен увидеть предупреждение, KI-121), а local-only тип
 * отбрасывается осознанно и молча.
 *
 * @param type - значение `node.type` из API (узел не прошёл `isNodeType`)
 * @returns `true`, если тип просто не поддерживается backend
 */
export function isLocalOnlyNodeType(type: string): boolean {
  return LOCAL_ONLY_NODE_TYPES.has(type);
}
