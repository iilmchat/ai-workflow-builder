import { useState } from 'react';
import { nodeLabelOf } from '@/lib/node-registry';
import { useWorkflowStore } from '@/stores/workflow';
import type { RunStatus } from '@/types/run-stream';

/** Высота панели в свёрнутом и развёрнутом виде (Tailwind-классы). */
const PANEL_HEIGHT = { collapsed: 'h-12', expanded: 'h-72' } as const;

/** Подписи статусов узла и запуска для заголовка панели. */
const STATUS_LABELS: Record<RunStatus, string> = {
  pending: 'ожидает',
  running: 'выполняется',
  completed: 'завершён',
  failed: 'ошибка',
  cancelled: 'отменён',
};

/**
 * Секция панели: заголовок и содержимое, разделённые линией.
 *
 * @param props.title - заголовок секции
 * @param props.children - содержимое секции
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-slate-200 px-3 py-2 last:border-b-0">
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
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
    parts.push(`${metrics.durationMs} мс`);
  }

  if (metrics.tokensIn !== null || metrics.tokensOut !== null) {
    parts.push(`токены ${metrics.tokensIn ?? '?'} → ${metrics.tokensOut ?? '?'}`);
  }

  if (metrics.costUsd !== null) {
    parts.push(`$${metrics.costUsd}`);
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

  /** Заголовок: «Узел <label> · <status>» либо «Запуск · <status> (попытка N/M)». */
  const title =
    selectedNodeId !== null
      ? `Узел ${nodeLabelOf(selectedNode ?? undefined, selectedNodeId)} · ${
          status ? STATUS_LABELS[status] : 'не выполнялся'
        }`
      : runStatus === null
        ? 'Запуск · не запускался'
        : `Запуск · ${STATUS_LABELS[runStatus]}${
            attempts !== null && attemptNumber > 0 ? ` (попытка ${attemptNumber}/${attempts})` : ''
          }`;

  return (
    <section
      data-result-panel={selectedNodeId !== null ? 'node' : 'run'}
      className={`flex ${isExpanded ? PANEL_HEIGHT.expanded : PANEL_HEIGHT.collapsed} shrink-0 flex-col border-t border-slate-200 bg-slate-50`}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <h2 className="text-xs font-semibold text-slate-700">{title}</h2>

        {selectedNodeId !== null && (
          <span
            className="truncate text-[10px] text-slate-400"
            title={selectedNodeId}
          >
            {selectedNodeId}
          </span>
        )}

        <button
          type="button"
          onClick={() => setIsExpanded((value) => !value)}
          aria-expanded={isExpanded}
          data-panel-toggle={isExpanded ? 'expanded' : 'collapsed'}
          className="ml-auto cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
        >
          {isExpanded ? '▼' : '▲'}
        </button>
      </header>

      {isExpanded && (
        <div className="min-h-0 flex-1 overflow-auto">
          {selectedNodeId !== null ? (
            <>
              {status === undefined || status === 'pending' ? (
                <Section title="Статус">
                  <p className="text-xs text-slate-500">Узел ещё не выполнялся.</p>
                </Section>
              ) : null}

              {status === 'running' ? (
                <Section title="Статус">
                  <p className="text-xs text-blue-600">Выполняется…</p>
                </Section>
              ) : null}

              {error !== undefined ? (
                <Section title="Ошибка">
                  <p className="whitespace-pre-wrap text-xs text-red-700">{error}</p>
                </Section>
              ) : null}

              {outputs !== undefined ? (
                <Section title="Вывод">
                  <pre className="text-xs font-mono text-slate-700">
                    {JSON.stringify(outputs, null, 2)}
                  </pre>
                </Section>
              ) : null}

              {metrics !== null ? (
                <Section title="Метрики">
                  <p className="text-xs text-slate-600">{metrics}</p>
                </Section>
              ) : null}

              {logs !== undefined && logs.length > 0 ? (
                <Section title={`Логи (${logs.length})`}>
                  <ul className="space-y-0.5 text-xs text-slate-500">
                    {logs.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </Section>
              ) : null}
            </>
          ) : (
            <Section title="Запуск">
              {runStatus === null ? (
                <p className="text-xs text-slate-500">
                  Запустите workflow, чтобы увидеть результат.
                </p>
              ) : null}

              {runStatus === 'running' || runStatus === 'pending' ? (
                <p className="text-xs text-blue-600">Выполняется…</p>
              ) : null}

              {runStatus === 'completed' ? (
                <p className="text-xs text-green-700">Запуск завершён успешно.</p>
              ) : null}

              {runStatus === 'failed' ? (
                <p className="whitespace-pre-wrap text-xs text-red-700">
                  Ошибка запуска: {runError ?? 'причина недоступна'}
                </p>
              ) : null}

              {runStatus === 'cancelled' ? (
                <p className="text-xs text-slate-500">Запуск отменён.</p>
              ) : null}

              <p className="mt-1 text-[10px] text-slate-400">
                Кликните по узлу, чтобы посмотреть его вывод, метрики и логи.
              </p>
            </Section>
          )}
        </div>
      )}
    </section>
  );
}
