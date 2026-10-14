import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { setLanguage, type Language } from '@/i18n';
import { useTheme } from '@/hooks/use-theme';
import { nodeLabelOf } from '@/lib/node-registry';
import { useWorkflowStore } from '@/stores/workflow';
import type { RunStatus } from '@/types/run-stream';
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

/** Статусы, при которых запуск уже идёт и повторный запуск запрещён. */
const ACTIVE_RUN_STATUSES: ReadonlySet<RunStatus> = new Set(['pending', 'running']);

/** Подпись и цвет бейджа статуса запуска. */
const RUN_STATUS_STYLE: Record<RunStatus, { labelKey: string; className: string }> = {
  pending: { labelKey: 'run.status.pending', className: 'bg-muted text-muted-foreground' },
  running: { labelKey: 'run.status.running', className: 'bg-blue-100 text-blue-700' },
  completed: { labelKey: 'run.status.completed', className: 'bg-green-100 text-green-700' },
  failed: { labelKey: 'run.status.failed', className: 'bg-red-100 text-red-700' },
  cancelled: { labelKey: 'run.status.cancelled', className: 'bg-muted text-muted-foreground' },
};

/**
 * Собирает подпись статуса запуска.
 *
 * @param status - статус запуска (null — запуск не выполнялся)
 * @param attemptNumber - номер текущей попытки job'а (1-based)
 * @param attempts - лимит попыток job'а (null — неизвестен)
 * @returns текст для кнопки Run
 */
function runStatusText(
  status: RunStatus | null,
  attemptNumber: number,
  attempts: number | null,
): string {
  if (status === null) {
    return i18n.t('topbar.run');
  }

  const base = i18n.t(RUN_STATUS_STYLE[status].labelKey);

  // Промежуточный провал (KI-070) статус не меняет: он остаётся 'running',
  // поэтому подпись продолжает показывать номер попытки.
  if (status === 'running' && attempts !== null && attemptNumber > 0) {
    return i18n.t('run.status.attempt', {
      base,
      current: attemptNumber,
      total: attempts,
    });
  }

  return base;
}

/**
 * Пишет id workflow в адресную строку.
 *
 * После перезагрузки страница вернётся к тому же workflow (App читает
 * `?workflowId=`).
 *
 * @param workflowId - id сохранённого workflow
 */
function syncWorkflowUrlParam(workflowId: string): void {
  const url = new URL(window.location.href);

  url.searchParams.set('workflowId', workflowId);
  window.history.replaceState(null, '', url);
}

/**
 * Верхняя панель редактора: имя workflow и действия Save / Load / Run.
 *
 * Run запускает реальный прогон (`POST /runs` + SSE, R4.2) и показывает статус:
 * «Создаётся…», «Выполняется… (попытка N/M)», «Готово», «Ошибка».
 * Панель — обычный flex-элемент колонки приложения (не fixed), её высота 56px.
 */
