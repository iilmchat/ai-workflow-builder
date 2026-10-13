/**
 * Реестр портов узлов: какой выходной порт отдаёт узел каждого типа.
 *
 * Нужен при построении плана выполнения: если у связи не задан `sourceHandle`,
 * имя выходного порта выводится из типа узла-источника. До этого в
 * `executionMap` всегда попадал порт `output`, которого нет ни у одного
 * исполнителя, и данные молча превращались в `null` (KI-022).
 *
 * Держится отдельно от `node-executors.ts`, чтобы планировщик
 * (`EngineService`) не зависел от реализаций исполнителей.
 */

/** Карта: тип узла → имя выходного порта по умолчанию. */
export const DEFAULT_OUTPUT_PORT_BY_NODE_TYPE: Record<string, string> = {
  text: 'text',
  llm: 'text',
  image_generation: 'url',
};

/**
 * Возвращает имя выходного порта узла по умолчанию.
 *
 * @param nodeType - тип узла из графа
 * @returns имя порта; для неизвестного типа — `output` (fallback сохраняет
 *   прежнее поведение и виден в ошибках выполнения)
 */
export function inferDefaultOutputPort(nodeType: string): string {
  return DEFAULT_OUTPUT_PORT_BY_NODE_TYPE[nodeType] ?? 'output';
}
