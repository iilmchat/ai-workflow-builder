import { describe, expect, it } from 'vitest';
import { FIT_SELECTION_OPTIONS, FIT_VIEW_OPTIONS } from './fit-view-options';

/**
 * Эталонная высота холста, px.
 *
 * `461` — замер CDP из KI-314 (редактор с открытой панелью результата).
 * Используется только как ориентир для расчётов покрытия.
 */
const MEASURED_CANVAS_HEIGHT = 461;

/**
 * Считает zoom, который выдаст `getViewportForBounds` для вертикального разброса.
 *
 * Повторяет **реальную** арифметику `@xyflow/system`:
 * `parsePadding(padding, viewport) = floor((viewport − viewport/(1 + padding)) · 0.5)`,
 * затем `zoom = (height − 2·padding) / boundsHeight` и зажим в `[minZoom, maxZoom]`.
 *
 * Важно: это не «height / minZoom». KI-314 считал порог упрощённо (461/0.02 =
 * 23 050), без множителя `1 + padding`; реальная формула строже — при
 * `padding: 0.2` в кадр попадает в 1.2 раза меньший разброс. Тесты ниже
 * фиксируют именно реальную формулу, чтобы константа проверялась по поведению
 * библиотеки, а не по удобной оценке.
 *
 * @param height - высота холста, px
 * @param spread - разброс графа по вертикали, px
 * @param padding - паддинг из опций fit
 * @returns zoom, который применит React Flow
 */
function fitZoomFor(height: number, spread: number, padding: number): number {
  const pad = Math.floor((height - height / (1 + padding)) * 0.5);

  return (height - pad * 2) / spread;
}

/**
 * Максимальный разброс, который ещё умещается при заданном `minZoom`.
 *
 * @param height - высота холста, px
 * @param minZoom - нижняя граница зума
 * @param padding - паддинг из опций fit
 * @returns разброс, px
 */
function maxSpreadAt(height: number, minZoom: number, padding: number): number {
  const pad = Math.floor((height - height / (1 + padding)) * 0.5);

  return (height - pad * 2) / minZoom;
}

describe('FIT_VIEW_OPTIONS (KI-306/311/314)', () => {
  it('содержит согласованный набор значений', () => {
    expect(FIT_VIEW_OPTIONS.padding).toBe(0.2);
    expect(FIT_VIEW_OPTIONS.maxZoom).toBe(1);
    expect(FIT_VIEW_OPTIONS.minZoom).toBe(0.005);
    expect(FIT_VIEW_OPTIONS.minZoom).toBeLessThan(FIT_VIEW_OPTIONS.maxZoom);
    expect(FIT_VIEW_OPTIONS.padding).toBeGreaterThan(0);
    expect(FIT_VIEW_OPTIONS.padding).toBeLessThan(0.5);
  });

  it('KI-314: разброс 60 000 px умещается при minZoom 0.005 и не умещался при 0.02', () => {
    // При 0.005 расчётный zoom (0.0064) выше пола — узлы в кадре.
    expect(fitZoomFor(MEASURED_CANVAS_HEIGHT, 60_000, FIT_VIEW_OPTIONS.padding)).toBeGreaterThan(
      FIT_VIEW_OPTIONS.minZoom,
    );

    // Контроль регрессии: при прежнем 0.02 тот же граф клампился (0.02 · 60 000
    // = 1200 px при доступных 385 px) — оба узла уезжали за кадр.
    expect(maxSpreadAt(MEASURED_CANVAS_HEIGHT, 0.02, FIT_VIEW_OPTIONS.padding)).toBeLessThan(
      60_000,
    );
    expect(maxSpreadAt(MEASURED_CANVAS_HEIGHT, FIT_VIEW_OPTIONS.minZoom, FIT_VIEW_OPTIONS.padding))
      .toBeGreaterThan(maxSpreadAt(MEASURED_CANVAS_HEIGHT, 0.02, FIT_VIEW_OPTIONS.padding));
  });
});

describe('FIT_SELECTION_OPTIONS (KI-328)', () => {
  it('содержит согласованный набор значений', () => {
    expect(FIT_SELECTION_OPTIONS.padding).toBe(0.3);
    expect(FIT_SELECTION_OPTIONS.maxZoom).toBe(1);
    expect(FIT_SELECTION_OPTIONS.minZoom).toBe(0.1);
    expect(FIT_SELECTION_OPTIONS.minZoom).toBeLessThan(FIT_SELECTION_OPTIONS.maxZoom);
    expect(FIT_SELECTION_OPTIONS.padding).toBeGreaterThan(0);
    expect(FIT_SELECTION_OPTIONS.padding).toBeLessThan(0.5);
  });

  it('инвариант: fit по выделению строго ближе, чем fit по всему графу', () => {
    expect(FIT_SELECTION_OPTIONS.minZoom).toBeGreaterThan(FIT_VIEW_OPTIONS.minZoom);
    expect(FIT_SELECTION_OPTIONS.padding).toBeGreaterThan(FIT_VIEW_OPTIONS.padding);
    expect(FIT_SELECTION_OPTIONS.maxZoom).toBe(FIT_VIEW_OPTIONS.maxZoom);
  });

  it('KI-328: пол 0.1 держит узел читаемым и умещает выделенный кластер', () => {
    // Ниже 0.1 карточка вырождается: при 0.02 узлы были 4–6 px (KI-328).
    expect(FIT_SELECTION_OPTIONS.minZoom).toBeGreaterThanOrEqual(0.1);

    // Кластер из двух узлов в 1000 px умещается с запасом (реальный zoom > пола).
    expect(fitZoomFor(MEASURED_CANVAS_HEIGHT, 1_000, FIT_SELECTION_OPTIONS.padding)).toBeGreaterThan(
      FIT_SELECTION_OPTIONS.minZoom,
    );

    // А разброс в 60 000 px в выделении упирается в пол 0.1: в кадр попадёт
    // только часть кластера — осознанный компромисс «читаемость > охват».
    expect(maxSpreadAt(MEASURED_CANVAS_HEIGHT, FIT_SELECTION_OPTIONS.minZoom, FIT_SELECTION_OPTIONS.padding))
      .toBeLessThan(60_000);
  });
});
