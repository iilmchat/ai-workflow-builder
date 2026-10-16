import { useEffect, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import { useNodeDataHistory } from '@/hooks/use-node-data-history';
import { listWorkflowsAsync, type ApiWorkflow } from '@/lib/api';
import { NODE_REGISTRY } from '@/lib/node-registry';
import {
  hasNewerWorkflowVersion,
  isValidWorkflowId,
  workflowEditorUrl,
} from '@/lib/sub-workflow-fields';
import { useWorkflowStore } from '@/stores/workflow';
import { DATA_TYPE_COLORS, DATA_TYPE_LABELS, type SubWorkflowFlowNode } from '@/types/graph';

/**
 * Кэш списка workflow на время жизни вкладки (R6.7).
 *
 * Список нужен каждому узлу `sub_workflow`, а workflow у пользователя может
 * быть сколько угодно — без кэша каждый новый узел слал бы свой `GET /workflow`
 * (RULES 4.17). Кэш живёт на уровне модуля, потому что listWorkflowsAsync —
 * не store-экшен: держать чужое состояние в Zustand значило бы расширять
 * стор ради одной компоненты.
 *
 * Ограничение (KI-302): кэш не инвалидируется — workflow, созданный в этой же
 * вкладке, появится в селекте только после перезагрузки страницы.
 */
let workflowsCache: ApiWorkflow[] | null = null;

/** Незавершённый запрос списка: параллельные узлы ждут его, а не шлют новый. */
let workflowsRequest: Promise<ApiWorkflow[]> | null = null;

/**
 * Загружает список своих workflow с кэшированием на сессию.
 *
 * @returns список workflow владельца (без учёта `currentWorkflowId`)
 * @throws Error если запрос к backend упал (компонент покажет подсказку)
 */
function loadWorkflowsAsync(): Promise<ApiWorkflow[]> {
  if (workflowsCache !== null) {
    return Promise.resolve(workflowsCache);
  }

  workflowsRequest ??= listWorkflowsAsync()
    .then((list) => {
      workflowsCache = list;

      return list;
    })
    .finally(() => {
      workflowsRequest = null;
    });

  return workflowsRequest;
}

/**
 * Узел под-workflow (R6.7, KI-200, DESIGN v0.8 § 5.4).
 *
 * Один вход `text-input` (порт `prompt`) и один выход `result-output` (порт
 * `result`): результат узла — выходы терминальных узлов подграфа. Селект
 * показывает **свои** workflow (`GET /workflow`); узел выбирает ссылку по
 * `id`, а человеку рядом видно имя подграфа.
 *
 * Кнопка «Открыть в редакторе» ведёт на `/?workflowId=<id>` — тот же параметр,
 * что читает `App` при загрузке (A3), поэтому вкладка открывается на нужном
 * графе. Открытие — в новой вкладке: текущий граф нельзя терять.
 *
 * Warning «есть новая версия» отражает расхождение снимка `data.version`
 * (момент выбора) и `workflow.version` из БД (DESIGN § 5.5).
 */
export function SubWorkflowNode({ id, data }: NodeProps<SubWorkflowFlowNode>) {
  // R6.4b.2b: правки поля проходят через историю графа.
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  // Уровень выполнения появляется после Run (/engine/plan).
  const executionLevel = useWorkflowStore((state) => state.executionLevels[id]);
  // Статус выполнения приходит из SSE-потока (R4.2).
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const removeNode = useWorkflowStore((state) => state.removeNode);
  // Себя из списка исключаем: ссылка workflow на себя — гарантированная
  // «Циклическая ссылка» на запуске (backend-контекст её отвергнет).
  const currentWorkflowId = useWorkflowStore((state) => state.currentWorkflowId);

  const [workflows, setWorkflows] = useState<ApiWorkflow[]>(workflowsCache ?? []);
  const [loadFailed, setLoadFailed] = useState(false);

  // Список грузится при появлении узла и кэшируется на сессию.
  useEffect(() => {
    let cancelled = false;

    void loadWorkflowsAsync()
      .then((list) => {
        if (!cancelled) {
          setWorkflows(list);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(
    () => workflows.filter((workflow) => workflow.id !== currentWorkflowId),
    [workflows, currentWorkflowId],
  );

  const selected = workflows.find((workflow) => workflow.id === data.workflowId);
  const hasSelection = isValidWorkflowId(data.workflowId);
  // Ссылка на workflow, которого нет среди своих (удалён или чужой): значение
  // не подменяем (KI-069), но предупреждаем — Run упадёт 404.
  const isForeign = hasSelection && selected === undefined && !loadFailed;
  const isOutdated =
    selected !== undefined &&
    hasNewerWorkflowVersion(data.version, selected.version);
  const editorUrl = workflowEditorUrl(data.workflowId);

  /**
   * Обновляет ссылку на подграф, снимая версию выбранного workflow.
   *
   * Снимок `version` пишется в момент выбора (DESIGN § 5.5): если подграф потом
   * изменится, узел покажет «есть новая версия». При сбросе выбора снимок
   * сбрасывается явно (`version: undefined`) — иначе узел хранил бы версию
   * прежнего подграфа; в JSON на Save ключ с `undefined` не попадает
   * (`JSON.stringify` его отбрасывает).
   *
   * @param value - id выбранного workflow (`''` — «не выбран»)
   */
  const handleSelect = (value: string): void => {
    const found = workflows.find((workflow) => workflow.id === value);

    updateNodeData(
      id,
      found === undefined
        ? { workflowId: value, version: undefined }
        : { workflowId: found.id, version: found.version },
    );
  };

  return (
    <>
      <Handle
        type="target"
        id="text-input"
        position={Position.Left}
        className="h-2.5! w-2.5! border-2! border-white!"
        style={{ background: DATA_TYPE_COLORS.text }}
      />
      <span
        className="pointer-events-none absolute -left-4 top-1/2 -translate-y-1/2 text-[9px] font-semibold"
        style={{ color: DATA_TYPE_COLORS.text }}
      >
        {DATA_TYPE_LABELS.text}
      </span>

      <BaseNode
        icon={NODE_REGISTRY.sub_workflow.icon}
        title={t(NODE_REGISTRY.sub_workflow.labelKey)}
        executionLevel={executionLevel}
        status={status}
        dataNodeAttr={{ name: 'data-sub-workflow-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <select
          value={data.workflowId}
          aria-label={t('node.sub_workflow.label')}
          data-sub-workflow-select=""
          // nodrag: иначе клик по списку тащит ноду вместо открытия меню.
          className="nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          onChange={(event) => handleSelect(event.target.value)}
        >
          {data.workflowId === '' && (
            <option value="" disabled>
              {options.length === 0
                ? t('node.sub_workflow.select.none')
                : t('node.sub_workflow.placeholder')}
            </option>
          )}

          {hasSelection && selected === undefined && (
            <option value={data.workflowId} disabled>
              {t('node.sub_workflow.owner_error')}
            </option>
          )}

          {options.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.name}
            </option>
          ))}
        </select>

        {/* Превью имени подграфа: в селекте видно имя, но при выбранном
            значении его легко «потерять» среди длинных названий. */}
        {selected !== undefined && (
          <p
            className="mt-1 truncate text-[10px] text-muted-foreground"
            title={selected.name}
            data-sub-workflow-name=""
          >
            {selected.name}
          </p>
        )}

        {isOutdated && (
          <p className="mt-1 text-[10px] font-medium text-amber-600" data-sub-workflow-outdated="">
            {t('node.sub_workflow.outdated', { version: selected?.version })}
          </p>
        )}

        {isForeign && (
          <p className="mt-1 text-[10px] font-medium text-red-600" data-sub-workflow-foreign="">
            {t('node.sub_workflow.owner_error')}
          </p>
        )}

        {loadFailed && (
          <p className="mt-1 text-[10px] text-red-600" data-sub-workflow-load-error="">
            {t('node.sub_workflow.load_error')}
          </p>
        )}

        {editorUrl !== null && (
          <button
            type="button"
            // noopener: открытая вкладка не должна получать доступ к window
            // редактора (RULES 5.1).
            onClick={() => window.open(editorUrl, '_blank', 'noopener')}
            data-sub-workflow-open=""
            className="nodrag mt-2 w-full cursor-pointer rounded-lg border border-border bg-muted px-2 py-1.5 text-[10px] font-medium text-muted-foreground hover:bg-background hover:text-foreground"
          >
            {t('node.sub_workflow.open')}
          </button>
        )}
      </BaseNode>

      <Handle
        type="source"
        id="result-output"
        position={Position.Right}
        className="h-2.5! w-2.5! border-2! border-white!"
        style={{ background: DATA_TYPE_COLORS.text }}
      />
      <span
        className="pointer-events-none absolute -right-4 top-1/2 -translate-y-1/2 text-[9px] font-semibold"
        style={{ color: DATA_TYPE_COLORS.text }}
      >
        {DATA_TYPE_LABELS.text}
      </span>
    </>
  );
}
