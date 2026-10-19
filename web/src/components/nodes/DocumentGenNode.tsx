import { useCallback, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import { useAutoResize } from '@/hooks/use-auto-resize';
import { useNodeDataHistory } from '@/hooks/use-node-data-history';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import {
  deleteDocumentTemplateAsync,
  listDocumentTemplatesAsync,
  uploadDocumentTemplateAsync,
  type ApiDocumentTemplate,
} from '@/lib/api';
import { NODE_REGISTRY } from '@/lib/node-registry';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  type DocumentGenFlowNode,
} from '@/types/graph';

/** Классы textarea/кнопок узла (как у WebSearch/LLM). */
const FIELD_CLASS =
  'nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';

/** Классы маленькой кнопки узла. */
const BUTTON_CLASS =
  'nodrag rounded-lg border border-border bg-background px-2 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';

/** Ссылка на скачанный документ в том же стиле, что была до S5. */
const DOWNLOAD_CLASS =
  'nodrag mt-2 inline-flex items-center gap-1 rounded-lg border border-green-300 bg-green-50 px-2 py-1 text-[10px] font-medium text-green-700 transition-colors hover:bg-green-100';

/**
 * Режим интерпретации контента (DESIGN v0.10 § 3.2.1).
 *
 * `format` узла (`docx`/`pdf`) в UI не выбирается: backend реализует только
 * DOCX, а селект «Markdown/JSON» — это `source`, а не формат файла.
 */
type DocumentSource = 'markdown' | 'json';

/**
 * Режим узла (v0.11 S4/S5, DESIGN § 3.1.2).
 *
 * Отсутствие `mode` в старых графах трактуется как `inline`: backend
 * подставляет тот же дефолт.
 */
type DocumentMode = 'inline' | 'template';

/**
 * Читает `data.mode` из jsonb.
 *
 * @param value - значение из `data.mode` (`unknown`)
 * @returns `template` только при точном совпадении, иначе `inline`
 */
function readMode(value: unknown): DocumentMode {
  return value === 'template' ? 'template' : 'inline';
}

/**
 * Читает `data.templateId` из jsonb.
 *
 * @param value - значение из `data.templateId` (`unknown`)
 * @returns uuid строкой либо пустая строка (селект «не выбран»)
 */
function readTemplateId(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Читает `data.variables` из jsonb.
 *
 * @param value - значение из `data.variables` (`unknown`)
 * @returns объект переменных либо `undefined` (не объект/массив/скаляр)
 */
function readVariables(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

/**
 * Превращает переменные в текст textarea.
 *
 * @param variables - объект переменных
 * @returns JSON с отступами либо пустая строка
 */
function variablesToText(
  variables: Record<string, unknown> | undefined,
): string {
  return variables === undefined ? '' : JSON.stringify(variables, null, 2);
}

/** Результат разбора textarea переменных. */
type ParsedVariables =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'valid'; readonly value: Record<string, unknown> };

/**
 * Разбирает JSON из textarea переменных.
 *
 * Пустая строка — осознанное «переменных нет» (fallback не задан); массив и
 * скаляр — ошибка, потому что backend-схема ждёт объект (DESIGN § 3.1.2).
 *
 * @param text - содержимое textarea
 * @returns разобранный вариант
 */
function parseVariablesDraft(text: string): ParsedVariables {
  if (text.trim().length === 0) {
    return { kind: 'empty' };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'invalid' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'invalid' };
  }

  return { kind: 'valid', value: parsed as Record<string, unknown> };
}

/**
 * Читает `data.source` из jsonb.
 *
 * @param value - значение из `data.source` (`unknown`)
 * @returns `json` только при точном совпадении, иначе `markdown`
 */
function readSource(value: unknown): DocumentSource {
  return value === 'json' ? 'json' : 'markdown';
}

/**
 * Читает `data.content` из jsonb.
 *
 * @param value - значение из `data.content` (`unknown`)
 * @returns строка контента (пустая, если значение не строка)
 */