export function TopBar() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { resolved, setTheme } = useTheme();
  const { t, i18n: i18nInstance } = useTranslation();
  const currentLang = i18nInstance.language as Language;

  const name = useWorkflowStore((state) => state.currentWorkflowName);
  const setCurrentWorkflowName = useWorkflowStore(
    (state) => state.setCurrentWorkflowName,
  );
  const isSaving = useWorkflowStore((state) => state.isSaving);
  const isLoading = useWorkflowStore((state) => state.isLoading);
  const saveWorkflowAsync = useWorkflowStore((state) => state.saveWorkflowAsync);
  const startRunAsync = useWorkflowStore((state) => state.startRunAsync);
  const setNotice = useWorkflowStore((state) => state.setNotice);
  const runStatus = useWorkflowStore((state) => state.runStatus);
  const runError = useWorkflowStore((state) => state.runError);
  const attemptNumber = useWorkflowStore((state) => state.attemptNumber);
  const attempts = useWorkflowStore((state) => state.attempts);
  const runHasMoreAttempts = useWorkflowStore((state) => state.runHasMoreAttempts);

  const isBusy = isSaving || isLoading;
  const isRunActive = runStatus !== null && ACTIVE_RUN_STATUSES.has(runStatus);
  const runLabel = runStatusText(runStatus, attemptNumber, attempts);

  /**
   * Ищет LLM-узлы, модель которых недоступна (KI-074).
   *
   * Граф с такой моделью гарантированно упадёт в узле с «Модель не
   * поддерживается», поэтому запуск блокируется до выбора модели из списка.
   *
   * @returns подписи узлов с недоступной моделью (пусто — запускать можно)
   */
  const findNodesWithUnavailableModel = (): string[] => {
    const { nodes, llmModels } = useWorkflowStore.getState();

    return nodes
      .filter((node) => node.data.kind === 'llm')
      .filter((node) => !llmModels.some((model) => model.id === node.data.model))
      .map((node) => nodeLabelOf(node, node.id));
  };

  /**
   * Ищет image-узлы без выбранной media-модели (v0.6.0b.2.3).
   *
   * Backend выполнит узел только с известной моделью каталога, поэтому запуск
   * блокируется: иначе узел упадёт с «Модель не поддерживается».
   *
   * @returns подписи узлов без доступной модели (пусто — запускать можно)
   */
  const findImageNodesWithoutModel = (): string[] => {
    const { nodes, mediaModels } = useWorkflowStore.getState();

    return nodes
      .filter((node) => node.data.kind === 'image')
      .filter((node) => !mediaModels.some((model) => model.id === node.data.model))
      .map((node) => nodeLabelOf(node, node.id));
  };

  /**
   * Сохраняет граф. После первого сохранения id попадает в URL, чтобы
   * страницу можно было перезагрузить и вернуться к тому же workflow.
   */
  const handleSave = async () => {
    const idBefore = useWorkflowStore.getState().currentWorkflowId;

    await saveWorkflowAsync();

    const idAfter = useWorkflowStore.getState().currentWorkflowId;

    if (!idBefore && idAfter) {
      syncWorkflowUrlParam(idAfter);
    }
  };

  /**
   * Запускает workflow. Несохранённый граф сначала сохраняется: `POST /runs`
   * требует id из БД, а backend выполняет снимок графа из сохранённого workflow.
   */
  const handleRun = async () => {
    // KI-074: сначала проверяем модели — граф с недоступной моделью упадёт.
    const unavailableNodes = findNodesWithUnavailableModel();

    if (unavailableNodes.length > 0) {
      setNotice({
        kind: 'error',
        text: t('topbar.models_unavailable', {
          nodes: unavailableNodes.join(', '),
        }),
      });

      return;
    }

    // v0.6.0b.2.3: у image-узлов должна быть выбрана media-модель.
    const nodesWithoutMediaModel = findImageNodesWithoutModel();

    if (nodesWithoutMediaModel.length > 0) {
      setNotice({
        kind: 'error',
        text: t('topbar.image_models_missing', {
          nodes: nodesWithoutMediaModel.join(', '),
        }),
      });

      return;
    }

    let workflowId = useWorkflowStore.getState().currentWorkflowId;

    if (!workflowId) {
      await saveWorkflowAsync();
      workflowId = useWorkflowStore.getState().currentWorkflowId;

      if (workflowId) {
        syncWorkflowUrlParam(workflowId);
      }
    }

    if (!workflowId) {
      // Сохранение не удалось: причина уже показана уведомлением из стора.
      return;
    }

    await startRunAsync(workflowId);
  };

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
        <span className="text-sm" aria-hidden="true">
          🧩
        </span>

        <input
          value={name}
          onChange={(event) => setCurrentWorkflowName(event.target.value)}
          placeholder={t('topbar.name.placeholder')}
          aria-label={t('topbar.name.placeholder')}
          // nodrag: единое правило для всех input внутри редактора.
          className="nodrag w-64 rounded-lg border border-transparent px-2 py-1 text-sm font-medium text-foreground outline-none hover:border-border focus:border-primary focus:ring-1 focus:ring-primary"
        />

        {runStatus !== null && (
          <span
            data-run-badge={runStatus}
            // Тултип: причина ошибки либо подсказка, что будет ещё попытка (KI-070).
            title={
              runError ??
              (runHasMoreAttempts ? t('topbar.retry_hint') : undefined)
            }
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${RUN_STATUS_STYLE[runStatus].className}`}
          >
            {runLabel}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
            aria-label={t(
              resolved === 'dark' ? 'topbar.theme.to_light' : 'topbar.theme.to_dark',
            )}
            title={t(
              resolved === 'dark' ? 'topbar.theme.to_light' : 'topbar.theme.to_dark',
            )}
            className="cursor-pointer rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          >
            {resolved === 'dark' ? '☀' : '🌙'}
          </button>

          <button
            type="button"
            onClick={() => setLanguage(currentLang === 'ru' ? 'en' : 'ru')}
            aria-label={t('topbar.lang.toggle')}
            title={t('topbar.lang.toggle')}
            className="cursor-pointer rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            {currentLang === 'ru' ? 'EN' : 'RU'}
          </button>

          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            disabled={isBusy}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? <Spinner /> : <span aria-hidden="true">📂</span>}
            {t('topbar.load')}
          </button>

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isBusy}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <Spinner /> : <span aria-hidden="true">💾</span>}
            {t('topbar.save')}
          </button>

          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={isBusy || isRunActive}
            // Атрибут для e2e/smoke: статус запуска виден без разбора текста.
            data-run-status={runStatus ?? 'idle'}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunActive ? <Spinner /> : <span aria-hidden="true">▶️</span>}
            {runLabel}
          </button>
        </div>
      </header>

      {isModalOpen && <LoadModal onClose={() => setIsModalOpen(false)} />}
    </>
  );
}
