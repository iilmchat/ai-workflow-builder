import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { nodeTypes } from '@/components/nodes';
import { ApiError } from '@/lib/api';
import { FIT_VIEW_OPTIONS } from '@/lib/fit-view-options';
import { fetchSharedWorkflowAsync, type SharedWorkflow } from '@/lib/share-api';
import { isValidShareToken } from '@/lib/share-url';
import type { AppNode } from '@/types/graph';
import type { Edge } from '@xyflow/react';

/**
 * Публичная страница просмотра графа по share-ссылке (R6.2.2).
 *
 * Маршрут `/workflow/share/:token` **без** `ProtectedRoute` и без TopBar:
 * доступ даёт сам токен. Редактор не переиспользуется — правки и запуски в
 * read-only режиме запрещены, поэтому граф рендерится «сырым» React Flow с
 * отключёнными взаимодействиями, а поверх стоит баннер.
 *
 * @returns разметка страницы просмотра
 */
export function ShareViewPage() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const [workflow, setWorkflow] = useState<SharedWorkflow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isValidShareToken(token)) {
      setError(t('share.error.notFound'));
      setIsLoading(false);

      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const data = await fetchSharedWorkflowAsync(token);

        if (!cancelled) {
          setWorkflow(data);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof ApiError && caught.status === 404
              ? t('share.error.notFound')
              : t('share.error.network'),
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, t]);

  // Данные пришли из БД владельца в форме узлов графа: форма та же, что у
  // AppNode (валидация графа живёт в движке), поэтому приведение безопасно.
  const nodes = useMemo(() => (workflow?.nodes ?? []) as unknown as AppNode[], [workflow]);
  const edges = useMemo(() => (workflow?.edges ?? []) as unknown as Edge[], [workflow]);

  return (
    <div className="flex h-screen w-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
        <span aria-hidden="true">🔒</span>
        <span
          data-readonly-banner=""
          className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
        >
          {t('share.readOnly.banner')}
        </span>
        <span className="truncate text-sm font-medium text-foreground">
          {workflow?.name ?? ''}
        </span>
        <button
          type="button"
          disabled
          data-copy-to-mine=""
          title={t('share.copyToMine.soon')}
          className="ml-auto cursor-not-allowed rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground opacity-60"
        >
          {t('share.copyToMine')}
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        {isLoading && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {t('common.loading')}
          </p>
        )}

        {error !== null && (
          <p
            role="alert"
            data-share-error=""
            className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-red-600"
          >
            {error}
          </p>
        )}

        {workflow !== null && (
          // pointer-events-none: read-only — узлы нельзя двигать, а поля внутри
          // карточек (textarea/select) не должны принимать ввод.
          <div className="pointer-events-none h-full w-full select-none">
            <ReactFlowProvider>
              {/* KI-310: булев `fitView` использует `fitViewOptions` из
                  store, которого у публичной страницы нет, — опции приходят
                  из общего модуля (`minZoom: 0.02`), иначе граф с большим
                  разбросом остаётся за кадром (store-дефолт 0.5).
                  `<Controls>` здесь не рендерится: просмотр read-only. */}
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                fitViewOptions={FIT_VIEW_OPTIONS}
                fitView
              />
            </ReactFlowProvider>
          </div>
        )}
      </div>
    </div>
  );
}
