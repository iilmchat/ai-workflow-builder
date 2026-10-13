/**
 * Реестр портов узлов: единый контракт между React Flow handle id и именами
 * портов, под которыми выходы узла лежат в `node_runs.outputs`.
 *
 * Зачем нужен (история двух KI):
 * - KI-022: если у связи не задан `sourceHandle`, порт нужно вывести из типа
 *   узла-источника, а не подставлять несуществующий `output`;
 * - KI-030: UI присылает `sourceHandle` с id хендла React Flow
 *   (`text-output`, `image-output`), а исполнители пишут outputs под именами
 *   `text`/`url`. Без перевода данных молча терялись (`null`).
 *
 * Держится отдельно от `node-executors.ts`, чтобы планировщик
 * (`EngineService`) не зависел от реализаций исполнителей.
 */

/** Контракт портов узла: id хендлов React Flow + имена портов в node_runs. */
export interface NodePortContract {
  /** id source-хендла во frontend (React Flow `edge.sourceHandle`). */
  sourceHandleId: string;
  /** Имя выходного порта в `node_runs.outputs`. */
  outputPortName: string;
  /** id target-хендла во frontend (React Flow `edge.targetHandle`). */
  targetHandleId: string;
}

/** Контракт портов по типу узла. */
export const NODE_PORT_CONTRACT: Record<string, NodePortContract> = {
  text: {
    sourceHandleId: 'text-output',
    outputPortName: 'text',
    targetHandleId: 'text-input',
  },
  llm: {
    sourceHandleId: 'text-output',
    outputPortName: 'text',
    targetHandleId: 'text-input',
  },
  image_generation: {
    sourceHandleId: 'image-output',
    outputPortName: 'url',
    targetHandleId: 'text-input',
  },
};

/**
 * Карта: тип узла → имя выходного порта по умолчанию.
 *
 * Выводится из {@link NODE_PORT_CONTRACT}, чтобы реестр и карта дефолтов
 * не разъезжались (именно рассинхрон имён и породил KI-022/KI-030).
 */
export const DEFAULT_OUTPUT_PORT_BY_NODE_TYPE: Record<string, string> =
  Object.fromEntries(
    Object.entries(NODE_PORT_CONTRACT).map(([nodeType, contract]) => [
      nodeType,
      contract.outputPortName,
    ]),
  );

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

/**
 * Переводит id хендла React Flow (`edge.sourceHandle`) в имя выходного порта.
 *
 * @param handleId - `edge.sourceHandle` из React Flow (может быть null/undefined)
 * @returns имя порта (`text-output` → `text`, `image-output` → `url`) либо
 *   `null`, если handle id не задан или неизвестен (тогда вызывающий код
 *   использует {@link inferDefaultOutputPort})
 */
export function handleIdToOutputPort(
  handleId: string | null | undefined,
): string | null {
  if (!handleId) {
    return null;
  }

  for (const contract of Object.values(NODE_PORT_CONTRACT)) {
    if (contract.sourceHandleId === handleId) {
      return contract.outputPortName;
    }
  }

  return null;
}
