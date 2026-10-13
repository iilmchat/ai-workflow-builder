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
 * ЗАГЛУШКА исполнителя узла типа `llm`.
 *
 * Реальный вызов LLM-провайдера появится в R3; сейчас узел отдаёт маркер,
 * чтобы сквозной прогон графа был проверяем.
 *
 * @param _node - узел графа типа `llm` (в заглушке не используется)
 * @returns выходной порт `text` с маркером заглушки
 */
export function executeLlmNodeStub(_node: NodeDto): Record<string, unknown> {
  return { text: '[LLM stub — R3]' };
}

/**
 * ЗАГЛУШКА исполнителя узла типа `image_generation`.
 *
 * Реальный вызов провайдера генерации изображений появится в R3/R4.
 *
 * @param _node - узел графа типа `image_generation` (в заглушке не используется)
 * @returns выходной порт `url` со значением `null`
 */
export function executeImageGenNodeStub(_node: NodeDto): Record<string, unknown> {
  return { url: null };
}

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
