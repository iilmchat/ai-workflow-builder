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
 * - KI-301: поиск хендла по всем контрактам подряд подставлял порт чужого типа
 *   (`text-output` у `image_generation` → `text`), поэтому резолвер стал
 *   type-aware: `handleIdToOutputPort(handleId, sourceNodeType)`.
 *
 * Держится отдельно от `node-executors.ts`, чтобы планировщик
 * (`EngineService`) не зависел от реализаций исполнителей: из
 * `node-executors.ts` он берёт только метаданные `ANNOTATION_NODE_TYPES`
 * (KI-266), а не сами `execute*Node`.
 */

/**
 * Тип узла графа.
 *
 * `NodeSchema.type` (`./dto/graph.dto.js`) — свободная строка: граф приходит из
 * внешнего источника (RULES 1.17) и может содержать тип, которого движок не
 * знает. Такой узел должен падать на выполнении понятной ошибкой
 * (`UnsupportedNodeTypeException`), а не отказывать в валидации всего графа,
 * поэтому псевдоним не сужается до перечисления известных типов: «известность»
 * проверяется по {@link NODE_PORT_CONTRACT} в месте использования.
 */
export type NodeType = string;

/** Контракт портов узла: id хендлов React Flow + имена портов в node_runs. */
export interface NodePortContract {
  /** id source-хендла во frontend (React Flow `edge.sourceHandle`). */
  sourceHandleId: string;
  /** Имя выходного порта в `node_runs.outputs`. */
  outputPortName: string;
  /** id target-хендла во frontend (React Flow `edge.targetHandle`). */
  targetHandleId: string;
  /**
   * Имя входного порта узла в `executionMap.inputs` / `node_runs.inputs`.
   *
   * Нормализованное имя вместо UI-id хендла (KI-034): исполнителю узла нужно
   * читать вход по контракту (`inputs.prompt`), а не угадывать ключ
   * (`text-input`). У `text`-узла входа нет — значение-заглушка.
   */
  inputPortName: string;
}

