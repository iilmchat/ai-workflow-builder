import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { parseAgentSteps } from '@/lib/agent-timeline';
import { nodeLabelOf } from '@/lib/node-registry';
import { useWorkflowStore } from '@/stores/workflow';
import type { NodeRunStatus } from '@/types/run-stream';

/** Высота панели в свёрнутом и развёрнутом виде (Tailwind-классы). */
const PANEL_HEIGHT = { collapsed: 'h-12', expanded: 'h-72' } as const;

/**
 * i18n-ключи подписей статусов узла и запуска для заголовка панели.
 *
 * Ключи статусов запуска исторические (`run.status.node.*`): панель использует
 * эту же карту и для узла, поэтому `skipped` (статус только узла, KI-288)
 * берёт свой ключ `node.status.skipped`.
 */
const STATUS_LABEL_KEYS: Record<NodeRunStatus, string> = {
  pending: 'run.status.node.pending',
  running: 'run.status.node.running',
  completed: 'run.status.node.completed',
  failed: 'run.status.node.failed',
  cancelled: 'run.status.node.cancelled',
  skipped: 'node.status.skipped',
};

/**
 * Секция панели: заголовок и содержимое, разделённые линией.
 *
 * @param props.title - заголовок секции
 * @param props.children - содержимое секции
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-3 py-2 last:border-b-0">
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Форматирует рубли для панели: backend отдаёт `numeric` с 6 знаками
 * («0.600000»), в UI это лишний шум — показываем копейки.
 *
 * @param value - стоимость в рублях строкой (как пришла из snapshot)
 * @returns строка вида «0.60 ₽»; исходная строка, если распарсить не удалось
 */
function formatRub(value: string): string {
  const amount = Number(value);

  return Number.isFinite(amount) ? `${amount.toFixed(2)} ₽` : `${value} ₽`;
}

/**
 * Форматирует доллары для панели: backend отдаёт `numeric` с 6 знаками
 * («0.000000», «2.500000»), в UI это лишний шум — показываем центы (KI-151).
 *
 * Устроено по образцу {@link formatRub}: нечисловое значение не превращается
 * в «$NaN», а отдаётся как есть.
 *
 * @param value - стоимость в USD строкой (как пришла из snapshot)
 * @returns строка вида «$0.00»; исходная строка, если распарсить не удалось
 */
function formatUsd(value: string): string {
  const amount = Number(value);

  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : `$${value}`;
}

/**
 * Форматирует метрики узла в строку «длительность · токены · стоимость».
 *
 * Валюты не смешиваются: LLM-узлы отдают `costUsd`, media-узлы — `costRub`
 * (v0.6.0b.2.3), поэтому в строке появляется та, что заполнена.
 *
 * @param metrics - метрики узла (или `undefined`, если узел не выполнялся)
 * @returns строка метрик либо `null`, если показывать нечего
 */
