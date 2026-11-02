import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { fetchWorkflowRunsAsync, type ApiRunSummary } from '@/lib/api';
import { setRunIdInUrl } from '@/lib/url-sync';
import { useWorkflowStore } from '@/stores/workflow';
import type { RunStatus } from '@/types/run-stream';

/** Сколько запусков запрашивается на одну страницу истории. */
const PAGE_SIZE = 20;

/**
 * Внешний вид статуса запуска в истории: иконка, цвет бейджа и ключ подписи.
 *
 * Подписи — общий неймспейс `status.*` (v0.16 S1, KI-545): TopBar, панель
 * результата и история больше не расходятся в формулировках. Цвета —
 * статусные классы того же визуального языка.
 */
const HISTORY_STATUS_META: Record<
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
 * Форматирует ISO-дату запуска под текущий язык интерфейса.
 *
 * @param value - ISO-строка из `RunSummary.createdAt`
 * @returns дата/время в локали UI; подпись «дата неизвестна» для битой строки
 */
function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return i18n.t('history.date_unknown');
  }

  return date.toLocaleString(i18n.language === 'en' ? 'en-US' : 'ru-RU');
}

/**
 * Форматирует длительность запуска.
 *
 * Секунды — с одним знаком после запятой (`1.5 с`): миллисекундная точность в
 * списке не нужна, но и «2 с» для 1.5 с скрывало бы разницу. Длинные запуски
 * показываются в минутах и секундах.
 *
 * @param durationMs - длительность из `RunSummary.durationMs`
 * @returns подпись длительности; «—», пока запуск не завершён
 */
function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return '—';
  }

  if (durationMs < 1_000) {
    return i18n.t('history.duration_ms', { ms: durationMs });
  }

  const totalSeconds = durationMs / 1_000;

  // 59.95 с и больше — это уже минута: иначе `toFixed(1)` дал бы «60.0 с», а
  // округление секунд в минутной ветке могло дать «1 мин 60 с».
  if (totalSeconds < 59.95) {
    return i18n.t('history.duration_s', { seconds: totalSeconds.toFixed(1) });
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);

  if (seconds === 60) {
    return i18n.t('history.duration_m', { minutes: minutes + 1, seconds: 0 });
  }

  return i18n.t('history.duration_m', { minutes, seconds });
}

/**
 * Форматирует стоимости запуска в одной строке (RULES 4.23: валюты не
 * смешиваются).
 *
 * USD — 4 знака (доли цента LLM-вызова), RUB — 2 знака (копейки). Нулевые
 * валюты не показываются: «$0.0000 + 0.00 ₽» только шумит. Запуск совсем без
 * трат отдаёт `$0.0000` — это честный ноль, а не «нет данных».
 *
 * @param costUsd - стоимость в USD
 * @param costRub - стоимость в рублях
 * @returns строка вида `$0.0123` или `$0.0123 + 25.50 ₽`
 */
function formatCost(costUsd: number, costRub: number): string {
  const parts: string[] = [];

  if (costUsd > 0) {
    parts.push(`$${costUsd.toFixed(4)}`);
  }

  if (costRub > 0) {
    parts.push(`${costRub.toFixed(2)} ₽`);
  }

  return parts.length > 0 ? parts.join(' + ') : '$0.0000';
}

/** Пропсы модального окна истории запусков. */
interface RunHistoryModalProps {
  /** uuid сохранённого workflow, чью историю показываем. */
  workflowId: string;
  /** Закрывает окно (Escape, клик по фону, крестик, «Отмена»). */
  onClose: () => void;
}

/**
 * Модальное окно истории запусков workflow (v0.14 S2, DESIGN V014 § 3.2).
 *
 * Список запусков: статус (иконка + цвет), дата, длительность и стоимость.
 * Пагинация — **keyset по курсору** (v0.16 S1, KI-542): первая страница без
 * `cursor`, далее — `runs.at(-1).cursor`; кнопка «Загрузить ещё» догружает
 * следующую страницу и дописывает её к списку. Offset-окно сдвигалось при
 * появлении новых запусков — keyset от этого не страдает.
 *
 * Клик по запуску закрывает окно, пишет `?runId=` в адресную строку
 * (`replaceState`, KI-541), сбрасывает выбранный узел и восстанавливает запуск
 * в сторе (`restoreRunAsync` с `preserveRunIdInUrl`): после F5 панель
 * результата восстанавливается, а не теряется.
 *
 * Почему **не** отдельная страница: история — это способ открыть прошлый
 * результат, не уходя с холста; модалка сохраняет граф и текущую сессию, как
 * `LoadModal`/`ShareModal`.
 */
