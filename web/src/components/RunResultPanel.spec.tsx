import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ru from '@/i18n/ru.json';
import { useWorkflowStore } from '@/stores/workflow';
import type { AppNode } from '@/types/graph';
import type { CostStatus } from '@/types/run-stream';
import { RunResultPanel } from './RunResultPanel';

/** Метрики выбранного узла с заданным статусом стоимости. */
function metricsWith(costStatus: CostStatus | null) {
  return {
    durationMs: 10,
    tokensIn: 10,
    tokensOut: 5,
    costUsd: costStatus === 'unknown' ? null : '0.000000',
    costStatus,
    costRub: null,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    cacheSavingsUsd: null,
    storedUrl: null,
    storedExpiresAt: null,
  };
}

/**
 * Показывает панель для одного LLM-узла с заданным `costStatus`.
 *
 * @param costStatus - статус стоимости (S8.1, KI-152)
 * @returns результат `render`
 */
function renderPanel(costStatus: CostStatus | null) {
  const node = {
    id: 'n1',
    type: 'llm',
    position: { x: 0, y: 0 },
    data: { kind: 'llm', model: 'gpt-4o' },
  } as AppNode;

  useWorkflowStore.setState({
    nodes: [node],
    edges: [],
    selectedNodeId: 'n1',
    nodeStatuses: { n1: 'completed' },
    nodeOutputs: { n1: { text: 'ответ' } },
    nodeErrors: {},
    nodeLogs: {},
    nodeMetrics: { n1: metricsWith(costStatus) },
    runStatus: null,
    runError: null,
    attemptNumber: 0,
    attempts: null,
  });

  return render(<RunResultPanel />);
}

describe('RunResultPanel — costStatus (S8.1, KI-152)', () => {
  afterEach(() => {
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      nodeStatuses: {},
      nodeOutputs: {},
      nodeErrors: {},
      nodeLogs: {},
      nodeMetrics: {},
    });
  });

  it('cached показывает «Из кэша (0 ₽)»', () => {
    renderPanel('cached');

    expect(screen.getByText(ru['runResultPanel.metrics.cache_hit'])).toBeInTheDocument();
    expect(
      screen.getByText(ru['runResultPanel.metrics.cache_hit']),
    ).toHaveAttribute('data-cost-status', 'cached');
  });

  it('local показывает «Локально (0 ₽)»', () => {
    renderPanel('local');

    const badge = screen.getByText(ru['runResultPanel.metrics.local']);

    expect(badge).toHaveAttribute('data-cost-status', 'local');
  });

  it('unknown показывает «Стоимость неизвестна»', () => {
    renderPanel('unknown');

    const badge = screen.getByText(ru['runResultPanel.metrics.unknown']);

    expect(badge).toHaveAttribute('data-cost-status', 'unknown');
  });

  it('exact не показывает дополнительный бейдж', () => {
    renderPanel('exact');

    expect(
      screen.queryByText(ru['runResultPanel.metrics.local']),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(ru['runResultPanel.metrics.unknown']),
    ).not.toBeInTheDocument();
  });
});
