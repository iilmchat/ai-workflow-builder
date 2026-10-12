import { useCallback, useEffect, useState } from 'react';
import {
  deleteWorkflowAsync,
  listWorkflowsAsync,
  type ApiWorkflow,
} from '@/lib/api';
import { useWorkflowStore } from '@/stores/workflow';

interface LoadModalProps {
  onClose: () => void;
}

/** Форматирует дату создания workflow для списка. */
function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'дата неизвестна';
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? 'дата неизвестна'
    : date.toLocaleString('ru-RU');
}

/**
 * Модальное окно со списком сохранённых workflow.
 *
 * Позволяет открыть или удалить workflow; закрывается по Escape, клику по
 * фону или кнопке «Отмена».
 */
export function LoadModal({ onClose }: LoadModalProps) {
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
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить список');
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
      setNotice({ kind: 'success', text: 'Workflow удалён' });
      await refreshAsync();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Не удалось удалить';
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
        className="flex max-h-[70vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl"
        // Клик внутри окна не должен закрывать его.
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Загрузить workflow"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Загрузить workflow</h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded px-2 text-slate-400 hover:text-slate-600"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        <div className="min-h-24 flex-1 overflow-y-auto px-4 py-3">
          {isLoading && <p className="text-xs text-slate-400">Загрузка…</p>}

          {error && !isLoading && (
            <p className="text-xs text-red-600">{error}</p>
          )}

          {!isLoading && !error && workflows.length === 0 && (
            <p className="text-xs text-slate-400">Сохранённых workflow пока нет</p>
          )}

          <ul className="flex flex-col gap-2">
            {workflows.map((workflow) => (
              <li
                key={workflow.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-700">
                    {workflow.name}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {formatDate(workflow.createdAt)} · узлов: {workflow.nodes.length}
                  </p>
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleOpen(workflow.id)}
                    className="cursor-pointer rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                  >
                    Открыть
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(workflow.id)}
                    className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Удалить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
