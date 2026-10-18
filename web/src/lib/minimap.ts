import type { NodeRunStatus } from '@/types/run-stream';

/**
 * Цвет узла на миникарте по статусу выполнения (KI-445).
 *
 * Зачем отдельная карта, если те же цвета есть в `BaseNode`:
 * 1. На миникарте узел — прямоугольник без рамки и текста, поэтому цвета
 *    карточки (`--color-node-bg` = белый в светлой теме) с фоном миникарты
 *    совпадали, и вся миникарта выглядела пустым белым квадратом.
 * 2. Статусные цвета делают миникарту информативной: во время прогона видно,
 *    где идут узлы и где уже упали, не увеличивая масштаб холста.
 *
 * Значения — CSS-переменные, а не hex: цвет обязан меняться вместе с темой
 * (`.dark` переопределяет `--color-node-*`), а `color-mix` со ссылкой на тему
 * Tailwind внутри правил запрещён (RULES 4.32, KI-134).
 */
const MINIMAP_NODE_COLOR: Record<NodeRunStatus, string> = {
  /** Узел не выполнялся (или запуск ещё не стартовал) — нейтральный серый. */
  pending: 'var(--color-minimap-node)',
  /** Выполняется — синий, как рамка карточки. */
  running: 'var(--color-node-running)',
  /** Успех — зелёный. */
  completed: 'var(--color-node-completed)',
  /** Падение — красный. */
  failed: 'var(--color-node-failed)',
  /** Запуск отменён — нейтральный: это не ошибка узла. */
  cancelled: 'var(--color-minimap-node)',
  /** Узел пропущен движком (KI-288) — приглушённый серый. */
  skipped: 'var(--color-node-skipped)',
};

/**
 * Возвращает цвет заливки узла на миникарте.
 *
 * Чистая функция: пригодна для пропа `<MiniMap nodeColor>` и покрывается
 * юнит-тестами (сам `<MiniMap />` в jsdom без `ResizeObserver` не рендерится).
 *
 * @param status - статус узла из SSE; `undefined` — узел ещё не выполнялся
 * @returns CSS-цвет заливки (`var(--color-…)`)
 */
export function minimapNodeColor(status?: NodeRunStatus): string {
  return MINIMAP_NODE_COLOR[status ?? 'pending'];
}

/**
 * Толщина контура видимой области на миникарте, px (KI-445).
 *
 * React Flow умножает значение на масштаб миникарты (`boundingRect.width /
 * elementWidth`), поэтому линия остаётся ~1 экранным пикселем независимо от
 * размера графа. Задать её CSS-переменной нельзя: там значение трактуется как
 * единицы viewBox и на большом графе превращается в доли пикселя.
 */
export const MINIMAP_MASK_STROKE_WIDTH = 1;
