import { describe, expect, it } from 'vitest';
import { NODE_RUN_STATUSES } from '@/types/run-stream';
import { MINIMAP_MASK_STROKE_WIDTH, minimapNodeColor } from './minimap';

/**
 * Цвет узла на миникарте (KI-445).
 *
 * Сам `<MiniMap />` в jsdom не рендерится (нужен `ResizeObserver` и измеренные
 * узлы), поэтому проверяется чистая функция, которую получает проп `nodeColor`.
 */
describe('minimapNodeColor: узлы видны на миникарте (KI-445)', () => {
  it('для каждого статуса возвращает заливку из переменных темы', () => {
    for (const status of NODE_RUN_STATUSES) {
      expect(minimapNodeColor(status), `статус ${status}`).toMatch(
        /^var\(--color-[a-z-]+\)$/,
      );
    }
  });

  it('узел без статуса (не выполнялся) не красится цветом карточки', () => {
    // Регресс KI-445: `--color-node-bg` в светлой теме — тот же белый, что фон
    // миникарты, поэтому узел «растворялся» и миникарта выглядела пустой.
    expect(minimapNodeColor()).toBe('var(--color-minimap-node)');
    expect(minimapNodeColor(undefined)).not.toBe('var(--color-node-bg)');
  });

  it('статусы прогона различаются цветом', () => {
    const colors = new Set([
      minimapNodeColor('running'),
      minimapNodeColor('completed'),
      minimapNodeColor('failed'),
    ]);

    expect(colors.size).toBe(3);
  });

  it('пропущенный узел отличается от нейтрального', () => {
    expect(minimapNodeColor('skipped')).not.toBe(minimapNodeColor('pending'));
  });

  it('толщина контура вьюпорта положительна', () => {
    expect(MINIMAP_MASK_STROKE_WIDTH).toBeGreaterThan(0);
  });
});
