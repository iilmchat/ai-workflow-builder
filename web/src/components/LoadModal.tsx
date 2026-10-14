import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import {
  deleteWorkflowAsync,
  listWorkflowsAsync,
  type ApiWorkflow,
} from '@/lib/api';
import { useWorkflowStore } from '@/stores/workflow';

interface LoadModalProps {
  onClose: () => void;
}

/**
 * Форматирует дату создания workflow для списка.
 *
 * Локаль выбирается по текущему языку интерфейса, поэтому дата выглядит
 * привычно и в RU («14.10.2026, 12:00»), и в EN.
 */
function formatDate(value: string | null | undefined): string {
  if (!value) {
    return i18n.t('loadModal.date_unknown');
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? i18n.t('loadModal.date_unknown')
    : date.toLocaleString(i18n.language === 'en' ? 'en-US' : 'ru-RU');
}

/**
 * Модальное окно со списком сохранённых workflow.
 *
 * Позволяет открыть или удалить workflow; закрывается по Escape, клику по
 * фону или кнопке «Отмена».
 */
export function LoadModal({ onClose }: LoadModalProps) {
  const { t } = useTranslation();
  const loadWorkflowAsync = useWorkflowStore((state) => state.loadWorkflowAsync);
  const setNotice = useWorkflowStore((state) => state.setNotice);

  const [workflows, setWorkflows] = useState<ApiWorkflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Загружает список workflow. */
  const refreshAsync = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // userId пока не передаём: авторизации нет, показываем все workflow.
      setWorkflows(await listWorkflowsAsync());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('loadModal.list_failed'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAsync();
  }, [refreshAsync]);

  // Escape закрывает окно — это ожидаемое поведение модалки.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  /** Открывает выбранный workflow и закрывает окно. */
  const handleOpen = async (id: string) => {
    await loadWorkflowAsync(id);
    onClose();
  };

  /** Удаляет workflow и обновляет список. */
  const handleDelete = async (id: string) => {
    try {
      await deleteWorkflowAsync(id);
      setNotice({ kind: 'success', text: t('loadModal.deleted') });
      await refreshAsync();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t('loadModal.delete_failed');
      setError(message);
      setNotice({ kind: 'error', text: message });
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[70vh] w-full max-w-lg flex-col rounded-xl bg-background shadow-xl"
        // Клик внутри окна не должен закрывать его.
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('loadModal.title')}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{t('loadModal.title')}</h2>
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
            <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
          )}

          {error && !isLoading && (
            <p className="text-xs text-red-600">{error}</p>
          )}

          {!isLoading && !error && workflows.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('loadModal.empty')}</p>
          )}

          <ul className="flex flex-col gap-2">
            {workflows.map((workflow) => (
              <li
                key={workflow.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">
                    {workflow.name}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatDate(workflow.createdAt)} ·{' '}
                    {t('loadModal.nodes', { count: workflow.nodes.length })}
                  </p>
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleOpen(workflow.id)}
                    className="cursor-pointer rounded-md bg-muted px-3 py-1 text-xs font-medium text-foreground hover:bg-border"
                  >
                    {t('common.open')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(workflow.id)}
                    className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-border px-4 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
