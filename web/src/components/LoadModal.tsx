import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import {
  deleteWorkflowAsync,
  listWorkflowsAsync,
  type ApiWorkflow,
} from '@/lib/api';
import {
  fetchTemplatesAsync,
  instantiateTemplateAsync,
  type TemplateSummary,
} from '@/lib/export-import-api';
import { syncWorkflowUrlParam } from '@/lib/url-sync';
import { useWorkflowStore } from '@/stores/workflow';

interface LoadModalProps {
  onClose: () => void;
}

/** Вкладки модального окна: свои workflow и шаблоны из поставки (R6.6.2). */
type LoadTab = 'workflows' | 'templates';

/**
 * Иконки карточек шаблонов (слаг → emoji).
 *
 * Это представление, а не контракт: `GET /templates` отдаёт только
 * `id`/`name`/`description`/`nodeCount`, поэтому иконку выбирает UI, а
 * неизвестный слаг (новый шаблон в поставке) получает общую иконку.
 */
const TEMPLATE_ICONS: Record<string, string> = {
  'text-llm': '📝',
  'text-llm-image': '🖼',
  'http-llm': '🌐',
};

/** Иконка шаблона, которого нет в {@link TEMPLATE_ICONS}. */
const DEFAULT_TEMPLATE_ICON = '📄';

/**
 * Возвращает иконку карточки шаблона.
 *
 * @param id - слаг шаблона (`text-llm`, `http-llm`, …)
 * @returns emoji для карточки
 */
function templateIconOf(id: string): string {
  return TEMPLATE_ICONS[id] ?? DEFAULT_TEMPLATE_ICON;
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
 * Модальное окно загрузки: вкладки «Мои workflow» и «Шаблоны» (R6.6.2).
 *
 * Первая вкладка — список сохранённых workflow (открыть/удалить), вторая —
 * шаблоны из поставки (`GET /templates`) с созданием workflow по клику.
 * Закрывается по Escape, клику по фону или кнопке «Отмена».
 */
export function LoadModal({ onClose }: LoadModalProps) {
  const { t } = useTranslation();
  const loadWorkflowAsync = useWorkflowStore((state) => state.loadWorkflowAsync);
  const setNotice = useWorkflowStore((state) => state.setNotice);

  const [tab, setTab] = useState<LoadTab>('workflows');
  const [workflows, setWorkflows] = useState<ApiWorkflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [isTemplatesLoading, setIsTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  // Слаг шаблона, который сейчас создаётся: карточка показывает спиннер, а
  // повторный клик по ней блокируется.
  const [openingTemplateId, setOpeningTemplateId] = useState<string | null>(null);

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

  // Шаблоны грузим лениво — при первом открытии вкладки: за пользователя,
  // который пришёл открыть свой workflow, лишний запрос не нужен.
  useEffect(() => {
    if (tab !== 'templates') {
      return;
    }

    let cancelled = false;

    setIsTemplatesLoading(true);
    setTemplatesError(null);

    fetchTemplatesAsync()
      .then((list) => {
        if (!cancelled) {
          setTemplates(list);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setTemplatesError(
            caught instanceof Error
              ? caught.message
              : i18n.t('loadModal.templates.load_failed'),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsTemplatesLoading(false);
        }
      });

    // Размонтирование/смена вкладки до ответа: состояние уже не нужно.
    return () => {
      cancelled = true;
    };
  }, [tab]);

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

  /**
   * Создаёт workflow из шаблона и открывает его (R6.6.2).
   *
   * Окно закрываем только при успехе: при сбое причина остаётся видимой в
   * самой вкладке, а не исчезает вместе с модалкой.
   *
   * @param id - слаг шаблона
   */
  const handleOpenTemplate = async (id: string) => {
    setOpeningTemplateId(id);

    try {
      const created = await instantiateTemplateAsync(id);

      // A3: id — в адресную строку, чтобы F5 вернул тот же граф.
      syncWorkflowUrlParam(created.id);
      await loadWorkflowAsync(created.id);

      if (useWorkflowStore.getState().currentWorkflowId === created.id) {
        setNotice({
          kind: 'success',
          text: t('toast.template.success', { name: created.name }),
        });
        onClose();
      }
    } catch (caught) {
      const message = t('toast.template.error', {
        reason: caught instanceof Error ? caught.message : i18n.t('error.unknown'),
      });

      setTemplatesError(message);
      setNotice({ kind: 'error', text: message });
    } finally {
      setOpeningTemplateId(null);
    }
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

  /**
   * Классы кнопки вкладки.
   *
   * @param isActive - выбрана ли вкладка
   * @returns список классов для `className`
   */
  const tabClassName = (isActive: boolean): string =>
    `cursor-pointer border-b-2 px-3 py-2 text-xs font-medium ${
      isActive
        ? 'border-primary text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground'
    }`;

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

        {/* R6.6.2: вкладки «Мои workflow» / «Шаблоны». */}
        <div className="flex gap-1 border-b border-border px-2" role="tablist">
          <button
            type="button"
            role="tab"
            data-load-tab="workflows"
            aria-selected={tab === 'workflows'}
            onClick={() => setTab('workflows')}
            className={tabClassName(tab === 'workflows')}
          >
            {t('loadModal.tab.workflows')}
          </button>
          <button
            type="button"
            role="tab"
            data-load-tab="templates"
            aria-selected={tab === 'templates'}
            onClick={() => setTab('templates')}
            className={tabClassName(tab === 'templates')}
          >
            {t('loadModal.tab.templates')}
          </button>
        </div>

        <div className="min-h-24 flex-1 overflow-y-auto px-4 py-3">
          {tab === 'workflows' && (
            <>
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
            </>
          )}

          {tab === 'templates' && (
            <>
              {isTemplatesLoading && (
                <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
              )}

              {templatesError && !isTemplatesLoading && (
                <p className="text-xs text-red-600">{templatesError}</p>
              )}

              {!isTemplatesLoading && !templatesError && templates.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('loadModal.templates.empty')}
                </p>
              )}

              <ul className="flex flex-col gap-2">
                {templates.map((template) => (
                  // Кнопка, а не div: карточка обязана быть доступна с
                  // клавиатуры (Tab + Enter), как кнопки списка workflow (KI-162).
                  <li key={template.id}>
                    <button
                      type="button"
                      data-template-id={template.id}
                      disabled={openingTemplateId !== null}
                      onClick={() => void handleOpenTemplate(template.id)}
                      className="flex w-full cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="text-base" aria-hidden="true">
                        {openingTemplateId === template.id ? '⏳' : templateIconOf(template.id)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {template.name}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          {template.description}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          {t('loadModal.templates.nodeCount', {
                            count: template.nodeCount,
                          })}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
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
