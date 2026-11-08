import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compareRunsAsync,
  type ApiRunCompareResponse,
} from '@/lib/api';
import { RunCompareModal } from './RunCompareModal';

/**
 * Мок API сравнения запусков.
 *
 * Модалка не должна ходить в сеть: контракт ответа проверяет
 * `api-contract.spec.ts`, здесь — рендер таблицы и подсветка различий.
 */
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();

  return { ...actual, compareRunsAsync: vi.fn() };
});

const RUN_1 = '11111111-1111-4111-8111-111111111111';
const RUN_2 = '22222222-2222-4222-8222-222222222222';

/** Сводка запуска в форме `RunSummary`. */
function summaryOf(id: string, status: 'completed' | 'failed') {
  return {
    id,
    cursor: `cursor-${id}`,
    status,
    createdAt: '2026-11-02T09:00:00.000Z',
    startedAt: '2026-11-02T09:00:01.000Z',
    finishedAt: '2026-11-02T09:00:03.000Z',
    durationMs: 2000,
    costUsd: 0.1,
    costRub: 0,
  };
}

/** Ответ сравнения с двумя различающимися узлами. */
const COMPARE_RESPONSE: ApiRunCompareResponse = {
  run1: summaryOf(RUN_1, 'completed'),
  run2: summaryOf(RUN_2, 'failed'),
  diffs: {
    nodeDiffs: [
      {
        nodeId: 'n1',
        status1: 'completed',
        status2: 'completed',
        outputsDiff: JSON.stringify(
          { changed: { text: { run1: 'hello', run2: 'bye' } } },
          null,
          2,
        ),
        duration1: 1000,
        duration2: 1500,
        cost1: 0.1,
        cost2: 0.2,
      },
      {
        nodeId: 'n2',
        status1: 'completed',
        status2: 'failed',
        duration1: 1000,
        duration2: 2000,
        cost1: 0.1,
        cost2: 0.3,
      },
    ],
    totalDiff: {
      durationMs: 1000,
      costUsd: 0.2,
      costRub: 0,
    },
  },
};

/** Рендерит модалку сравнения с заглушкой `onClose`. */
function renderCompare() {
  const onClose = vi.fn();

  const view = render(
    <RunCompareModal runId1={RUN_1} runId2={RUN_2} onClose={onClose} />,
  );

  return { ...view, onClose };
}

describe('RunCompareModal (v1.4.0 S2)', () => {
  afterEach(() => {
    vi.mocked(compareRunsAsync).mockReset();
  });

  it('рисует side-by-side таблицу по узлам и diff outputs', async () => {
    vi.mocked(compareRunsAsync).mockResolvedValue(COMPARE_RESPONSE);

    const { container } = renderCompare();

    // Заголовок и оба запуска видны сразу; данные — после ответа.
    expect(
      screen.getByRole('dialog', { name: 'Сравнение запусков' }),
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(container.querySelectorAll('[data-compare-row]')).toHaveLength(2),
    );

    expect(vi.mocked(compareRunsAsync)).toHaveBeenCalledWith(RUN_1, RUN_2);
    expect(
      container.querySelector(`[data-compare-run1="${RUN_1}"]`),
    ).not.toBeNull();
    expect(
      container.querySelector(`[data-compare-run2="${RUN_2}"]`),
    ).not.toBeNull();

    // Строка n1: diff outputs отрисован, а не «Различий нет».
    const outputs = container.querySelector('[data-compare-outputs="n1"]');

    expect(outputs).not.toBeNull();
    expect(outputs?.textContent).toContain('hello');
    expect(outputs?.textContent).toContain('bye');

    // Строка n2: outputs совпали.
    expect(screen.getByText('Различий нет')).toBeInTheDocument();

    // Длительности и стоимости — в мс/секундах и USD (значения повторяются
    // в двух колонках, поэтому проверяем наличие, а не единственность).
    expect(screen.getAllByText('1.0 с').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$0.1000').length).toBeGreaterThan(0);

    // Суммарная дельта положительна → красный (второй запуск дороже/дольше).
    expect(
      container.querySelector('[data-compare-delta-cost-usd="0.2000"]'),
    ).toHaveClass('text-red-700');

    expect(compareRunsAsync).toHaveBeenCalledTimes(1);
  });

  it('подсвечивает различие статусов красным/зелёным', async () => {
    vi.mocked(compareRunsAsync).mockResolvedValue(COMPARE_RESPONSE);

    const { container } = renderCompare();

    await waitFor(() =>
      expect(
        container.querySelector('[data-compare-row="n2"]'),
      ).not.toBeNull(),
    );

    const row = container.querySelector('[data-compare-row="n2"]');

    expect(row).toHaveAttribute('data-compare-diff', 'true');
    // completed (run1) лучше failed (run2): зелёный слева, красный справа.
    expect(row?.innerHTML).toContain('bg-green-50');
    expect(row?.innerHTML).toContain('bg-red-50');
  });

  it('показывает ошибку и повторяет запрос по кнопке', async () => {
    vi.mocked(compareRunsAsync)
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValueOnce(COMPARE_RESPONSE);

    const { container } = renderCompare();

    await waitFor(() =>
      expect(container.querySelector('[data-compare-error]')).not.toBeNull(),
    );

    expect(screen.getByText(/Не удалось сравнить запуски/)).toBeInTheDocument();

    screen.getByRole('button', { name: 'Повторить' }).click();

    await waitFor(() =>
      expect(container.querySelectorAll('[data-compare-row]')).toHaveLength(2),
    );
    expect(compareRunsAsync).toHaveBeenCalledTimes(2);
  });
});
