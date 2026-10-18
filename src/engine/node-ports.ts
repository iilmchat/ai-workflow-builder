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
  // R7.2 (KI-361): media-генерация video/audio/music. Выход — тот же
  // `mediaUrl`, что у `image_generation` (исполнитель пишет именно его), иначе
  // зависимый узел читал бы `null` — ровно та ловушка, что закрыта KI-368.
  // Вход — текстовый (`prompt`): промпт приходит от Text/LLM, а картинка для
  // image-to-video задаётся полем узла `data.imageUrl` (у узла один входной
  // хендл: с двумя React Flow свернул бы обе связи в один ключ, KI-035).
  // Выходные хендлы названы по типу (`video-output`/`audio-output`/
  // `music-output`): контракт разрешается type-aware (KI-301), а читаемость
  // сохранена — в графе видно, какой поток несёт файл.
  video_generation: {
    sourceHandleId: 'video-output',
    outputPortName: 'mediaUrl',
    targetHandleId: 'text-input',
    inputPortName: 'prompt',
  },
  audio_generation: {
    sourceHandleId: 'audio-output',
    outputPortName: 'mediaUrl',
    targetHandleId: 'text-input',
    inputPortName: 'prompt',
  },
  music_generation: {
    sourceHandleId: 'music-output',
    outputPortName: 'mediaUrl',
    targetHandleId: 'text-input',
    inputPortName: 'prompt',
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
  // R7.4a (KI-128, DESIGN v0.9 § 3.4): vector/memory-узлы.
  //
  // Вход у всех четырёх — текстовый порт `prompt` (content/query приходят от
  // Text/LLM). Выход — `result`: у `vector_query` это массив совпадений, у
  // `memory_read` — сохранённое значение, у upsert/write — подтверждение
  // записи. Хендлы названы по семействам (`vector-output` / `memory-output`):
  // разрешение type-aware (KI-301), поэтому одинаковый id у двух типов одного
  // семейства не подменяет порт чужого узла, а в графе видно, какой поток
  // несёт результат.
  vector_upsert: {
    sourceHandleId: 'vector-output',
    outputPortName: 'result',
    targetHandleId: 'text-input',
    inputPortName: 'prompt',
  },
  vector_query: {
    sourceHandleId: 'vector-output',
    outputPortName: 'result',
    targetHandleId: 'text-input',
    inputPortName: 'prompt',
  },
  memory_read: {
    sourceHandleId: 'memory-output',
    outputPortName: 'result',
    targetHandleId: 'text-input',
    inputPortName: 'prompt',
  },
  memory_write: {
    sourceHandleId: 'memory-output',
    outputPortName: 'result',
    targetHandleId: 'text-input',
    inputPortName: 'prompt',
  },
  // R7.4b (DESIGN v0.9 § 3.4): узел `agent`. Вход — текст задачи (`prompt`),
  // выход — финальный ответ агента (`result`). Выходной хендл — `result-output`
  // (как у `sub_workflow`): `text-output` переводится в порт `text` (KI-301) и
  // не подошёл бы узлу, который пишет `outputs.result`.
  agent: {
    sourceHandleId: 'result-output',
    outputPortName: 'result',
    targetHandleId: 'text-input',
    inputPortName: 'prompt',
  },
  // v0.10 S2 (DESIGN v0.10 § 3.1.3): узел `web_search`. Вход — запрос
  // (`prompt`), выход — готовый текст для LLM (`text`, нумерованный список
  // источников). Source-хендл назван `search-output`, чтобы не переиспользовать
  // `text-output`: type-aware резолвер (KI-301) отдал бы по нему `text` только
  // при точном совпадении контракта, а отдельное имя делает поток в графе
  // читаемым.
  web_search: {
    sourceHandleId: 'search-output',
    outputPortName: 'text',
    targetHandleId: 'text-input',
    inputPortName: 'prompt',
  },
  // v0.10 S6 (DESIGN v0.10 § 3.2.5): узел `document_gen`. Вход — `prompt`
  // (Markdown/JSON от Text/LLM), выход — `fileUrl` (ссылка на сохранённый
  // DOCX). Имя выходного порта совпадает с ключом в `outputs` исполнителя:
  // с `text-output`/`result` зависимый `output`/`http` прочитал бы `null`
  // (ловушка KI-301/KI-460).
  document_gen: {
    sourceHandleId: 'document-output',
    outputPortName: 'fileUrl',
    targetHandleId: 'text-input',
    inputPortName: 'prompt',
  },
  // v0.10 S8 (DESIGN v0.10 § 3.3.4, KI-456): узел `read_file` — source-only.
  // Входного хендла нет вовсе: путь читается только из `data.path`, а связь
  // дала бы LLM возможность подменить путь (prompt injection / traversal).
  // Контракт всё же объявлен — ради выходного порта `text` и type-aware
  // резолвера (KI-301); `canBeInsertedOnEdge` в реестре выставлен в `false`.
  read_file: {
    sourceHandleId: 'file-output',
    outputPortName: 'text',
    targetHandleId: 'text-input',
    inputPortName: 'prompt',
  },
  // v0.10 S8 (DESIGN v0.10 § 3.3.4): узел `write_file`. Вход — текст для
  // записи (`text` приходит от Text/LLM), выход — `result` — подтверждение
  // записи `{ success, path }`. Отдельный source-хендл `file-output` не даёт
  // спутать этот поток с `text-output`/`result-output` других узлов.
  write_file: {
    sourceHandleId: 'file-output',
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
