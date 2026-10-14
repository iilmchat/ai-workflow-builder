import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/** Предел роста поля в пикселях: выше — появляется внутренняя прокрутка. */
const MAX_HEIGHT_PX = 200;

/**
 * Растягивает `<textarea>` по содержимому (KI-169).
 *
 * Поле фиксированной высоты (например, `rows={3}`) обрезает длинный промпт:
 * пользователь либо листает вслепую, либо тащит за угол. Хук на каждое
 * изменение `value` пересчитывает высоту по `scrollHeight` и останавливается
 * на {@link MAX_HEIGHT_PX}, после чего включает `overflow-y: auto`.
 *
 * Высота считается в `useLayoutEffect` — до отрисовки кадра, поэтому поле не
 * «прыгает» на глазах.
 *
 * @param ref - ссылка на `<textarea>`
 * @param value - текущее значение поля (зависимость пересчёта)
 * @param maxHeightPx - предел роста; при достижении включается прокрутка
 */
export function useAutoResize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeightPx: number = MAX_HEIGHT_PX,
): void {
  useLayoutEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    // Сброс обязателен: scrollHeight читается только у поля, которое может
    // сжиматься, иначе высота накапливалась бы и никогда не уменьшалась.
    element.style.height = 'auto';

    const contentHeight = element.scrollHeight;
    const nextHeight = Math.min(contentHeight, maxHeightPx);

    element.style.height = `${nextHeight}px`;
    element.style.overflowY = contentHeight > maxHeightPx ? 'auto' : 'hidden';
  }, [ref, value, maxHeightPx]);
}
