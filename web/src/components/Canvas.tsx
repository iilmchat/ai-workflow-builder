import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useReactFlow,
  type DefaultEdgeOptions,
  type Node,
} from '@xyflow/react';
import {
  INSERTABLE_EDGE_TYPE,
  InsertableEdge,
} from '@/components/edges/InsertableEdge';
import { nodeTypes } from '@/components/nodes';
import { NodeCatalogPopover } from '@/components/NodeCatalogPopover';
import { useDebouncedEffect } from '@/hooks/use-debounced-effect';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { FIT_SELECTION_OPTIONS, FIT_VIEW_OPTIONS } from '@/lib/fit-view-options';
import { computeGraphHash } from '@/lib/graph-hash';
import { findGuides, type HelperLines } from '@/lib/graph-guides';
import {
  MINIMAP_MASK_STROKE_WIDTH,
  minimapNodeColor,
} from '@/lib/minimap';
import { canInsertOnEdge } from '@/lib/node-registry';
import { useWorkflowStore, type CanvasMode, type FindCenterHandler, type Position } from '@/stores/workflow';
import { useTranslation } from 'react-i18next';

/** Шаг сетки привязки узлов (KI-189). */
const SNAP_GRID: [number, number] = [8, 8];

/** Допуск совпадения центров для направляющих (KI-189), px. */
const GUIDE_TOLERANCE = 4;

/** Задержка автосохранения после правки графа (KI-195), мс. */
const AUTO_SAVE_DELAY_MS = 3000;

/**
 * Режимы холста в панели (KI-188), порядок кнопок — как в DESIGN.
 *
 * Клавиша режима совпадает с хоткеем (`S` — курсор, `H` — рука), поэтому
 * массив типизирован `CanvasMode`: опечатка в литерале не пройдёт tsc.
 */
const CANVAS_MODE_BUTTONS: readonly CanvasMode[] = ['select', 'pan'];

/**
 * Габариты стикера-комментария для центрирования (KI-187).
 *
 * `w-56` = 224 px; высота приблизительная — текст растёт по содержимому
 * (KI-169), а точный размер React Flow узнаёт только после первого рендера.
 */
const COMMENT_DEFAULT_WIDTH = 224;
const COMMENT_DEFAULT_HEIGHT = 96;

/**
 * Реестр типов связей React Flow (KI-185).
 *
 * Константа уровня модуля: React Flow сверяет ссылку и предупреждает в консоли,
 * если объект типов создаётся заново на каждом рендере.
 */
const edgeTypes = { [INSERTABLE_EDGE_TYPE]: InsertableEdge };

/**
 * Опции связей по умолчанию (KI-185).
 *
 * `type` отсюда React Flow подставляет связям, у которых своего `type` нет, —
 * в том числе загруженным из backend. Благодаря этому «вставляемое» ребро
 * получают все связи графа, а не только созданные в текущей сессии.
 */
const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = { type: INSERTABLE_EDGE_TYPE };

interface CanvasProps {
  /**
   * Canvas отдаёт наружу функцию поиска центра вьюпорта: только у него есть
   * доступ к трансформации React Flow.
   */
  onReady: (findCenter: FindCenterHandler) => void;
}

/**
 * Клавиши удаления выбранных узлов и связей (A1).
 *
 * React Flow v12 по умолчанию слушает только `Backspace`, поэтому `Delete` —
 * привычная клавиша для удаления — не делал ничего.
 */
const DELETE_KEY_CODES = ['Delete', 'Backspace'];

/**
 * Локализация подсказок встроенных элементов React Flow (KI-167).
 *
 * `<Controls />` и `<MiniMap />` берут `title` и `aria-label` своих кнопок из
 * конфига `ariaLabelConfig` (проверено в `@xyflow/system`: ключи
 * `controls.*.ariaLabel`), поэтому переводятся одним пропом — свои кнопки
 * писать не нужно.
 *
 * @param t - функция перевода react-i18next
 * @returns частичный конфиг подписей, который React Flow смёржит с дефолтным
 */
