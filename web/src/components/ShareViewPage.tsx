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
 * отключёнными правками (узлы не двигаются и не соединяются), а поверх стоит
 * баннер. Навигация по холсту (wheel-zoom, pan) при этом работает: без неё
 * граф с большим разбросом невозможно рассмотреть (KI-329).
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
          // KI-329: `pointer-events-none` на обёртке гасил **всё** — wheel-zoom
          // и pan тонули вместе с перетаскиванием узлов, поэтому граф с большим
          // разбросом нельзя было рассмотреть (в связке с KI-328).
          // Read-only теперь выражают пропсы `<ReactFlow>` (узлы не тащатся и
          // не соединяются), а ввод в поля карточек запрещён точечно: у
          // `input`/`textarea`/`select` внутри узлов отключены pointer-events.
          // Кнопки-переключатели (например «развернуть» у system-промпта)
          // остаются рабочими: это просмотр, а не правка графа.
          <div className="h-full w-full select-none [&_input]:pointer-events-none [&_select]:pointer-events-none [&_textarea]:pointer-events-none">
            <ReactFlowProvider>
              {/* KI-310: булев `fitView` использует `fitViewOptions` из
                  store, которого у публичной страницы нет, — опции приходят
                  из общего модуля (`minZoom: 0.005`, KI-314), иначе граф с
                  большим разбросом остаётся за кадром (store-дефолт 0.5).
                  `<Controls>` здесь не рендерится: просмотр read-only. */}
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                // KI-329: просмотр без правок, но с навигацией по холсту.
                // `elementsSelectable` оставлен включённым: клик по узлу — способ
                // осмотреть карточку, а не изменить граф.
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                panOnDrag
                zoomOnScroll
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
