import { useEffect } from 'react';

/** Обработчик горячей клавиши. */
type HotkeyHandler = (event: KeyboardEvent) => void;

/** Элементы, в которых горячие клавиши не должны перехватываться. */
const EDITABLE_TAGS = ['INPUT', 'TEXTAREA', 'SELECT'];

/**
 * Проверяет, что фокус находится в поле ввода.
 *
 * @returns `true`, если активный элемент — input/textarea/select или
 *   contenteditable (в нём пользователь печатает текст, а не управляет графом)
 */
function isEditingText(): boolean {
  const element = document.activeElement;

  if (element === null) {
    return false;
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    return true;
  }

  return EDITABLE_TAGS.includes(element.tagName);
}

/**
 * Разбирает описание клавиши вида `ctrl+d` / `shift+c` / `delete`.
 *
 * @param binding - описание клавиши в lower-case
 * @returns модификаторы и саму клавишу
 */
function parseBinding(binding: string): {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
} {
  const parts = binding.toLowerCase().split('+');
  const key = parts.at(-1) ?? '';

  return {
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    meta: parts.includes('meta'),
    key,
  };
}

/**
 * Централизованный обработчик горячих клавиш (KI-191).
 *
 * Особенности:
 * - события из полей ввода игнорируются (иначе `Ctrl+D` ломал бы ввод);
 * - модификаторы проверяются строго: `ctrl+d` не сработает на `Ctrl+Shift+D`;
 * - listener вешается на `document` в capture-фазе, поэтому работает, даже
 *   когда фокус на кнопке React Flow.
 *
 * В R6.4a используется только `ctrl+d`; R6.4b расширит список, API не меняется.
 *
 * @param bindings - карта «клавиша → обработчик» (ключи в lower-case)
 * @param deps - зависимости: при изменении listener пересоздаётся
 */
export function useHotkeys(
  bindings: Record<string, HotkeyHandler>,
  deps: unknown[] = [],
): void {
  useEffect(() => {
    /**
     * Обрабатывает `keydown` и вызывает подходящий обработчик.
     *
     * @param event - событие клавиатуры
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditingText()) {
        return;
      }

      for (const [binding, handler] of Object.entries(bindings)) {
        const parsed = parseBinding(binding);

        if (
          event.key.toLowerCase() !== parsed.key ||
          event.ctrlKey !== parsed.ctrl ||
          event.shiftKey !== parsed.shift ||
          event.altKey !== parsed.alt ||
          event.metaKey !== parsed.meta
        ) {
          continue;
        }

        handler(event);
        return;
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => document.removeEventListener('keydown', onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