function ariaLabels(t: (key: string) => string) {
  return {
    'controls.ariaLabel': t('canvas.controls.title'),
    'controls.zoomIn.ariaLabel': t('canvas.controls.zoom_in'),
    'controls.zoomOut.ariaLabel': t('canvas.controls.zoom_out'),
    'controls.fitView.ariaLabel': t('canvas.controls.fit_view'),
    'controls.interactive.ariaLabel': t('canvas.controls.toggle_interactive'),
    'minimap.ariaLabel': t('canvas.minimap.title'),
  };
}

/** Внутренняя часть канваса: живёт внутри ReactFlowProvider. */
function CanvasInner({ onReady }: CanvasProps) {
  const { t } = useTranslation();
  const nodes = useWorkflowStore((state) => state.nodes);
  const edges = useWorkflowStore((state) => state.edges);
  const onNodesChange = useWorkflowStore((state) => state.onNodesChange);
  const onEdgesChange = useWorkflowStore((state) => state.onEdgesChange);
  const onConnect = useWorkflowStore((state) => state.onConnect);
  const removeNode = useWorkflowStore((state) => state.removeNode);
  const addNodeOnEdge = useWorkflowStore((state) => state.addNodeOnEdge);
  const duplicateNodes = useWorkflowStore((state) => state.duplicateNodes);
  const setSelectedNodeId = useWorkflowStore((state) => state.setSelectedNodeId);
  const selectedNodeId = useWorkflowStore((state) => state.selectedNodeId);
  const currentWorkflowId = useWorkflowStore((state) => state.currentWorkflowId);
  const lastSavedHash = useWorkflowStore((state) => state.lastSavedHash);
  const markSaved = useWorkflowStore((state) => state.markSaved);
  const saveWorkflowAsync = useWorkflowStore((state) => state.saveWorkflowAsync);
  // KI-186: режим холста, видимость миникарты и общий каталог узлов живут в
  // сторе — их меняют и горячие клавиши, и кнопки панели режимов, и `Toolbar`.
  const canvasMode = useWorkflowStore((state) => state.canvasMode);
  const setCanvasMode = useWorkflowStore((state) => state.setCanvasMode);
  const showMinimap = useWorkflowStore((state) => state.showMinimap);
  const setShowMinimap = useWorkflowStore((state) => state.setShowMinimap);
  // KI-445: статусы узлов нужны миникарте — по ним красится каждый узел
  // (см. `minimapNodeColor`), иначе на миникарте видны только одинаковые
  // прямоугольники, а до фикса — вообще ничего.
  const nodeStatuses = useWorkflowStore((state) => state.nodeStatuses);
  const isCatalogOpen = useWorkflowStore((state) => state.isCatalogOpen);
  const setCatalogOpen = useWorkflowStore((state) => state.setCatalogOpen);
  // KI-187: комментарии-стикеры — создание по `C`, видимость по `Shift+C`.
  const addNode = useWorkflowStore((state) => state.addNode);
  const toggleCommentsVisibility = useWorkflowStore(
    (state) => state.toggleCommentsVisibility,
  );
  // R6.4b.2b: откат/повтор правок графа (DESIGN v0.8 § 7.2).
  const undo = useWorkflowStore((state) => state.undo);
  const redo = useWorkflowStore((state) => state.redo);
  // KI-189: направляющие выравнивания (ручная реализация — `useAligning`
  // доступен только в @xyflow/pro).
  const [helperLines, setHelperLines] = useState<HelperLines>({});
  // KI-185 (fix4): связь, для которой открыт каталог вставки узла. Клик по «+»
  // обрабатывает кастомное ребро (`InsertableEdge`), а поповер каталога живёт
  // здесь — обмен между ними идёт через стор.
  const pendingEdgeId = useWorkflowStore((state) => state.pendingEdgeId);
  const clearPendingEdge = useWorkflowStore((state) => state.clearPendingEdge);

  const { getViewport, fitView, screenToFlowPosition } = useReactFlow();

  /**
   * Признак того, что загруженный граф уже вписан в видимую область.
   *
   * Хранит id workflow, для которого `fitView` уже отработал: без этого
   * повторный прогон эффекта (например, когда `useReactFlow` меняет ссылку
   * после инициализации вьюпорта) сбрасывал бы вид, который пользователь
   * успел настроить руками.
   */
  const fittedWorkflowId = useRef<string | null>(null);

  /**
   * Вписывает загруженный граф в видимую область (R6.5.2-fix2).
   *
   * Раньше подгонка висела на пропе `fitView={isEmpty}`: на монтировании граф
   * ещё пуст (`nodes = []`), поэтому React Flow ставил `fitView` в очередь, а
   * после прихода узлов из `loadWorkflowAsync` проп менялся на `false` и
   * подгонка не перезапускалась — вьюпорт оставался дефолтным, и узлы с
   * ненулевыми координатами (после F5 сохранённый граф) оказывались за кадром.
   *
   * Зависимость — `currentWorkflowId`, а **не** `nodes.length`: иначе подгонка
   * дёргалась бы на каждое добавление узла и сбрасывала текущий вид.
   */
  useEffect(() => {
    if (currentWorkflowId === null || nodes.length === 0) {
      return;
    }

    if (fittedWorkflowId.current === currentWorkflowId) {
      return;
    }

    fittedWorkflowId.current = currentWorkflowId;
    // `padding`/`maxZoom` пришли из пропа `fitViewOptions` (R4.x):
    // без `maxZoom` один-два узла растягиваются на весь экран.
    // KI-306: `minZoom` — в опциях вызова; без него расчётный zoom для графа с
    // разбросом ~22 000 px клампится store-значением 0.5, и узлы остаются за кадром.
    // KI-311: набор опций — общий модуль, чтобы авто-fit совпадал с Fit и `F`.
    void fitView({ ...FIT_VIEW_OPTIONS, duration: 200 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkflowId, fitView]);

  /**
   * Переводит центр контейнера из экранных координат в координаты холста
   * с учётом зума и сдвига вьюпорта.
   */
  const findCenter = useCallback<FindCenterHandler>(() => {
    const viewport = getViewport();
    const container = document.querySelector<HTMLElement>('.react-flow');
    const width = container?.clientWidth ?? window.innerWidth;
    const height = container?.clientHeight ?? window.innerHeight;

    return {
      x: (width / 2 - viewport.x) / viewport.zoom,
      y: (height / 2 - viewport.y) / viewport.zoom,
    };
  }, [getViewport]);

  /**
   * Вписывает в видимую область выделенные узлы, а если выделения нет — весь граф.
   *
   * KI-328: fit по всему bbox усредняет масштаб по крайним узлам, поэтому при
   * разбросе в тысячи пикселей карточки превращаются в 4–6 px — «в кадре» ≠
   * «читаемо». Fit по выделению идёт с другим набором опций
   * ({@link FIT_SELECTION_OPTIONS}, `minZoom: 0.1`) и с явным списком узлов:
   * `getFitViewNodes` (@xyflow/system) фильтрует внутренний `nodeLookup` по
   * `options.nodes`, поэтому в кадр попадают только выбранные карточки.
   *
   * Передаём именно `{ id }`, а не целые узлы: React Flow читает из элементов
   * только `id`, а тип `FitViewOptions.nodes` допускает обе формы.
   *
   * Выделение берём из стора (`node.selected`) — его обновляет React Flow через
   * `onNodesChange`, поэтому отдельное состояние для мультивыбора не нужно.
   * Селектором стора список не читаем: новый массив на каждый рендер дал бы
   * бесконечный цикл подписки (zustand сравнивает снапшоты по ссылке).
   */
  const fitSelection = useCallback(() => {
    const selectedIds = useWorkflowStore
      .getState()
      .nodes.filter((node) => node.selected === true)
      .map((node) => ({ id: node.id }));

    if (selectedIds.length === 0) {
      // Выделения нет — `Shift+F` работает как обычный `F`: подгонка всего графа.
      void fitView({ ...FIT_VIEW_OPTIONS, duration: 200 });

      return;
    }

    void fitView({ ...FIT_SELECTION_OPTIONS, nodes: selectedIds, duration: 200 });
  }, [fitView]);

  /**
   * Позиция нового узла так, чтобы его **центр** совпал с центром холста
   * (KI-187, хоткей `C`).
   *
   * `screenToFlowPosition` предпочтительнее ручного пересчёта: React Flow сам
   * учитывает пан/зум и отступы панелей, поэтому стикер появляется там, куда
   * смотрит пользователь, а не в углу. Вычитаем половину габаритов карточки —
   * у `addNode` позиция означает левый верхний угол.
   */
  const commentPositionAtCenter = useCallback((): Position => {
    const container = document.querySelector<HTMLElement>('.react-flow');
    const rect = container?.getBoundingClientRect();
    const screenCenter = {
      x: (rect?.left ?? 0) + (rect?.width ?? window.innerWidth) / 2,
      y: (rect?.top ?? 0) + (rect?.height ?? window.innerHeight) / 2,
    };
    const center = screenToFlowPosition(screenCenter);

    return {
      x: center.x - COMMENT_DEFAULT_WIDTH / 2,
      y: center.y - COMMENT_DEFAULT_HEIGHT / 2,
    };
  }, [screenToFlowPosition]);

  /**
   * Цвет узла на миникарте (KI-445).
   *
   * Проп `nodeColor` React Flow зовёт для каждого узла при каждом изменении
   * графа, поэтому функция мемоизирована: новая ссылка на каждый ре-рендер
   * канваса заставляла бы перерисовывать все прямоугольники миникарты.
   * Зависимость — карта статусов: она меняется только при событиях запуска.
   *
   * @param node - узел графа (React Flow отдаёт его из `nodeLookup`)
   * @returns CSS-цвет заливки прямоугольника на миникарте
   */
  const minimapColorOf = useCallback(
    (node: Node) => minimapNodeColor(nodeStatuses[node.id]),
    [nodeStatuses],
  );

  // Отдаём функцию поиска центра наружу ровно один раз: повторные вызовы
  // дёргали бы состояние приложения на каждом ре-рендере канваса.
  const emitted = useRef(false);

  useEffect(() => {
    if (emitted.current) {
      return;
    }

    emitted.current = true;
    onReady(findCenter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Считает направляющие по совпадению центров dragged-узла с соседями.
   *
   * KI-189-fix: React Flow отдаёт в `onNodeDrag` третьим аргументом только
   * перетаскиваемые узлы (сам dragged-узел), поэтому список соседей берём из
   * стора. С прежним `allNodes` в `findGuides` попадал один dragged-узел,
   * который функция пропускает по id, — направляющих не было никогда.
   *
   * @param node - перетаскиваемый узел (позиция + измеренный размер)
   */
  const handleNodeDrag = useCallback((node: Node) => {
    const others = useWorkflowStore
      .getState()
      .nodes.filter((item) => item.id !== node.id)
      .map((item) => ({
        id: item.id,
        position: item.position,
        width: item.measured?.width,
        height: item.measured?.height,
      }));

    setHelperLines(
      findGuides(
        {
          id: node.id,
          position: node.position,
          width: node.measured?.width,
          height: node.measured?.height,
        },
        others,
        GUIDE_TOLERANCE,
      ),
    );
  }, []);

  /**
   * Кладёт в историю состояние графа «до перетаскивания» (R6.4b.2b).
   *
   * Снимок делается **на старте** drag, а не на финише: React Flow применяет
   * финальную позицию к узлам раньше, чем зовёт `onNodeDragStop`, поэтому там
   * снимок содержал бы уже перемещённый узел, и откат был бы пустым. На старте
   * поток `position`-изменений (`dragging: true`) ещё не пришёл — состояние
   * стора совпадает с состоянием до перетаскивания.
   */
  const handleNodeDragStart = useCallback(() => {
    useWorkflowStore.getState().pushHistory();
  }, []);

  // KI-186/KI-187: хоткеи холста (S/H/F/M/C/Tab, Shift+C). `ctrl+d` (KI-191)
  // живёт в той же карте: хук сам проверяет сочетания с `ctrl` раньше одиночных,
  // поэтому `Ctrl+D`/`Ctrl+C` не конфликтуют с одиночными `D`/`C`, а
  // `preventDefault` для дублирования по-прежнему вызывает сам обработчик
  // (поведение R6.4a сохранено).
  useHotkeys(
    {
      // R6.4b.2b: Ctrl+Z — откат, Ctrl+Shift+Z — повтор. Сочетания с `ctrl`
      // хук проверяет раньше одиночных, поэтому `Ctrl+Z` не «доедает» до `Z`
      // (одиночного биндинга `z` нет), а `Ctrl+Shift+Z` имеет приоритет над
      // `Ctrl+Z` за счёт строгой проверки `shift` в `matchesHotkey`.
      // `preventDefault` — чтобы браузер не отменял правку в поле ввода,
      // когда каталог узлов открыт и фокус стоит в его поиске (KI-186).
      'ctrl+z': {
        preventDefault: true,
        handler: () => undo(),
      },
      'ctrl+shift+z': {
        preventDefault: true,
        handler: () => redo(),
      },
      // Ctrl+D — дублировать выделенный узел (KI-191).
      'ctrl+d': (event) => {
        if (selectedNodeId === null) {
          return;
        }

        event.preventDefault();
        duplicateNodes([selectedNodeId]);
      },
      // S — режим «Курсор»: рамка выделения вместо перемещения холста (KI-188).
      s: () => setCanvasMode('select'),
      // H — режим «Рука»: перетаскивание холста (KI-188).
      h: () => setCanvasMode('pan'),
      // F — вписать все узлы в видимую область (KI-186).
      // KI-306: `minZoom` в опциях вызова — иначе хоткей клампил zoom по
      // store-значению 0.5 и не умещал граф с большим разбросом координат.
      // KI-311: opts те же, что у кнопки Fit и авто-fit (общий модуль
      // `@/lib/fit-view-options`); раньше хоткей шёл без `padding`/`maxZoom`,
      // из-за чего «вписать» давало другой вид (1.53 против 1.0), — это
      // осознанное изменение поведения KI-186.
      f: () => {
        void fitView({ ...FIT_VIEW_OPTIONS, duration: 200 });
      },
      // Shift+F — вписать **выделенные** узлы (KI-328), а без выделения — весь
      // граф. У `shift+*` приоритет выше одиночных, поэтому `Shift+F` не уходит
      // в обработчик `f` (см. `bindingPriority` в `hotkeys-utils`).
      'shift+f': () => fitSelection(),
      // M — показать/скрыть миникарту (KI-190).
      m: () => setShowMinimap(!showMinimap),
      // C — новый комментарий в центре холста (KI-187). Одиночный `c` не
      // перехватывает `Ctrl+C`: у сочетаний с `ctrl` приоритет в хуке.
      c: () => addNode('comment', commentPositionAtCenter()),
      // Shift+C — показать/скрыть все комментарии (KI-187).
      'shift+c': () => toggleCommentsVisibility(),
      // Tab — общий каталог узлов (KI-186). `preventDefault` гасит переход
      // фокуса, `stopPropagation` не пускает Tab в обработчики React Flow.
      // `allow` нужен, когда каталог уже открыт: фокус стоит в его поиске
      // (`autoFocus`), а иначе клавиша не закрыла бы каталог.
      tab: {
        preventDefault: true,
        stopPropagation: true,
        allow: () => isCatalogOpen,
        handler: () => setCatalogOpen(!isCatalogOpen),
      },
    },
    [
      selectedNodeId,
      duplicateNodes,
      setCanvasMode,
      fitView,
      fitSelection,
      showMinimap,
      setShowMinimap,
      addNode,
      commentPositionAtCenter,
      toggleCommentsVisibility,
      isCatalogOpen,
      setCatalogOpen,
      undo,
      redo,
    ],
  );

  // KI-195: автосохранение через 3 секунды после последней правки. Сохраняем
  // только сохранённый workflow и только если граф реально отличается от
  // последнего сохранённого состояния.
  useDebouncedEffect(
    () => {
      if (currentWorkflowId === null) {
        return;
      }

      const hash = computeGraphHash(nodes, edges);

      if (hash === lastSavedHash) {
        return;
      }

      void saveWorkflowAsync().then(() => markSaved(hash));
    },
    [nodes, edges, currentWorkflowId, lastSavedHash],
    AUTO_SAVE_DELAY_MS,
  );

  return (
    <>
      {/* KI-188: курсор контейнера повторяет режим холста — «рука» в pan,
          обычная стрелка в select. */}
      <div
        className={`h-full w-full ${
          canvasMode === 'pan' ? 'cursor-grab' : 'cursor-default'
        }`}
      >
        {/* KI-008: компоненты узлов ленивые (`React.lazy` в реестре), поэтому
            React Flow должен рендериться под Suspense-границей. Fallback —
            общий индикатор загрузки: он виден только пока подгружается чанк
            первого узла, после чего холст монтируется как раньше. */}
        <Suspense
          fallback={
            <div
              role="status"
              className="flex h-full w-full items-center justify-center text-sm text-muted-foreground"
            >
              {t('common.loading')}
            </div>
          }
        >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          // KI-185: кастомное ребро с кнопками «+»/«×». `edgeTypes` — константа
          // модуля, `DEFAULT_EDGE_OPTIONS` подставляет тип связям без своего `type`
          // (в том числе загруженным из backend).
          edgeTypes={edgeTypes}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          // KI-306: дефолт для fit-операций. `minZoom` живёт здесь (в опциях
          // вызова), а не в `<ReactFlow minZoom>`: зум колесом по-прежнему
          // ограничен store-значением 0.5, а Fit/`F`/авто-fit — 0.005 (KI-314).
          // KI-311: один источник опций на все три пути — `@/lib/fit-view-options`.
          fitViewOptions={FIT_VIEW_OPTIONS}
          // KI-188: в режиме «Рука» перетаскивание пустого места двигает холст,
          // в режиме «Курсор» — рисует рамку выделения (`selectionOnDrag`),
          // поэтому `panOnDrag` и `selectionOnDrag` взаимоисключающие.
          panOnDrag={canvasMode === 'pan'}
          selectionOnDrag={canvasMode === 'select'}
          // KI-189: привязка к сетке 8×8, направляющие — поверх (см. ниже).
          snapToGrid
          snapGrid={SNAP_GRID}
          // KI-189-fix: `onNodeDrag` третьим аргументом отдаёт только dragged-узлы,
          // поэтому соседей для направляющих обработчик берёт из стора.
          onNodeDrag={(_event, node) => handleNodeDrag(node)}
          // R6.4b.2b: снимок «до перетаскивания» — один шаг истории на весь drag.
          onNodeDragStart={handleNodeDragStart}
          onNodeDragStop={() => setHelperLines({})}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          // A1: по умолчанию React Flow v12 удаляет только по `Backspace`, из-за
          // чего привычная клавиша `Delete` не работала. Возвращаем обе.
          deleteKeyCode={DELETE_KEY_CODES}
          // A1: удаление узла сносит и его связи, чтобы в графе не оставалось
          // висячих рёбер (React Flow убирает их сам — фиксируем это тестом).
          onNodesDelete={(deleted) => {
            for (const node of deleted) {
              removeNode(node.id);
            }
          }}
          // Клик по узлу показывает его результат в нижней панели (R4.3b),
          // клик по пустому месту возвращает панель к run-уровню. Клик по связи или
          // порту эти обработчики не дёргает, поэтому выбор не «слетает».
          onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          proOptions={{ hideAttribution: true }}
          // KI-167: подсказки кнопок Zoom/Fit/Interactive и миникарты на языке UI.
          ariaLabelConfig={ariaLabels(t)}
          // Цвет и толщина связей — из переменных React Flow (theme.css), чтобы
          // рёбра менялись вместе с темой (R5.2); width: 2 задан в --xy-edge-stroke-width.
          // R6.5.2-fix2: подгонка вида после загрузки графа — в `useEffect` выше,
          // а не через проп `fitView={isEmpty}` (см. комментарий у эффекта).
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          {/* KI-306: `<Controls />` вызывает `fitView(fitViewOptions)` со **своим**
              пропом (`undefined`, если не передать) и затирает store-значение из
              пропа `<ReactFlow fitViewOptions>`. Без явной передачи кнопка Fit
              снова клампила бы zoom по store-`minZoom` 0.5. */}
          <Controls fitViewOptions={FIT_VIEW_OPTIONS} />
          {/* KI-190: миникарту можно скрыть (хоткей `M` или кнопка панели
              режимов). KI-158 (контраст) учтён в theme.css; KI-170
              (`aria-label` у `<MiniMap />`) остаётся открытым.
              KI-445: `nodeColor` и `maskStrokeWidth` заданы явно. Раньше узел
              красился цветом фона (`--color-node-bg`), контур вьюпорта был
              прозрачным, а маска при вписанном графе вырождалась в ноль —
              миникарта выглядела пустым белым квадратом. Цвета узлов —
              статусные (см. `@/lib/minimap`), толщина контура — через проп:
              React Flow масштабирует её на размер графа. */}
          {showMinimap && (
            <MiniMap
              nodeColor={minimapColorOf}
              maskStrokeWidth={MINIMAP_MASK_STROKE_WIDTH}
            />
          )}

          {/* KI-185 (fix4): кнопки «+»/«×» живут в самом ребре
              (`InsertableEdge`) — Canvas их больше не рисует и не хранит hover. */}

          {pendingEdgeId !== null && (
            // Ширина задана явно: у обёртки нет содержимого собственного размера,
            // и `inset-x-0` внутри поповера схлопывался в 0 (KI-258).
            <div className="absolute left-1/2 top-4 z-30 w-72 -translate-x-1/2">
              <NodeCatalogPopover
                open
                placement="down"
                // KI-259: в связь можно вставить только типы с входным портом
                // (единый источник правды — `NODE_REGISTRY.canBeInsertedOnEdge`).
                filter={canInsertOnEdge}
                onClose={clearPendingEdge}
                onAddNode={(type) => {
                  addNodeOnEdge(pendingEdgeId, type);
                  clearPendingEdge();
                }}
              />
            </div>
          )}

          {/* KI-189: направляющие выравнивания. Слой рендерится через
              `<ViewportPortal>` — он живёт внутри `.react-flow__viewport` и
              трансформируется вместе с холстом, поэтому координаты линий — в
              координатах потока (без пересчёта в экранные).
              `overflow-visible` обязателен: без него svg обрезает линию по своему
              боксу (размер вьюпорта), и при pan/zoom линия пропадает.
              `pointer-events-none` — слой не должен перехватывать кнопки «+»/«×». */}
          {(helperLines.vertical !== undefined ||
            helperLines.horizontal !== undefined) && (
            <ViewportPortal>
              <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible">
                {helperLines.vertical !== undefined && (
                  <line
                    data-helper-line="vertical"
                    x1={helperLines.vertical}
                    x2={helperLines.vertical}
                    y1={-100000}
                    y2={100000}
                    stroke="var(--color-primary)"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                  />
                )}
                {helperLines.horizontal !== undefined && (
                  <line
                    data-helper-line="horizontal"
                    x1={-100000}
                    x2={100000}
                    y1={helperLines.horizontal}
                    y2={helperLines.horizontal}
                    stroke="var(--color-primary)"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                  />
                )}
              </svg>
            </ViewportPortal>
          )}
        </ReactFlow>
        </Suspense>
      </div>

      {/* KI-188/KI-190: панель режимов холста. Живёт вне `<ReactFlow>`, но внутри
          его провайдера; `pointer-events-none` на обёртке + `pointer-events-auto`
          на кнопках — так панель не перехватывает pan/zoom вокруг себя.
          Показывается и на пустом холсте: режим, миникарта и «вписать выделение» —
          настройки вида, а не свойство графа.
          R6.5.2-fix2: угол `bottom-right` вместо `bottom-left` — в левом нижнем
          углу панель перекрывала встроенный `<Controls />` (zoom/fit/lock).
          Отступ по вертикали зависит от миникарты: при её показе правый нижний
          угол занят (`202×152` px), поэтому панель поднимается над ней
          (`bottom-44` = 176 px), иначе возвращается в угол (`bottom-6`).
          Замер смоука: панель `right-6` пересекала бы `<MiniMap />` в обоих
          вариантах (даже `right-24` — левый край миникарты в 217 px от края). */}
      <div
        className={`pointer-events-none absolute right-6 z-20 ${
          showMinimap ? 'bottom-44' : 'bottom-6'
        }`}
      >
        <div className="pointer-events-auto flex items-center gap-1 rounded-xl bg-background p-1 shadow-lg ring-1 ring-border">
          {CANVAS_MODE_BUTTONS.map((mode) => {
            const active = canvasMode === mode;

            return (
              <button
                key={mode}
                type="button"
                data-canvas-mode={mode}
                aria-pressed={active}
                aria-label={t(`canvas.mode.${mode}`)}
                title={t(`canvas.mode.${mode}`)}
                onClick={() => setCanvasMode(mode)}
                className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-muted'
                }`}
              >
                {mode === 'select' ? '🖱' : '✋'} {t(`canvas.mode.${mode}`)}
              </button>
            );
          })}

          <button
            type="button"
            data-canvas-minimap-toggle="true"
            aria-pressed={showMinimap}
            aria-label={t('canvas.minimap.toggle')}
            title={t('canvas.minimap.toggle')}
            onClick={() => setShowMinimap(!showMinimap)}
            className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              showMinimap
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            <span aria-hidden="true">🗺</span> {t('canvas.minimap.toggle')}
          </button>

          {/* KI-328: «Вписать выделение» — то же действие, что `Shift+F`.
              Без выделения ведёт себя как обычный Fit по всему графу; `disabled`
              не ставим специально: нажатие обязано что-то делать, иначе кнопка
              выглядит сломанной. */}
          <button
            type="button"
            data-canvas-fit-selection=""
            aria-label={t('canvas.fit.selection.label')}
            title={t('canvas.fit.selection.label')}
            onClick={fitSelection}
            className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <span aria-hidden="true">🔍</span> {t('canvas.fit.selection.label')}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Канвас редактора: фон с сеткой, zoom-контролы и миникарта.
 *
 * Узлы и связи хранятся в zustand-сторе, поэтому Canvas остаётся тонким
 * слоем между React Flow и состоянием приложения.
 */
export function Canvas({ onReady }: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner onReady={onReady} />
    </ReactFlowProvider>
  );
}
