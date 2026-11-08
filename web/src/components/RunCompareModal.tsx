import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import {
  compareRunsAsync,
  type ApiNodeDiff,
  type ApiRunCompareResponse,
} from '@/lib/api';
import { NODE_RUN_STATUS_META } from '@/lib/run-status-meta';
import type { NodeRunStatus } from '@/types/run-stream';

/** Пропсы модального окна сравнения запусков. */
interface RunCompareModalProps {
  /** uuid первого запуска — левая колонка. */
  runId1: string;
  /** uuid второго запуска — правая колонка. */
  runId2: string;
  /** Закрывает окно (Escape, клик по фону, крестик). */
  onClose: () => void;
}

/** Тон ячейки сравнения: лучше/хуже/одинаково. */
type CompareTone = 'better' | 'worse' | 'same';

/**
 * CSS-классы тона. «Лучше» — зелёный, «хуже» — красный (DESIGN V140 § 3.2:
 * подсветка различий красный/зелёный), «одинаково» — нейтральный.
 *
 * @param tone - тон ячейки
 * @returns классы фона и текста
 */
function toneClass(tone: CompareTone): string {
  switch (tone) {
    case 'better':
      return 'bg-green-50 text-green-700';
    case 'worse':
      return 'bg-red-50 text-red-700';
    case 'same':
      return '';
  }
}

/**
 * Ранг статуса узла для сравнения «что лучше».
 *
 * `completed` — лучше всего, `failed`/`cancelled` — хуже; `skipped` ниже
 * `pending`, потому что узел даже не пытался выполниться. `null` (узла в
 * запуске не было) — худший вариант.
 *
 * @param status - статус узла либо `null`
 * @returns числовой ранг (больше — лучше)
 */
function statusRank(status: NodeRunStatus | null): number {
  switch (status) {
    case 'completed':
      return 6;
    case 'running':
      return 5;
    case 'pending':
      return 4;
    case 'skipped':
      return 3;
    case 'failed':
      return 2;
    case 'cancelled':
      return 1;
    case null:
      return 0;
  }
}

/**
 * Сравнивает два значения «чем меньше, тем лучше» (длительность, стоимость).
 *
 * @param value1 - значение первого запуска
 * @param value2 - значение второго запуска
 * @returns тоны для левой и правой ячейки
 */
function numericTones(
  value1: number | null,
  value2: number | null,
): [CompareTone, CompareTone] {
  if (value1 === null && value2 === null) {
    return ['same', 'same'];
  }

  if (value1 === null) {
    return ['worse', 'better'];
  }

  if (value2 === null) {
    return ['better', 'worse'];
  }

  if (value1 === value2) {
    return ['same', 'same'];
  }

  return value1 < value2 ? ['better', 'worse'] : ['worse', 'better'];
}

/**
 * Форматирует длительность узла в мс/с.
 *
 * @param durationMs - длительность либо `null`
 * @returns подпись; «—» для отсутствующего значения
 */
function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return '—';
  }

  if (durationMs < 1_000) {
    return i18n.t('history.duration_ms', { ms: durationMs });
  }

  return i18n.t('history.duration_s', {
    seconds: (durationMs / 1_000).toFixed(1),
  });
}

/**
 * Форматирует стоимость узла в USD.
 *
 * @param costUsd - стоимость либо `null` (узла не было)
 * @returns `$0.0123` либо «—»
 */
function formatNodeCost(costUsd: number | null): string {
  return costUsd === null ? '—' : `$${costUsd.toFixed(4)}`;
}

/**
 * Форматирует суммарную стоимость запуска (USD + RUB).
 *
 * @param costUsd - сумма в USD
 * @param costRub - сумма в рублях
 * @returns строка вида `$0.0123 + 25.50 ₽`
 */
function formatTotalCost(costUsd: number, costRub: number): string {
  const parts: string[] = [];

  if (costUsd > 0) {
    parts.push(`$${costUsd.toFixed(4)}`);
  }

  if (costRub > 0) {
    parts.push(`${costRub.toFixed(2)} ₽`);
  }

  return parts.length > 0 ? parts.join(' + ') : '$0.0000';
}

/**
 * Форматирует дельту в USD со знаком.
 *
 * @param value - `run2 − run1`
 * @returns `+$0.0100`, `-$0.0020` или `$0.0000`
 */
function formatUsdDelta(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';

  return `${sign}$${Math.abs(value).toFixed(4)}`;
}

/**
 * Форматирует дельту в рублях со знаком.
 *
 * @param value - `run2 − run1`
 * @returns `+25.50 ₽`, `-3.00 ₽` или `0.00 ₽`
 */
function formatRubDelta(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';

  return `${sign}${Math.abs(value).toFixed(2)} ₽`;
}

/**
 * Тон для суммарной дельты: рост показателя — красный, снижение — зелёный.
 *
 * @param value - дельта `run2 − run1`
 * @returns CSS-класс
 */
