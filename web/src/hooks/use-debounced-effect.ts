import { useEffect } from 'react';

/**
 * Выполняет эффект с задержкой, сбрасывая таймер при изменении зависимостей
 * (KI-195).
 *
 * @param callback - эффект (может быть асинхронным)
 * @param deps - зависимости эффекта
 * @param delayMs - задержка в миллисекундах
 */
export function useDebouncedEffect(
  callback: () => void | Promise<void>,
  deps: unknown[],
  delayMs: number,
): void {
  useEffect(() => {
    const timer = setTimeout(() => {
      void callback();
    }, delayMs);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delayMs]);
}