function readContent(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Достаёт ссылку на сохранённый документ из `nodeOutputs`.
 *
 * Порядок ключей: `storedUrl` (как у media-узлов) → `fileUrl` (порт
 * DESIGN § 3.2.5) → `url` (совместимость). Принимаются только `http(s)` и
 * относительные пути: `javascript:` из чужого/испорченного снимка не должен
 * стать кликабельной ссылкой (RULES 1.17).
 *
 * @param outputs - выходы узла из стора (`undefined` — узел ещё не выполнялся)
 * @returns безопасная ссылка либо `null`
 */
function readDocumentUrl(
  outputs: Record<string, unknown> | undefined,
): string | null {
  for (const key of ['storedUrl', 'fileUrl', 'url'] as const) {
    const value = outputs?.[key];

    if (
      typeof value === 'string' &&
      (value.startsWith('/') || /^https?:\/\//i.test(value))
    ) {
      return value;
    }
  }

  return null;
}

/**
 * Достаёт имя файла из выходов узла.
 *
 * @param outputs - выходы узла из стора
 * @returns имя без пути либо `undefined`
 */
function readFileName(
  outputs: Record<string, unknown> | undefined,
): string | undefined {
  const value = outputs?.fileName;

  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  // `download` не должен получить путь: имя файла — последний сегмент.
  return value.split(/[\\/]/).at(-1);
}

/**
 * Достаёт имена незаполненных плейсхолдеров из outputs (v0.11 S4).
 *
 * Показываются только у документа по шаблону: inline-документ поля не имеет.
 *
 * @param outputs - выходы узла из стора
 * @returns имена плейсхолдеров (пустой массив, если предупреждать не о чем)
 */
function readMissingVariables(
  outputs: Record<string, unknown> | undefined,
): string[] {
  if (outputs?.mode !== 'template') {
    return [];
  }

  const value = outputs.missingVariables;

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Узел генерации документа (v0.10 S6; режим шаблона — v0.11 S5).
 *
 * Порты (`src/engine/node-ports.ts`): вход `text-input` (порт `prompt` —
 * Markdown/JSON или JSON-объект переменных) и выход `document-output` (порт
 * `fileUrl` — ссылка на сохранённый DOCX).
 *
 * Режимы (DESIGN § 3.1.8):
 * - `inline` — прежний UI: селект `source` и textarea контента;
 * - `template` — селект загруженных шаблонов, кнопка «Загрузить .docx»,
 *   чипы плейсхолдеров, textarea `variables` (только без входящей связи) и
 *   удаление шаблона (disabled для `viewer`).
 *
 * После Run — ссылка «Скачать DOCX» (как раньше); если `outputs` содержит
 * `missingVariables`, под ссылкой показывается жёлтая подсказка.
 */
export function DocumentGenNode({ id, data }: NodeProps<DocumentGenFlowNode>) {
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const outputs = useWorkflowStore((state) => state.nodeOutputs[id]);
  const removeNode = useWorkflowStore((state) => state.removeNode);
  // Входящая связь делает textarea ненужной: исполнитель берёт `inputs.prompt`.
  const hasIncomingEdge = useWorkflowStore((state) =>
    state.edges.some((edge) => edge.target === id),
  );
  // v0.11 S5: шаблоны живут в workflow — нужен его id и роль пользователя.
  const workflowId = useWorkflowStore((state) => state.currentWorkflowId);
  const accessRole = useWorkflowStore((state) => state.accessRole);
  const isViewer = accessRole === 'viewer';

  const mode = readMode(data.mode);
  const source = readSource(data.source);
  const content = readContent(data.content);
  const templateId = readTemplateId(data.templateId);
  const downloadUrl = readDocumentUrl(outputs);
  const fileName = readFileName(outputs);
  const missingVariables = readMissingVariables(outputs);

  /** Список шаблонов workflow (`GET …/document-templates`). */
  const [templates, setTemplates] = useState<ApiDocumentTemplate[]>([]);
  const [templatesError, setTemplatesError] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  /** Черновик textarea переменных: `null` — показываем `data.variables`. */
  const [variablesDraft, setVariablesDraft] = useState<string | null>(null);
  const [variablesError, setVariablesError] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const variablesRef = useRef<HTMLTextAreaElement>(null);

  const storedVariables = readVariables(data.variables);
  const variablesText = variablesDraft ?? variablesToText(storedVariables);
  const selectedTemplate = templates.find((item) => item.id === templateId);

  // KI-157: контент пишется в стор на каждый символ — сохраняем курсор.
  const handleContentChange = usePreserveCursor<HTMLTextAreaElement>(
    useCallback(
      (value: string) => updateNodeData(id, { content: value }),
      [id, updateNodeData],
    ),
  );

  // KI-157: то же для JSON-переменных шаблона.
  const handleVariablesChange = usePreserveCursor<HTMLTextAreaElement>(
    useCallback(
      (value: string) => {
        setVariablesDraft(value);

        const parsed = parseVariablesDraft(value);

        if (parsed.kind === 'invalid') {
          setVariablesError(true);

          return;
        }

        setVariablesError(false);
        updateNodeData(id, {
          variables: parsed.kind === 'valid' ? parsed.value : undefined,
        });
      },
      [id, updateNodeData],
    ),
  );

  // KI-169: textarea растёт по тексту (у переменных — только в template-режиме).
  useAutoResize(contentRef, content);
  useAutoResize(variablesRef, variablesText);

  // v0.11 S5: список шаблонов нужен только в template-режиме и только после
  // сохранения workflow (GET требует uuid). Повторный запрос — при смене
  // workflow или режима; загрузка/удаление правят список локально.
  useEffect(() => {
    if (mode !== 'template' || workflowId === null) {
      return;
    }

    let cancelled = false;

    setTemplatesError(false);

    void listDocumentTemplatesAsync(workflowId)
      .then((list) => {
        if (!cancelled) {
          setTemplates(list);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTemplatesError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mode, workflowId]);

  /**
   * Загружает выбранный `.docx` и делает его текущим шаблоном узла.
   *
   * @param file - файл из `<input type="file">`
   */
  const handleUpload = useCallback(
    async (file: File): Promise<void> => {
      if (workflowId === null || isViewer) {
        return;
      }

      setIsUploading(true);
      setUploadError(false);

      try {
        const created = await uploadDocumentTemplateAsync(workflowId, file);

        setTemplates((previous) => [
          created,
          ...previous.filter((item) => item.id !== created.id),
        ]);
        updateNodeData(id, { templateId: created.id, mode: 'template' });
      } catch {
        setUploadError(true);
      } finally {
        setIsUploading(false);
      }
    },
    [id, isViewer, updateNodeData, workflowId],
  );

  /**
   * Удаляет текущий шаблон после подтверждения.
   */
  const handleDelete = useCallback(async (): Promise<void> => {
    if (workflowId === null || selectedTemplate === undefined || isViewer) {
      return;
    }

    if (
      !window.confirm(
        t('template.deleteConfirm', { name: selectedTemplate.name }),
      )
    ) {
      return;
    }

    setDeleteError(false);

    try {
      await deleteDocumentTemplateAsync(workflowId, selectedTemplate.id);
      setTemplates((previous) =>
        previous.filter((item) => item.id !== selectedTemplate.id),
      );
      updateNodeData(id, { templateId: undefined });
    } catch {
      setDeleteError(true);
    }
  }, [id, isViewer, selectedTemplate, t, updateNodeData, workflowId]);

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
        icon={NODE_REGISTRY.document_gen.icon}
        title={t(NODE_REGISTRY.document_gen.labelKey)}
        status={status}
        dataNodeAttr={{ name: 'data-document-gen-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <label className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          {t('node.document_gen.mode')}
          <select
            value={mode}
            aria-label={t('node.document_gen.mode')}
            data-document-gen-mode=""
            className="nodrag rounded-lg border border-border bg-background px-1.5 py-1 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={(event) =>
              updateNodeData(id, { mode: readMode(event.target.value) })
            }
          >
            <option value="inline">
              {t('node.document_gen.mode.inline')}
            </option>
            <option value="template">
              {t('node.document_gen.mode.template')}
            </option>
          </select>
        </label>

        {mode === 'inline' ? (
          <>
            <label className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              {t('node.document_gen.source')}
              <select
                value={source}
                aria-label={t('node.document_gen.source')}
                data-document-gen-source=""
                className="nodrag rounded-lg border border-border bg-background px-1.5 py-1 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                onChange={(event) =>
                  updateNodeData(id, { source: readSource(event.target.value) })
                }
              >
                <option value="markdown">
                  {t('node.document_gen.source.markdown')}
                </option>
                <option value="json">
                  {t('node.document_gen.source.json')}
                </option>
              </select>
            </label>

            {hasIncomingEdge ? (
              <p
                className="mt-2 text-[9px] text-muted-foreground"
                data-document-gen-connected=""
              >
                {t('node.document_gen.connected')}
              </p>
            ) : (
              <textarea
                ref={contentRef}
                rows={3}
                value={content}
                placeholder={t(
                  source === 'json'
                    ? 'node.document_gen.content.placeholderJson'
                    : 'node.document_gen.content.placeholder',
                )}
                aria-label={t('node.document_gen.content')}
                data-document-gen-content=""
                className={`${FIELD_CLASS} mt-2 resize-none overflow-hidden font-mono`}
                onChange={handleContentChange}
              />
            )}
          </>
        ) : (
          <div className="mt-2 space-y-2" data-document-template-panel="">
            {workflowId === null ? (
              <p className="text-[9px] text-muted-foreground">
                {t('template.needSave')}
              </p>
            ) : (
              <>
                <select
                  value={templateId}
                  aria-label={t('template.select')}
                  data-document-template-select=""
                  className="nodrag w-full rounded-lg border border-border bg-background px-1.5 py-1 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  onChange={(event) =>
                    updateNodeData(id, {
                      templateId:
                        event.target.value.length > 0
                          ? event.target.value
                          : undefined,
                    })
                  }
                >
                  <option value="">{t('template.select')}</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isViewer || isUploading}
                    data-document-template-upload=""
                    className={BUTTON_CLASS}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {isUploading
                      ? t('template.uploading')
                      : t('template.upload')}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".docx"
                    className="hidden"
                    data-document-template-file=""
                    onChange={(event) => {
                      const file = event.target.files?.[0];

                      // Одно и то же имя файла должно снова триггерить change.
                      event.target.value = '';

                      if (file !== undefined) {
                        void handleUpload(file);
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={
                      isViewer || selectedTemplate === undefined
                    }
                    data-document-template-delete=""
                    className={BUTTON_CLASS}
                    onClick={() => void handleDelete()}
                  >
                    {t('template.delete')}
                  </button>
                </div>

                {selectedTemplate !== undefined ? (
                  <div data-document-template-placeholders="">
                    <p className="text-[9px] font-medium text-muted-foreground">
                      {t('template.placeholders')}
                    </p>
                    {selectedTemplate.placeholders.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {selectedTemplate.placeholders.map((placeholder) => (
                          <span
                            key={placeholder}
                            className="rounded-full border border-border bg-muted px-1.5 py-0.5 font-mono text-[9px] text-foreground"
                          >
                            {`{${placeholder}}`}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-[9px] text-muted-foreground">
                        {t('template.noPlaceholders')}
                      </p>
                    )}
                  </div>
                ) : null}

                {hasIncomingEdge ? (
                  <p
                    className="text-[9px] text-muted-foreground"
                    data-document-template-variables-input=""
                  >
                    {t('template.variablesFromInput')}
                  </p>
                ) : (
                  <>
                    <label className="block text-[10px] text-muted-foreground">
                      {t('template.variables')}
                      <textarea
                        ref={variablesRef}
                        rows={2}
                        value={variablesText}
                        placeholder={'{ "client": "ACME" }'}
                        aria-label={t('template.variables')}
                        data-document-template-variables=""
                        className={`${FIELD_CLASS} mt-1 resize-none overflow-hidden font-mono`}
                        onChange={handleVariablesChange}
                      />
                    </label>
                    {variablesError ? (
                      <p
                        className="text-[9px] text-red-600"
                        data-document-template-variables-error=""
                      >
                        {t('template.variablesInvalid')}
                      </p>
                    ) : null}
                  </>
                )}

                {templates.length === 0 && !templatesError ? (
                  <p className="text-[9px] text-muted-foreground">
                    {t('template.empty')}
                  </p>
                ) : null}
                {templatesError ? (
                  <p className="text-[9px] text-red-600">
                    {t('template.loadError')}
                  </p>
                ) : null}
                {uploadError ? (
                  <p className="text-[9px] text-red-600">
                    {t('template.uploadError')}
                  </p>
                ) : null}
                {deleteError ? (
                  <p className="text-[9px] text-red-600">
                    {t('template.deleteError')}
                  </p>
                ) : null}
              </>
            )}
          </div>
        )}

        {downloadUrl !== null ? (
          <a
            href={downloadUrl}
            download={fileName ?? 'document.docx'}
            target="_blank"
            rel="noreferrer"
            data-document-gen-download=""
            className={DOWNLOAD_CLASS}
          >
            <span aria-hidden="true">⬇</span>
            {t('node.document_gen.download')}
          </a>
        ) : (
          <p className="mt-1 text-[9px] text-muted-foreground">
            {t('node.document_gen.hint')}
          </p>
        )}

        {missingVariables.length > 0 ? (
          <p
            className="mt-2 rounded-lg border border-yellow-300 bg-yellow-50 px-2 py-1 text-[9px] text-yellow-800"
            data-document-gen-missing=""
          >
            {t('template.missing', {
              names: missingVariables.join(', '),
            })}
          </p>
        ) : null}
      </BaseNode>

      <Handle
        type="source"
        id="document-output"
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