function deltaClass(value: number): string {
  if (value === 0) {
    return 'text-muted-foreground';
  }

  return value > 0 ? 'text-red-700' : 'text-green-700';
}

/**
 * Модальное окно сравнения двух запусков (v1.4.0 S2, DESIGN V140 § 3.2).
 *
 * Загружает `GET /runs/:id1/compare/:id2` и рисует side-by-side таблицу:
 * статус, длительность, стоимость и diff outputs по каждому узлу, плюс
 * суммарные дельты (`run2 − run1`). Различия подсвечиваются красным/зелёным:
 * зелёный — «лучше» (меньше длительность/стоимость, более успешный статус),
 * красный — «хуже».
 *
 * Модалка не управляет выбором запусков — это делает `RunHistoryModal`; сюда
 * приходят уже два id. Поэтому компонент можно открыть и из другого места
 * (например, из будущей страницы сравнения).
 */
export function RunCompareModal({
  runId1,
  runId2,
  onClose,
}: RunCompareModalProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<ApiRunCompareResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Ретрай после ошибки: зависимость эффекта — счётчик, а не «нажали ещё раз».
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    setError(null);

    compareRunsAsync(runId1, runId2)
      .then((result) => {
        if (!cancelled) {
          setData(result);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          const reason =
            caught instanceof Error ? caught.message : i18n.t('error.unknown');
          setError(i18n.t('compare.load_failed', { reason }));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runId1, runId2, reloadKey]);

  // Escape закрывает только сравнение: история под ним слушает то же событие,
  // но проверяет `comparePair` и не закрывается (см. RunHistoryModal).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  /**
   * Строка таблицы с подсветкой.
   *
   * @param diff - поузловое различие
   * @returns JSX-строка таблицы
   */
  const renderRow = (diff: ApiNodeDiff) => {
    const [statusTone1, statusTone2] =
      diff.status1 === diff.status2
        ? (['same', 'same'] as const)
        : statusRank(diff.status1) > statusRank(diff.status2)
          ? (['better', 'worse'] as const)
          : (['worse', 'better'] as const);
    const [durationTone1, durationTone2] = numericTones(
      diff.duration1,
      diff.duration2,
    );
    const [costTone1, costTone2] = numericTones(diff.cost1, diff.cost2);
    const hasDiff =
      diff.status1 !== diff.status2 ||
      diff.duration1 !== diff.duration2 ||
      diff.cost1 !== diff.cost2 ||
      diff.outputsDiff !== undefined;

    const statusCell = (status: NodeRunStatus | null, tone: CompareTone) => {
      if (status === null) {
        return (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] ${toneClass(tone)}`}>
            —
          </span>
        );
      }

      const meta = NODE_RUN_STATUS_META[status];

      return (
        <span
          className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            tone === 'same' ? meta.className : toneClass(tone)
          }`}
        >
          <span aria-hidden="true">{meta.icon}</span>
          {t(meta.labelKey)}
        </span>
      );
    };

    return (
      <tr
        key={diff.nodeId}
        data-compare-row={diff.nodeId}
        data-compare-diff={hasDiff ? 'true' : 'false'}
        className="border-b border-border last:border-0"
      >
        <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] text-foreground">
          {diff.nodeId}
        </td>
        <td className={`px-2 py-1.5 ${toneClass(statusTone1)}`}>
          {statusCell(diff.status1, statusTone1)}
        </td>
        <td className={`px-2 py-1.5 ${toneClass(statusTone2)}`}>
          {statusCell(diff.status2, statusTone2)}
        </td>
        <td
          className={`whitespace-nowrap px-2 py-1.5 text-right text-[10px] ${toneClass(durationTone1)}`}
        >
          {formatDuration(diff.duration1)}
        </td>
        <td
          className={`whitespace-nowrap px-2 py-1.5 text-right text-[10px] ${toneClass(durationTone2)}`}
        >
          {formatDuration(diff.duration2)}
        </td>
        <td
          className={`whitespace-nowrap px-2 py-1.5 text-right text-[10px] ${toneClass(costTone1)}`}
        >
          {formatNodeCost(diff.cost1)}
        </td>
        <td
          className={`whitespace-nowrap px-2 py-1.5 text-right text-[10px] ${toneClass(costTone2)}`}
        >
          {formatNodeCost(diff.cost2)}
        </td>
        <td className="min-w-40 px-2 py-1.5 align-top">
          {diff.outputsDiff === undefined ? (
            <span className="text-[10px] text-muted-foreground">
              {t('compare.no_diff')}
            </span>
          ) : (
            <pre
              data-compare-outputs={diff.nodeId}
              className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-red-50 p-1 text-[10px] text-red-700"
            >
              {diff.outputsDiff}
            </pre>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
      role="presentation"
      data-compare-modal-backdrop=""
    >
      <div
        className="flex max-h-[85vh] w-full max-w-6xl flex-col rounded-xl bg-background shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('compare.title')}
        data-compare-modal=""
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            {t('compare.title')}
          </h2>

          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded px-2 text-muted-foreground hover:text-foreground"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div className="min-h-24 flex-1 overflow-y-auto px-4 py-3">
          {isLoading && (
            <p
              className="text-xs text-muted-foreground"
              data-compare-loading=""
            >
              {t('common.loading')}
            </p>
          )}

          {!isLoading && error !== null && (
            <div className="flex flex-col gap-2" data-compare-error="">
              <p className="text-xs text-red-600">{error}</p>
              <button
                type="button"
                onClick={() => setReloadKey((value) => value + 1)}
                data-compare-retry=""
                className="w-fit cursor-pointer rounded-md bg-muted px-3 py-1 text-xs font-medium text-foreground hover:bg-border"
              >
                {t('history.retry')}
              </button>
            </div>
          )}

          {!isLoading && error === null && data !== null && (
            <>
              {/* Шапка: два запуска и их суммарные показатели. */}
              <div className="mb-3 grid grid-cols-2 gap-4 text-xs">
                <div
                  className="rounded-lg border border-border p-2"
                  data-compare-run1={data.run1.id}
                >
                  <p className="font-medium text-foreground">
                    {t('compare.run1')}
                  </p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                    {data.run1.id}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {t('compare.total_duration')}:{' '}
                    {formatDuration(data.run1.durationMs)} ·{' '}
                    {t('compare.total_cost')}:{' '}
                    {formatTotalCost(data.run1.costUsd, data.run1.costRub)}
                  </p>
                </div>

                <div
                  className="rounded-lg border border-border p-2"
                  data-compare-run2={data.run2.id}
                >
                  <p className="font-medium text-foreground">
                    {t('compare.run2')}
                  </p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                    {data.run2.id}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {t('compare.total_duration')}:{' '}
                    {formatDuration(data.run2.durationMs)} ·{' '}
                    {t('compare.total_cost')}:{' '}
                    {formatTotalCost(data.run2.costUsd, data.run2.costRub)}
                  </p>
                </div>
              </div>

              {/* Суммарные дельты `run2 − run1`. */}
              <div
                className="mb-3 flex flex-wrap gap-4 rounded-lg bg-muted px-3 py-2 text-[11px]"
                data-compare-total-diff=""
              >
                <span>
                  {t('compare.duration_delta')}:{' '}
                  <span
                    data-compare-delta-duration={
                      data.diffs.totalDiff.durationMs ?? 'null'
                    }
                    className={
                      data.diffs.totalDiff.durationMs === null
                        ? 'text-muted-foreground'
                        : deltaClass(data.diffs.totalDiff.durationMs)
                    }
                  >
                    {data.diffs.totalDiff.durationMs === null
                      ? '—'
                      : formatDuration(data.diffs.totalDiff.durationMs)}
                  </span>
                </span>
                <span>
                  {t('compare.cost_delta_usd')}:{' '}
                  <span
                    data-compare-delta-cost-usd={data.diffs.totalDiff.costUsd.toFixed(4)}
                    className={deltaClass(data.diffs.totalDiff.costUsd)}
                  >
                    {formatUsdDelta(data.diffs.totalDiff.costUsd)}
                  </span>
                </span>
                <span>
                  {t('compare.cost_delta_rub')}:{' '}
                  <span
                    data-compare-delta-cost-rub={data.diffs.totalDiff.costRub.toFixed(2)}
                    className={deltaClass(data.diffs.totalDiff.costRub)}
                  >
                    {formatRubDelta(data.diffs.totalDiff.costRub)}
                  </span>
                </span>
              </div>

              {data.diffs.nodeDiffs.length === 0 ? (
                <p
                  className="text-xs text-muted-foreground"
                  data-compare-empty=""
                >
                  {t('compare.no_nodes')}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                        <th rowSpan={2} className="px-2 py-1">
                          {t('compare.node')}
                        </th>
                        <th colSpan={3} className="px-2 py-1 text-center">
                          {t('compare.run1')}
                        </th>
                        <th colSpan={3} className="px-2 py-1 text-center">
                          {t('compare.run2')}
                        </th>
                        <th rowSpan={2} className="px-2 py-1">
                          {t('compare.diff')}
                        </th>
                      </tr>
                      <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-2 py-1">{t('status.label')}</th>
                        <th className="px-2 py-1 text-right">
                          {t('compare.duration')}
                        </th>
                        <th className="px-2 py-1 text-right">
                          {t('compare.cost')}
                        </th>
                        <th className="px-2 py-1">{t('status.label')}</th>
                        <th className="px-2 py-1 text-right">
                          {t('compare.duration')}
                        </th>
                        <th className="px-2 py-1 text-right">
                          {t('compare.cost')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>{data.diffs.nodeDiffs.map(renderRow)}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
