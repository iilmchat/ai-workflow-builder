/**
 * Чистые исполнители узлов: преобразование `data` → outputs без DI и сети.
 *
 * `llm` здесь больше нет — с R3 узел ходит во внешний провайдер, поэтому живёт
 * в `src/llm/llm-node-executor.service.ts` (DI + `LlmService`). Здесь остаются
 * только синхронные преобразования и заглушка `image_generation` (R4).
 */
import type { NodeDto } from './dto/index.js';

/**
 * Исполнитель узла типа `text`: отдаёт значение из `data.value` как есть.
 *
 * @param node - узел графа типа `text`
 * @returns выходной порт `text` (пустая строка, если значение не строка)
 */
export function executeTextNode(node: NodeDto): Record<string, unknown> {
  const value = typeof node.data.value === 'string' ? node.data.value : '';

  return { text: value };
}

/**
 * ЗАГЛУШКА исполнителя узла типа `image_generation`.
 *
 * Реальный вызов провайдера генерации изображений появится в R4.
 *
 * @param _node - узел графа типа `image_generation` (в заглушке не используется)
 * @returns выходной порт `url` со значением `null`
 */
export function executeImageGenNodeStub(_node: NodeDto): Record<string, unknown> {
  return { url: null };
}

/**
 * Типы узлов-аннотаций (комментарии/стикеры, KI-266).
 *
 * Не участвуют в потоке выполнения: не попадают в executionMap/levels,
 * не создают node_runs. Хранятся в графе (workflows.nodes jsonb),
 * переносятся между Save/Load — но игнорируются при Run.
 */
export const ANNOTATION_NODE_TYPES: ReadonlySet<string> = new Set(['comment']);

/**
 * Ошибка: тип узла не поддерживается executor'ом.
 *
 * Наследуется от `Error`, а не от Nest `HttpException`: исключение живёт в
 * контексте worker'а, а не HTTP-запроса, и должно приводить к `run.status='failed'`.
 */
export class UnsupportedNodeTypeException extends Error {
  /**
   * @param nodeType - неизвестный тип узла из графа
   */
  constructor(nodeType: string) {
    super(`Неподдерживаемый тип узла: ${nodeType}`);
    this.name = 'UnsupportedNodeTypeException';
  }
}