/** Контракт портов по типу узла. */
export const NODE_PORT_CONTRACT: Record<string, NodePortContract> = {
  text: {
    sourceHandleId: 'text-output',
    outputPortName: 'text',
    targetHandleId: 'text-input',
    inputPortName: 'text',
  },
  llm: {
    sourceHandleId: 'text-output',
    outputPortName: 'text',
    targetHandleId: 'text-input',
    inputPortName: 'prompt',
  },
  // R7.1: порт `url` не совпадал с реальным ключом выходов
  // `image_generation` — исполнитель пишет `mediaUrl` (`MediaNodeExecutor`),
  // а контракт объявлял `url`. Пока изображение никуда не шло, расхождение не
  // проявлялось; узел `image_tool` вскрыл его: зависимый узел читал `null` и
  // падал с «Не задан входной файл». Порт приведён к фактическому ключу, а
  // `ImageGenNode` и `MediaNodeOutputsSchema` и так читают `mediaUrl`.
  image_generation: {
    sourceHandleId: 'image-output',
    outputPortName: 'mediaUrl',
    targetHandleId: 'text-input',
    inputPortName: 'prompt',
  },
  // R7.1 (KI-196): узел media-инструмента. Вход — **файл**, а не промпт,
  // поэтому нормализованное имя входа `url` (источник — `image_generation`,
  // который отдаёт порт `mediaUrl`). Выход — порт `resultUrls` (массив ссылок,
  // DESIGN v0.9 § 3.1): имя совпадает с ключом в `outputs`, иначе зависимый
  // узел прочитал бы `null` (та же ловушка, что в KI-301).
  image_tool: {
    sourceHandleId: 'image-output',
    outputPortName: 'resultUrls',
    targetHandleId: 'image-input',
    inputPortName: 'url',
  },
  // R6.5.1 (KI-105). У `http` вход — фолбэк для URL, поэтому нормализованное имя
  // совпадает с тем, что читает исполнитель (`inputs.prompt`).
  http: {
    sourceHandleId: 'http-output',
    outputPortName: 'result',
    targetHandleId: 'text-input',
    inputPortName: 'prompt',
  },
  // Условие читает `inputs.input` (см. `executeConditionNode`), ветки true/false
  // пока получают один и тот же результат — маршрутизация в v0.8.x.
  condition: {
    sourceHandleId: 'condition-output',
    outputPortName: 'result',
    targetHandleId: 'condition-input',
    inputPortName: 'input',
  },
  // Терминальный узел: вход — то, что попадёт в `outputs[data.name]`.
  output: {
    sourceHandleId: 'output-output',
    outputPortName: 'result',
    targetHandleId: 'text-input',
    inputPortName: 'prompt',
  },
  // R6.7 (KI-200). Входной хендл — `text-input` (порт `prompt`: то, что
  // приходит в подграф как основной вход). Выходной — **`result-output`**, а не
  // `text-output`: `handleIdToOutputPort` выбирает порт по id хендла и не знает
  // тип узла-источника, а `text-output` уже занят `text`/`llm` и переводится в
  // порт `text`. С `text-output` результат подграфа (`outputs.result`) не
  // доехал бы до зависимого узла — он прочитал бы `outputs.text` и получил
  // `null` (KI-301).
  sub_workflow: {
    sourceHandleId: 'result-output',
    outputPortName: 'result',
    targetHandleId: 'text-input',
    inputPortName: 'prompt',
  },
  // `compare` сознательно БЕЗ контракта: `NodePortContract` описывает один
  // вход, а узлу нужны два (`a` и `b`). С контрактом обе связи свернулись бы
  // в один ключ (KI-035) и второй операнд потерялся бы. Без контракта работает
  // fallback `targetHandle → sourceHandle → edge.id`, то есть `inputs.a` и
  // `inputs.b` — ровно то, что читает `executeCompareNode`.
  // Per-handle контракт (именованные входы/выходы) — KI-278; отсутствие
  // типизированного контракта у `compare` — KI-279.
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
 * Возвращает имя входного порта узла по его типу.
 *
 * @param nodeType - тип узла-получателя
 * @returns нормализованное имя входного порта (`prompt` для
 *   `llm`/`image_generation`, `text` для `text`); для неизвестного типа —
 *   `input` (fallback, если контракта нет)
 */
export function inferInputPortName(nodeType: string): string {
  return NODE_PORT_CONTRACT[nodeType]?.inputPortName ?? 'input';
}

/**
 * Переводит id хендла React Flow (`edge.sourceHandle`) в имя выходного порта.
 *
 * Разрешение type-aware (KI-301): при заданном `sourceNodeType` хендл сверяется
 * с контрактом **именно этого типа**. До KI-301 поиск шёл по всем контрактам
 * сразу, поэтому чужой хендл давал порт другого узла: `image_generation` с
 * `sourceHandle='text-output'` получал `fromPort='text'`, хотя отдаёт только
 * `url` — зависимый узел молча читал `null`.
 *
 * Если для типа контракта нет (`compare`, `task`, произвольный тип от API),
 * сохраняется прежнее поведение — поиск по всем контрактам (fallback KI-030).
 *
 * @param handleId - `edge.sourceHandle` из React Flow (может быть null/undefined)
 * @param sourceNodeType - тип узла-источника связи; без него работает
 *   нетипизированный поиск по всем контрактам (fallback)
 * @returns имя порта (`text-output` → `text`, `image-output` → `url`) либо
 *   `null`, если handle id не задан, не подходит типу источника или неизвестен
 *   (тогда вызывающий код использует {@link inferDefaultOutputPort})
 */
export function handleIdToOutputPort(
  handleId: string | null | undefined,
  sourceNodeType?: NodeType,
): string | null {
  if (!handleId) {
    return null;
  }

  // KI-301: для известного типа сверяем хендл с его контрактом и не даём
  // подставить порт чужого типа. Для типа без контракта — уходим в fallback.
  if (sourceNodeType !== undefined) {
    const ownContract = NODE_PORT_CONTRACT[sourceNodeType];

    if (ownContract) {
      return ownContract.sourceHandleId === handleId
        ? ownContract.outputPortName
        : null;
    }
  }

  for (const contract of Object.values(NODE_PORT_CONTRACT)) {
    if (contract.sourceHandleId === handleId) {
      return contract.outputPortName;
    }
  }

  return null;
}