export function RunHistoryModal({ workflowId, onClose }: RunHistoryModalProps) {
  const { t } = useTranslation();
  const restoreRunAsync = useWorkflowStore((state) => state.restoreRunAsync);
  const setSelectedNodeId = useWorkflowStore(
    (state) => state.setSelectedNodeId,
  );

  const [runs, setRuns] = useState<ApiRunSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  // Счётчик повторных загрузок первой страницы: после ошибки `useEffect` не
  // перезапустить по неизменным зависимостям, поэтому retry — отдельное
  // состояние.
  const [reloadKey, setReloadKey] = useState(0);

  /**
   * Загружает первую страницу истории (или повторяет её после ошибки).
   *
   * Флаг `cancelled` гасит поздний ответ: пока запрос в полёте, пользователь
   * мог закрыть модалку.
   */
  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    setError(null);
    setLoadMoreError(null);

    fetchWorkflowRunsAsync(workflowId, PAGE_SIZE)
      .then((page) => {
        if (!cancelled) {
          setRuns(page.runs);
          setNextCursor(page.nextCursor);
          setTotal(page.total);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          const reason =
            caught instanceof Error ? caught.message : i18n.t('error.unknown');
          setError(i18n.t('history.load_failed', { reason }));
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
  }, [workflowId, reloadKey]);

  // Escape закрывает окно — то же поведение, что у LoadModal/ShareModal.
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
   * Есть ли следующая страница.
   *
   * Источник истины — `nextCursor` сервера (выборка `limit + 1`), а не
   * `runs.length < total`: `total` может опережать список, если между
   * запросами появились новые запуски, и кнопка «Загрузить ещё» зациклилась бы
   * на пустой странице.
   */
  const hasMore = nextCursor !== null;

  /**
   * Догружает следующую страницу по курсору и дописывает её к списку.
   *
   * Дубли по `id` отбрасываются: между запросами запуск мог появиться в обеих
   * страницах только при ошибке сервера, но защита дешёвая.
   */
  const handleLoadMore = useCallback(() => {
    if (nextCursor === null || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);
    setLoadMoreError(null);

    fetchWorkflowRunsAsync(workflowId, PAGE_SIZE, nextCursor)
      .then((page) => {
        setTotal(page.total);
        setNextCursor(page.nextCursor);
        setRuns((previous) => {
          const seen = new Set(previous.map((run) => run.id));
          const merged = [...previous];

          for (const run of page.runs) {
            if (!seen.has(run.id)) {
              seen.add(run.id);
              merged.push(run);
            }
          }

          return merged;
        });
      })
      .catch((caught: unknown) => {
        const reason =
          caught instanceof Error ? caught.message : i18n.t('error.unknown');
        setLoadMoreError(i18n.t('history.load_more_failed', { reason }));
      })
      .finally(() => {
        setIsLoadingMore(false);
      });
  }, [workflowId, nextCursor, isLoadingMore]);

  /**
   * Открывает запуск: закрывает историю, пишет `?runId=` и восстанавливает
   * запуск в сторе.
   *
   * `setRunIdInUrl` — `history.replaceState`: адрес получает `?runId=` ещё до
   * `restoreRunAsync`. Стор вызывается с `preserveRunIdInUrl`, поэтому для
   * терминального запуска параметр не удаляется и F5 восстанавливает панель
   * (KI-541).
   *
   * Узел сбрасывается до `restoreRunAsync`: иначе панель результата показала бы
   * данные узла из **другого** запуска, а не сводку выбранного (панель
   * намеренно не сбрасывает `selectedNodeId` при старте нового запуска).
   *
   * @param run - выбранный элемент истории
   */
  const handleOpenRun = (run: ApiRunSummary) => {
    onClose();
    // KI-541: шанс на восстановление после F5 даже до ответа restoreRunAsync.
    setRunIdInUrl(run.id);
    setSelectedNodeId(null);
    // Промис не ждём: модалка уже закрыта, а панель результата обновится по
    // мере ответов `restoreRunAsync` (свои ошибки он показывает уведомлением).
    void restoreRunAsync(run.id, { preserveRunIdInUrl: true });
  };

  /** Перезапрашивает первую страницу после ошибки. */
  const handleRetry = () => {
    setReloadKey((value) => value + 1);
  };

  return (
    <div
      // Модалка — оверлей поверх редактора (канвас, панель результата), но ниже
      // Toast'а: уведомление об ошибке восстановления запуска (z-50) должно
      // оставаться видимым и не перекрываться фоном модалки.
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
      role="presentation"
      data-history-modal-backdrop=""
    >
      <div
        className="flex max-h-[70vh] w-full max-w-2xl flex-col rounded-xl bg-background shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('history.title')}
        data-history-modal=""
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            {t('history.title')}
          </h2>

          <div className="flex items-center gap-2">
            <span
              className="text-[10px] text-muted-foreground"
              data-history-total={total}
            >
              {t('history.total', { total })}
            </span>

            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded px-2 text-muted-foreground hover:text-foreground"
              aria-label={t('common.close')}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Заголовок «таблицы»: колонки те же, что у кнопок-строк ниже. */}
        <div className="grid grid-cols-[110px_1fr_110px_140px] gap-2 border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>{t('status.label')}</span>
          <span>{t('history.date')}</span>
          <span className="text-right">{t('history.duration')}</span>
          <span className="text-right">{t('history.cost')}</span>
        </div>

        <div className="min-h-24 flex-1 overflow-y-auto px-2 py-2">
          {isLoading && (
            <p
              className="px-2 py-1 text-xs text-muted-foreground"
              data-history-loading=""
            >
              {t('common.loading')}
            </p>
          )}

          {!isLoading && error !== null && (
            <div
              className="flex flex-col gap-2 px-2 py-1"
              data-history-error=""
            >
              <p className="text-xs text-red-600">{error}</p>
              <button
                type="button"
                onClick={handleRetry}
                data-history-retry=""
                className="w-fit cursor-pointer rounded-md bg-muted px-3 py-1 text-xs font-medium text-foreground hover:bg-border"
              >
                {t('history.retry')}
              </button>
            </div>
          )}

          {!isLoading && error === null && runs.length === 0 && (
            <p
              className="px-2 py-1 text-xs text-muted-foreground"
              data-history-empty=""
            >
              {t('history.empty')}
            </p>
          )}

          {!isLoading && error === null && (
            <ul className="flex flex-col">
              {runs.map((run) => {
                const meta = HISTORY_STATUS_META[run.status];

                return (
                  <li key={run.id}>
                    {/* Кнопка, а не строка таблицы: вся строка доступна с
                        клавиатуры (Tab + Enter), как карточки в LoadModal. */}
                    <button
                      type="button"
                      data-history-run={run.id}
                      data-history-status={run.status}
                      onClick={() => handleOpenRun(run)}
                      aria-label={t('history.open_run', { id: run.id })}
                      className="grid w-full cursor-pointer grid-cols-[110px_1fr_110px_140px] items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-muted"
                    >
                      <span
                        className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.className}`}
                      >
                        <span aria-hidden="true">{meta.icon}</span>
                        {t(meta.labelKey)}
                      </span>

                      <span className="truncate text-muted-foreground">
                        {formatDate(run.createdAt)}
                      </span>

                      <span className="text-right text-muted-foreground">
                        {formatDuration(run.durationMs)}
                      </span>

                      <span className="text-right font-medium text-foreground">
                        {formatCost(run.costUsd, run.costRub)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!isLoading && error === null && loadMoreError !== null && (
            <div
              className="mt-2 flex flex-col gap-2 px-2 py-1"
              data-history-load-more-error=""
            >
              <p className="text-xs text-red-600">{loadMoreError}</p>
              <button
                type="button"
                onClick={handleLoadMore}
                data-history-load-more-retry=""
                className="w-fit cursor-pointer rounded-md bg-muted px-3 py-1 text-xs font-medium text-foreground hover:bg-border"
              >
                {t('history.retry')}
              </button>
            </div>
          )}
        </div>

        {/* Футер — только когда первая страница загружена без ошибки: иначе
            при isLoading `nextCursor === null` и мы бы показали «Показано 0 из 0»
            рядом с «Загрузка…». */}
        {!isLoading && error === null && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <span
              className="text-[10px] text-muted-foreground"
              data-history-loaded={runs.length}
              data-history-total-counter={total}
            >
              {t('history.loaded', { loaded: runs.length, total })}
            </span>

            {hasMore ? (
              <button
                type="button"
                data-history-load-more=""
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoadingMore ? t('common.loading') : t('history.load_more')}
              </button>
            ) : (
              <span
                className="text-[10px] text-muted-foreground"
                data-history-end=""
              >
                {t('history.end')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
