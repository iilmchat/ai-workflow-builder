import { useLayoutEffect, useRef } from 'react';
import type { ChangeEvent } from 'react';

/** Позиция выделения, которую нужно вернуть после обновления value. */
interface PendingSelection {
  /**
   * Значение, для которого запомнено выделение.
   *
   * Служит признаком готовности: восстанавливать позицию можно только тогда,
   * когда DOM уже содержит именно это значение. Иначе эффект сработает до
   * того, как React запишет новое значение, и вторая (собственная) запись
   * React снова уведёт курсор в конец.
   */
  value: string;
  /** Начало выделения; `null`, если поле не поддерживает выделение. */
  start: number | null;
  /** Конец выделения; `null`, если поле не поддерживает выделение. */
  end: number | null;
}

/**
 * Возвращает обработчик `onChange`, который сохраняет позицию курсора после
 * обновления внешнего контролируемого значения (KI-157).
 *
 * Проблема: `<textarea value={...} onChange={...}>` связан с внешним хранилищем
 * (Zustand). На каждый введённый символ значение меняется → компонент
 * перерисовывается → React записывает в DOM новое значение и **теряет позицию
 * курсора**, перенося её в конец. Пользователь, правящий середину текста,
 * получает курсор в конце.
 *
 * Решение: запомнить выделение до записи в хранилище и вернуть его синхронно
 * после коммита DOM через {@link useLayoutEffect} — до отрисовки кадра, поэтому
 * без визуального мигания. `requestAnimationFrame` дал бы то же результат, но
 * на кадр позже и с накоплением колбэков при быстром наборе.
 *
 * Работает для `<input>` и `<textarea>`: у обоих есть `selectionStart` /
 * `selectionEnd` и `setSelectionRange`.
 *
 * @param setValue - запись нового значения во внешнее хранилище
 * @returns обработчик `onChange` для контролируемого поля
 */
export function usePreserveCursor<T extends HTMLInputElement | HTMLTextAreaElement>(
  setValue: (value: string) => void,
): (event: ChangeEvent<T>) => void {
  const pendingRef = useRef<PendingSelection | null>(null);

  useLayoutEffect(() => {
    const pending = pendingRef.current;

    if (!pending) {
      return;
    }

    const element = document.activeElement;

    // Ждём коммита нового значения: пока в DOM старое, восстанавливать нечего —
    // React запишет новое позже и сам перенесёт курсор в конец.
    if (!isTextField(element) || element.value !== pending.value) {
      return;
    }

    pendingRef.current = null;

    // Позиции могут быть недоступны (поле без поддержки выделения) — тогда
    // полагаемся на поведение браузера.
    if (pending.start === null || pending.end === null) {
      return;
    }

    element.setSelectionRange(pending.start, pending.end);
  });

  return (event: ChangeEvent<T>): void => {
    const target = event.currentTarget;

    pendingRef.current = {
      value: target.value,
      start: target.selectionStart,
      end: target.selectionEnd,
    };

    setValue(target.value);
  };
}

/**
 * Проверяет, что узел — поле ввода с поддержкой выделения.
 *
 * @param node - активный элемент документа
 * @returns `true` для `INPUT` (не-файлового) и `TEXTAREA`
 */
function isTextField(
  node: Element | null,
): node is HTMLInputElement | HTMLTextAreaElement {
  if (node instanceof HTMLTextAreaElement) {
    return true;
  }

  if (node instanceof HTMLInputElement) {
    const type = node.type;

    return type !== 'file' && type !== 'checkbox' && type !== 'radio' && type !== 'range';
  }

  return false;
}
