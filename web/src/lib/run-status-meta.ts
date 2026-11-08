import type { NodeRunStatus, RunStatus } from '@/types/run-stream';

/**
 * Визуальные метаданные статуса запуска (v1.4.0 S2).
 *
 * Раньше таблица истории держала этот словарь локально. С появлением
 * `RunCompareModal` те же иконки/цвета/подписи понадобились и в сравнении,
 * поэтому словарь вынесен в общий модуль: статус не может выглядеть
 * по-разному в истории и в diff.
 *
 * Подписи — общий неймспейс `status.*` (KI-545): TopBar, панель результата и
 * история/сравнение не расходятся в формулировках.
 */
export const RUN_STATUS_META: Record<
  RunStatus,
  { icon: string; className: string; labelKey: string }
> = {
  pending: {
    icon: '⏳',
    className: 'bg-muted text-muted-foreground',
    labelKey: 'status.pending',
  },
  running: {
    icon: '🔄',
    className: 'bg-blue-100 text-blue-700',
    labelKey: 'status.running',
  },
  completed: {
    icon: '✅',
    className: 'bg-green-100 text-green-700',
    labelKey: 'status.completed',
  },
  failed: {
    icon: '❌',
    className: 'bg-red-100 text-red-700',
    labelKey: 'status.failed',
  },
  cancelled: {
    icon: '⛔',
    className: 'bg-muted text-muted-foreground',
    labelKey: 'status.cancelled',
  },
};

/**
 * Метаданные статуса узла: статусы запуска + `skipped`.
 *
 * `skipped` — не статус запуска, а состояние узла, который не выполнялся
 * из-за упавшего предшественника (KI-288). Иконка/цвет — нейтральные: это не
 * ошибка самого узла.
 */
export const NODE_RUN_STATUS_META: Record<
  NodeRunStatus,
  { icon: string; className: string; labelKey: string }
> = {
  ...RUN_STATUS_META,
  skipped: {
    icon: '⏭',
    className: 'bg-amber-100 text-amber-700',
    labelKey: 'status.skipped',
  },
};
