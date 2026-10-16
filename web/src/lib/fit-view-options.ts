/**
 * Единые опции подгонки вида для всех fit-операций (KI-306/310/311).
 *
 * Источник правды один, потому что fit-операций несколько, и они легко
 * расходятся:
 * - `useEffect` после загрузки графа (F5) — `web/src/components/Canvas.tsx`;
 * - хоткей `F` — там же;
 * - кнопка Fit из `<Controls fitViewOptions>` — там же;
 * - `<ReactFlow fitViewOptions>` как дефолт — там же;
 * - публичная share-страница — `web/src/components/ShareViewPage.tsx` (KI-310).
 *
 * `minZoom` живёт **в опциях fitView**, а не в `<ReactFlow minZoom>`:
 * `getViewportForBounds` (@xyflow/system) читает `options.minZoom` приоритетно
 * перед store-значением, поэтому fit умещает граф с большим разбросом
 * (например, `Y = −21888` после накопленного `autoPanOnNodeDrag`, KI-307),
 * а пользовательский зум колесом остаётся ограничен store-значением `0.5`.
 *
 * `maxZoom: 1` — без него один-два узла растягиваются на весь экран.
 * `as const` фиксирует литеральные типы: опечатка в имени/значении или
 * `minZoom > maxZoom` видны на уровне типов и в тестах.
 */
export const FIT_VIEW_OPTIONS = {
  padding: 0.2,
  maxZoom: 1,
  minZoom: 0.02,
} as const;
