import { useCallback, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import { useAutoResize } from '@/hooks/use-auto-resize';
import { useNodeDataHistory } from '@/hooks/use-node-data-history';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import {
  HTTP_METHODS,
  HTTP_METHODS_WITH_BODY,
  HTTP_TIMEOUT_LIMIT,
  isValidHttpUrl,
  validateHttpMethod,
  validateTimeoutMs,
} from '@/lib/http-node-fields';
import { NODE_REGISTRY } from '@/lib/node-registry';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  type HttpFlowNode,
} from '@/types/graph';

/** Классы поля ввода узла: рамка меняется на красную при ошибке. */
const FIELD_CLASS =
  'nodrag w-full rounded-lg border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary';

/**
 * Узел HTTP-запроса (R6.5.2, DESIGN v0.8 § 8.1).
 *
 * Порты — из backend-контракта `src/engine/node-ports.ts` (R6.5.1): вход
 * `text-input` (порт `prompt` — URL-фолбэк, если поле пустое) и выход
 * `http-output` (порт `result`). Идентификаторы хендлов нельзя менять
 * произвольно: по `edge.sourceHandle` движок вычисляет имя порта, из которого
 * зависимые узлы читают выход (`handleIdToOutputPort`).
 *
 * Тело запроса показывается только для методов с телом (`POST`/`PUT`/`DELETE`)
 * и по умолчанию свёрнуто — как system prompt у LLM-узла (R6.3.2). При смене
 * метода на `GET` уже введённое тело не удаляется: `fetch` его игнорирует, а
 * возврат к `POST` не должен терять текст (KI-129: поле не чистим молча).
 */
export function HttpNode({ id, data }: NodeProps<HttpFlowNode>) {
  // R6.4b.2b: правки полей узла проходят через историю графа (склейка текста
  // по времени, селект — отдельным шагом).
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  // Статус выполнения приходит из SSE-потока (R4.2).
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const removeNode = useWorkflowStore((state) => state.removeNode);

  // KI-157: URL пишется в стор на каждый символ — сохраняем позицию курсора.
  const handleUrlChange = usePreserveCursor<HTMLInputElement>(
    useCallback((value: string) => updateNodeData(id, { url: value }), [id, updateNodeData]),
  );

  // KI-157: тело запроса — та же проблема, но у `<textarea>`.
  const handleBodyChange = usePreserveCursor<HTMLTextAreaElement>(
    useCallback((value: string) => updateNodeData(id, { body: value }), [id, updateNodeData]),
  );

  // KI-169: поле растёт по тексту (до 200px) вместо прокрутки вслепую.
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useAutoResize(bodyRef, data.body ?? '');

  // Тело показываем только там, где оно имеет смысл (GET его отбрасывает).
  const hasBody = HTTP_METHODS_WITH_BODY.includes(data.method);
  // Свёрнуто по умолчанию, но у загруженного workflow тело уже есть — тогда
  // сразу раскрыто (иначе правка выглядела бы потерянной).
  const [isBodyOpen, setIsBodyOpen] = useState((data.body ?? '').length > 0);

  // Пустое поле — валидное состояние (URL придёт из входа `prompt`), поэтому
  // подсвечиваем только непустой и при этом неразбираемый адрес.
  const isUrlInvalid = data.url.trim() !== '' && !isValidHttpUrl(data.url);

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
        icon={NODE_REGISTRY.http.icon}
        title={t(NODE_REGISTRY.http.labelKey)}
        status={status}
        dataNodeAttr={{ name: 'data-http-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <div className="flex gap-1.5">
          <select
            value={data.method}
            aria-label={t('node.http.method')}
            data-http-method=""
            // nodrag: иначе клик по списку тащит ноду вместо открытия меню.
            className="nodrag w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={(event) =>
              updateNodeData(id, { method: validateHttpMethod(event.target.value) })
            }
          >
            {HTTP_METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>

          <input
            type="text"
            inputMode="url"
            value={data.url}
            placeholder={t('node.http.url.placeholder')}
            aria-label={t('node.http.url')}
            aria-invalid={isUrlInvalid}
            title={isUrlInvalid ? t('node.http.url.invalid') : undefined}
            data-http-url=""
            className={`${FIELD_CLASS} ${
              isUrlInvalid
                ? 'border-red-500 focus:border-red-500'
                : 'border-border focus:border-primary'
            }`}
            onChange={handleUrlChange}
          />
        </div>

        {/* Тело запроса — сворачиваемый блок: у GET его нет, а у POST оно
            бывает длинным и мешало бы остальным полям. */}
        {hasBody && (
          <button
            type="button"
            onClick={() => setIsBodyOpen((open) => !open)}
            aria-expanded={isBodyOpen}
            aria-label={isBodyOpen ? t('node.http.body.hide') : t('node.http.body.show')}
            data-http-body-toggle=""
            className="nodrag mt-2 flex w-full cursor-pointer items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
          >
            <span aria-hidden="true">{isBodyOpen ? '▼' : '▶'}</span>
            {t('node.http.body')}
          </button>
        )}

        {hasBody && isBodyOpen && (
          <textarea
            ref={bodyRef}
            rows={2}
            value={data.body ?? ''}
            placeholder={t('node.http.body.placeholder')}
            aria-label={t('node.http.body')}
            data-http-body=""
            // overflow-hidden: высоту задаёт хук (KI-169), не браузерная прокрутка.
            className={`${FIELD_CLASS} mt-1 resize-none overflow-hidden`}
            onChange={handleBodyChange}
          />
        )}

        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={HTTP_TIMEOUT_LIMIT}
          value={data.timeoutMs ?? ''}
          placeholder={t('node.http.timeout.placeholder')}
          aria-label={t('node.http.timeout')}
          data-http-timeout=""
          className={`${FIELD_CLASS} mt-2 border-border focus:border-primary`}
          onChange={(event) =>
            updateNodeData(id, {
              timeoutMs: validateTimeoutMs(
                event.target.value === '' ? undefined : Number(event.target.value),
              ),
            })
          }
        />
      </BaseNode>

      <Handle
        type="source"
        id="http-output"
        position={Position.Right}
        className="h-2.5! w-2.5! border-2! border-white!"
        style={{ background: DATA_TYPE_COLORS.generic }}
      />
      <span
        className="pointer-events-none absolute -right-4 top-1/2 -translate-y-1/2 text-[9px] font-semibold"
        style={{ color: DATA_TYPE_COLORS.generic }}
      >
        {DATA_TYPE_LABELS.generic}
      </span>
    </>
  );
}