function formatMetrics(metrics: {
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: string | null;
  costRub: string | null;
} | undefined): string | null {
  if (!metrics) {
    return null;
  }

  const parts: string[] = [];

  if (metrics.durationMs !== null) {
    parts.push(i18n.t('runResultPanel.unit.ms', { value: metrics.durationMs }));
  }

  if (metrics.tokensIn !== null || metrics.tokensOut !== null) {
    parts.push(
      i18n.t('runResultPanel.metrics.tokens', {
        input: metrics.tokensIn ?? '?',
        output: metrics.tokensOut ?? '?',
      }),
    );
  }

  if (metrics.costUsd !== null) {
    parts.push(formatUsd(metrics.costUsd));
  }

  if (metrics.costRub !== null) {
    parts.push(formatRub(metrics.costRub));
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Панель результата снизу: данные выбранной ноды либо запуска целиком.
 *
 * Нода выбирается кликом по холсту (`selectedNodeId` в сторе), поэтому панель
 * не принимает пропсов. Показываемые данные — из SSE: snapshot даёт метрики и
 * логи, события обновляют статусы, ошибки и outputs (R4.2/R4.3b).
 */
export function RunResultPanel() {
  const [isExpanded, setIsExpanded] = useState(true);
  const { t } = useTranslation();

  const selectedNodeId = useWorkflowStore((state) => state.selectedNodeId);
  const nodes = useWorkflowStore((state) => state.nodes);
  const nodeStatuses = useWorkflowStore((state) => state.nodeStatuses);
  const nodeOutputs = useWorkflowStore((state) => state.nodeOutputs);
  const nodeErrors = useWorkflowStore((state) => state.nodeErrors);
  const nodeLogs = useWorkflowStore((state) => state.nodeLogs);
  const nodeMetrics = useWorkflowStore((state) => state.nodeMetrics);
  const runStatus = useWorkflowStore((state) => state.runStatus);
  const runError = useWorkflowStore((state) => state.runError);
  const attemptNumber = useWorkflowStore((state) => state.attemptNumber);
  const attempts = useWorkflowStore((state) => state.attempts);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const status = selectedNodeId !== null ? nodeStatuses[selectedNodeId] : undefined;
  const outputs = selectedNodeId !== null ? nodeOutputs[selectedNodeId] : undefined;
  const error = selectedNodeId !== null ? nodeErrors[selectedNodeId] : undefined;
  const logs = selectedNodeId !== null ? nodeLogs[selectedNodeId] : undefined;
  const metrics = formatMetrics(
    selectedNodeId !== null ? nodeMetrics[selectedNodeId] : undefined,
  );
  // R7.4b: агент кладёт в выходы `steps`. Парсер терпим к форме: если шагов
  // нет или они не похожи на шаги агента, timeline просто не рисуется.
  const agentSteps = parseAgentSteps(outputs?.steps);

  /** Заголовок: «Узел <label> · <status>» либо «Запуск · <status> (попытка N/M)». */
  const title =
    selectedNodeId !== null
      ? t('runResultPanel.title.node', {
          label: nodeLabelOf(selectedNode ?? undefined, selectedNodeId),
          status: status
            ? t(STATUS_LABEL_KEYS[status])
            : t('runResultPanel.title.node.not_run'),
        })
      : runStatus === null
        ? t('runResultPanel.title.run.not_started')
        : t('runResultPanel.title.run', { status: t(STATUS_LABEL_KEYS[runStatus]) }) +
          (attempts !== null && attemptNumber > 0
            ? t('runResultPanel.attempt', {
                current: attemptNumber,
                total: attempts,
              })
            : '');

  return (
    <section
      data-result-panel={selectedNodeId !== null ? 'node' : 'run'}
      className={`flex ${isExpanded ? PANEL_HEIGHT.expanded : PANEL_HEIGHT.collapsed} shrink-0 flex-col border-t border-border bg-muted`}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <h2 className="text-xs font-semibold text-foreground">{title}</h2>

        {selectedNodeId !== null && (
          <span
            className="truncate text-[10px] text-muted-foreground"
            title={selectedNodeId}
          >
            {selectedNodeId}
          </span>
        )}

        <button
          type="button"
          onClick={() => setIsExpanded((value) => !value)}
          aria-expanded={isExpanded}
          // Викс 5 (KI-168): у кнопки не было ни подписи, ни тултипа —
          // назначение иконки ▼/▲ угадывалось.
          aria-label={t(isExpanded ? 'panel.collapse' : 'panel.expand')}
          title={t(isExpanded ? 'panel.collapse' : 'panel.expand')}
          data-panel-toggle={isExpanded ? 'expanded' : 'collapsed'}
          className="ml-auto cursor-pointer rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted"
        >
          {isExpanded ? '▼' : '▲'}
        </button>
      </header>

      {isExpanded && (
        <div className="min-h-0 flex-1 overflow-auto">
          {selectedNodeId !== null ? (
            <>
              {status === undefined || status === 'pending' ? (
                <Section title={t('runResultPanel.section.status')}>
                  <p className="text-xs text-muted-foreground">{t('runResultPanel.node.not_run')}</p>
                </Section>
              ) : null}

              {status === 'running' ? (
                <Section title={t('runResultPanel.section.status')}>
                  <p className="text-xs text-blue-600">{t('runResultPanel.running')}</p>
                </Section>
              ) : null}

              {/* KI-288: узел пропущен — показываем причину и не дублируем её в
                  секции ошибки (там для `skipped` лежит тот же текст). */}
              {status === 'skipped' ? (
                <Section title={t('runResultPanel.section.status')}>
                  <p
                    data-node-skipped-reason=""
                    className="whitespace-pre-wrap text-xs text-muted-foreground"
                  >
                    {error ?? t('node.skipped.reason')}
                  </p>
                </Section>
              ) : null}

              {error !== undefined && status !== 'skipped' ? (
                <Section title={t('runResultPanel.section.error')}>
                  <p className="whitespace-pre-wrap text-xs text-red-700">{error}</p>
                </Section>
              ) : null}

              {agentSteps.length > 0 ? (
                <Section title={t('agent.timeline', { count: agentSteps.length })}>
                  {/* R7.4b: timeline агента — LLM / Tool / Final. Атрибуты
                      `data-agent-step` и `data-agent-tool` — контракт для
                      CDP-смоука и e2e: тип шага виден без разбора текста. */}
                  <ol data-agent-timeline="" className="space-y-1.5">
                    {agentSteps.map((step, index) => (
                      <li
                        key={index}
                        data-agent-step={step.kind}
                        data-agent-tool={step.kind === 'tool' ? step.name : undefined}
                        className="rounded-lg border border-border bg-background px-2 py-1.5"
                      >
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-foreground">
                          <span>{t(`agent.step.${step.kind}`)}</span>

                          {step.kind === 'tool' ? (
                            <span className="font-normal text-muted-foreground">
                              {step.name}
                            </span>
                          ) : null}

                          {step.kind === 'llm' &&
                          (step.tokensIn !== null || step.tokensOut !== null) ? (
                            <span className="font-normal text-muted-foreground">
                              {t('runResultPanel.metrics.tokens', {
                                input: step.tokensIn ?? '?',
                                output: step.tokensOut ?? '?',
                              })}
                            </span>
                          ) : null}
                        </div>

                        {step.detail.length > 0 ? (
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-foreground">
                            {step.detail}
                          </pre>
                        ) : null}

                        {step.kind === 'tool' && step.error !== null ? (
                          <p
                            data-agent-step-error=""
                            className="mt-1 whitespace-pre-wrap text-[10px] text-red-700"
                          >
                            {t('agent.tool.error')}: {step.error}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </Section>
              ) : null}

              {outputs !== undefined ? (
                <Section title={t('runResultPanel.section.output')}>
                  {/* Викс 1 (KI-165): длинный промпт/JSON не влезал в одну
                      строку и обрезался — переносим по словам и ломаем
                      длинные токены (URL, base64), сохраняя монопространство. */}
                  <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words">
                    {JSON.stringify(outputs, null, 2)}
                  </pre>
                </Section>
              ) : null}

              {metrics !== null ? (
                <Section title={t('runResultPanel.section.metrics')}>
                  <p className="text-xs text-muted-foreground">{metrics}</p>
                </Section>
              ) : null}

              {logs !== undefined && logs.length > 0 ? (
                <Section title={t('runResultPanel.section.logs', { count: logs.length })}>
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {logs.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </Section>
              ) : null}
            </>
          ) : (
            <Section title={t('runResultPanel.section.run')}>
              {runStatus === null ? (
                <p className="text-xs text-muted-foreground">
                  {t('runResultPanel.run_hint')}
                </p>
              ) : null}

              {runStatus === 'running' || runStatus === 'pending' ? (
                <p className="text-xs text-blue-600">{t('runResultPanel.running')}</p>
              ) : null}

              {runStatus === 'completed' ? (
                <p className="text-xs text-green-700">{t('runResultPanel.run_completed')}</p>
              ) : null}

              {runStatus === 'failed' ? (
                <p className="whitespace-pre-wrap text-xs text-red-700">
                  {t('runResultPanel.run_error', {
                    error: runError ?? t('runResultPanel.run_error_unknown'),
                  })}
                </p>
              ) : null}

              {runStatus === 'cancelled' ? (
                <p className="text-xs text-muted-foreground">{t('runResultPanel.run_cancelled')}</p>
              ) : null}

              <p className="mt-1 text-[10px] text-muted-foreground">
                {t('runResultPanel.node_hint')}
              </p>
            </Section>
          )}
        </div>
      )}
    </section>
  );
}
