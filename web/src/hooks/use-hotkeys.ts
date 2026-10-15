import { useEffect } from 'react';
import {
  bindingPriority,
  isInputElement,
  matchesHotkey,
  parseBinding,
  parseKey,
} from '@/lib/hotkeys-utils';

/** Обработчик горячей клавиши. */
export type HotkeyHandler = (event: KeyboardEvent) => void;

/**
 * Расширенное описание горячей клавиши (KI-186).
 *
 * Объектная форма нужна там, где одного вызова обработчика мало:
 * - `preventDefault` — погасить действие браузера (`Tab` уводит фокус,
 *   `Ctrl+S` открывает «Сохранить страницу»);
 * - `stopPropagation` — не пускать событие дальше по DOM (в React Flow его
 *   успевают увидеть обработчики панели);
 * - `allow` — разрешить срабатывание, когда фокус стоит в поле ввода: нужно
 *   `Tab`, закрывающему каталог, — поиск в поповере получает фокус автоматически
 *   (`autoFocus`), и без этого исключения каталог закрывался бы только мышью.
 */
export interface HotkeyBinding {
  /** Что выполнить при нажатии. */
  readonly handler: HotkeyHandler;
  /** Вызвать `event.preventDefault()` до обработчика. */
  readonly preventDefault?: boolean;
  /** Вызвать `event.stopPropagation()` до обработчика. */
  readonly stopPropagation?: boolean;
  /**
   * Исключение из правила «в полях ввода клавиши не перехватываем».
   *
   * @param active - активный элемент документа
   * @returns `true`, если биндинг всё же должен сработать
   */
  readonly allow?: (active: Element | null) => boolean;
}

/** Карта «описание клавиши → обработчик или расширенное описание». */
export type HotkeyBindings = Record<string, HotkeyHandler | HotkeyBinding>;

/** Приводит запись bindings к расширенной форме. */
function toBinding(value: HotkeyHandler | HotkeyBinding): HotkeyBinding {
  return typeof value === 'function' ? { handler: value } : value;
}

/**
 * Централизованный обработчик горячих клавиш (KI-186, R6.4b.1).
 *
 * Поведение:
 * - события из полей ввода (`input`/`textarea`/`select`/`contenteditable`)
 *   игнорируются — иначе `S` в текстовом узле переключал бы режим холста;
 *   исключение задаётся полем `allow` у биндинга;
 * - приоритет: `ctrl+*` (а также `alt`/`meta`) > `shift+*` > одиночные, поэтому
 *   `Ctrl+S` не срабатывает как одиночный `S`;
 * - модификаторы `ctrl`/`alt`/`meta` проверяются строго, `shift` у одиночных
 *   клавиш — нестрого (детали в `matchesHotkey`);
 * - listener вешается на `document` в capture-фазе: работает и когда фокус на
 *   кнопке React Flow, и когда вложенный обработчик вызывает `stopPropagation`;
 * - `preventDefault`/`stopPropagation` вызываются **до** обработчика, если
 *   указаны в описании биндинга (для `Ctrl+D` их по-прежнему вызывает сам
 *   обработчик — поведение R6.4a сохранено).
 *
 * @param bindings - карта «клавиша → обработчик»; ключи в lower-case, например
 *   `'s'`, `'ctrl+d'`, `'shift+c'`, `'tab'`
 * @param deps - зависимости эффекта: при изменении listener пересоздаётся
 */
export function useHotkeys(bindings: HotkeyBindings, deps: unknown[] = []): void {
  useEffect(() => {
    // Раскладываем биндинги по приоритету один раз на подписку, а не на каждое
    // нажатие: порядок в объекте задаёт пользователь, а приоритет — хук.
    const prioritized = Object.entries(bindings)
      .map(([binding, value]) => {
        const parsed = parseBinding(binding);

        return { parsed, entry: toBinding(value), priority: bindingPriority(parsed) };
      })
      .sort((left, right) => right.priority - left.priority);

    /**
     * Обрабатывает `keydown` и вызывает первый подошедший обработчик.
     *
     * @param event - событие клавиатуры
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      const pressed = parseKey(event);

      if (pressed === null) {
        return;
      }

      const active = document.activeElement;

      for (const { parsed, entry } of prioritized) {
        if (!matchesHotkey(pressed, parsed)) {
          continue;
        }

        if (isInputElement(active) && entry.allow?.(active) !== true) {
          return;
        }

        if (entry.preventDefault === true) {
          event.preventDefault();
        }

        if (entry.stopPropagation === true) {
          event.stopPropagation();
        }

        entry.handler(event);

        return;
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => document.removeEventListener('keydown', onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
