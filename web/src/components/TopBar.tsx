import { useState } from 'react';
import { useWorkflowStore } from '@/stores/workflow';
import { LoadModal } from './LoadModal';

/** Простой индикатор занятости для кнопок. */
function Spinner() {
  return (
    <span
      className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
  );
}

/**
 * Верхняя панель редактора: имя workflow и действия Save / Load / Run.
 *
 * Позиционируется фиксированно (56px), канвас занимает остальное место.
 */
export function TopBar() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const name = useWorkflowStore((state) => state.currentWorkflowName);
  const setCurrentWorkflowName = useWorkflowStore(
    (state) => state.setCurrentWorkflowName,
  );
  const isSaving = useWorkflowStore((state) => state.isSaving);
  const isLoading = useWorkflowStore((state) => state.isLoading);
  const saveWorkflowAsync = useWorkflowStore((state) => state.saveWorkflowAsync);
  const runPlanAsync = useWorkflowStore((state) => state.runPlanAsync);

  const isBusy = isSaving || isLoading;

  /**
   * Сохраняет граф. После первого сохранения id попадает в URL, чтобы
   * страницу можно было перезагрузить и вернуться к тому же workflow.
   */
  const handleSave = async () => {
    const idBefore = useWorkflowStore.getState().currentWorkflowId;

    await saveWorkflowAsync();

    const idAfter = useWorkflowStore.getState().currentWorkflowId;

    if (!idBefore && idAfter) {
      const url = new URL(window.location.href);
      url.searchParams.set('workflowId', idAfter);
      window.history.replaceState(null, '', url);
    }
  };

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <span className="text-sm" aria-hidden="true">
          🧩
        </span>

        <input
          value={name}
          onChange={(event) => setCurrentWorkflowName(event.target.value)}
          placeholder="Название workflow"
          aria-label="Название workflow"
          // nodrag: единое правило для всех input внутри редактора.
          className="nodrag w-64 rounded-lg border border-transparent px-2 py-1 text-sm font-medium text-slate-700 outline-none hover:border-slate-200 focus:border-slate-300"
        />

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            disabled={isBusy}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? <Spinner /> : <span aria-hidden="true">📂</span>}
            Load
          </button>

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isBusy}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <Spinner /> : <span aria-hidden="true">💾</span>}
            Save
          </button>

          <button
            type="button"
            onClick={() => void runPlanAsync()}
            disabled={isBusy}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? <Spinner /> : <span aria-hidden="true">▶️</span>}
            Run
          </button>
        </div>
      </header>

      {isModalOpen && <LoadModal onClose={() => setIsModalOpen(false)} />}
    </>
  );
}
