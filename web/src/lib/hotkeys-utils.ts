/**
 * Чистые утилиты горячих клавиш (KI-186).
 *
 * Вынесены из хука `useHotkeys` в отдельный модуль: у них нет ни DOM, ни React.
 * Тесты идут в jsdom (KI-155), но функции остаются чистыми, поэтому
 * проверяются без монтирования компонентов.
 */

/**
 * Минимальный контракт DOM-элемента, достаточный для распознавания полей ввода.
 *
 * Структурный тип вместо `HTMLElement`: модуль остаётся импортируемым вне
 * браузера (SSR, чистые тесты), а для проверки нужны только тег и флаг
 * `contenteditable`.
 * Объект, переданный сюда в рантайме, — настоящий `Element` документа.
 */
export interface EditableCandidate {
  /** Имя тега в верхнем регистре (`INPUT`, `TEXTAREA`, …). */
  readonly tagName?: string;
  /**
   * Флаг `contenteditable`, как его отдаёт DOM.
   *
   * В `HTMLElement` это `boolean`, но у произвольного элемента свойство может
   * отсутствовать или быть строкой наследуемого атрибута — оба случая
   * безопасно приводятся к `false`.
   */
  readonly isContentEditable?: boolean;
}

/**
 * Минимальный контракт события клавиатуры, нужный парсеру.
 *
 * `KeyboardEvent` его удовлетворяет; в тестах достаточно литерала.
 */
export interface HotkeyKeyEvent {
  /** Значение `KeyboardEvent.key` (например, `s`, `S`, `Tab`, `Escape`). */
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
}

/** Разобранное сочетание клавиш: сама клавиша и модификаторы. */
export interface ParsedHotkey {
  /** Клавиша в lower-case (`'s'`, `'tab'`, `'escape'`). */
  readonly key: string;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  /** `Cmd` в macOS либо `Win` в Windows. */
  readonly meta: boolean;
}

/** Теги, в которых горячие клавиши не должны перехватываться. */
const EDITABLE_TAGS = ['INPUT', 'TEXTAREA', 'SELECT'];

/**
 * Служебные клавиши, у которых `KeyboardEvent.key` — не буква и не цифра.
 *
 * Нужны только те, что встречаются в биндингах: `Tab` в `event.key` уже написан
 * с большой буквы, а `Space`/`Escape` в `@xyflow/react` называются `' '` и
 * `'Escape'`. Приводим их к именам биндингов — иначе `'space'` и `'escape'`
 * в bindings никогда бы не совпали.
 */
const SPECIAL_KEYS: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
  arrowup: 'arrowup',
  arrowdown: 'arrowdown',
  arrowleft: 'arrowleft',
  arrowright: 'arrowright',
};

/**
 * Превращает нажатие в описание сочетания клавиш.
 *
 * @param event - событие `keydown` (или совместимый объект в тестах)
 * @returns разобранное сочетание либо `null`, если нажата только клавиша-
 *   модификатор (`Control`, `Shift`, `Alt`, `Meta`) — самостоятельного действия
 *   у неё нет, и одиночный биндинг по ней срабатывать не должен
 */
export function parseKey(event: HotkeyKeyEvent): ParsedHotkey | null {
  const raw = event.key.toLowerCase();
  const key = SPECIAL_KEYS[raw] ?? raw;

  if (key === 'control' || key === 'shift' || key === 'alt' || key === 'meta') {
    return null;
  }

  return {
    key,
    ctrl: event.ctrlKey === true,
    shift: event.shiftKey === true,
    alt: event.altKey === true,
    meta: event.metaKey === true,
  };
}

/**
 * Разбирает описание клавиши из bindings: `ctrl+shift+z` → модификаторы и `z`.
 *
 * @param binding - описание в lower-case (`'s'`, `'ctrl+d'`, `'tab'`)
 * @returns разобранное сочетание
 */
export function parseBinding(binding: string): ParsedHotkey {
  const parts = binding.toLowerCase().split('+');
  // Пустые части (`'ctrl+'`) отбрасываем, сама клавиша — последняя значимая.
  const meaningful = parts.filter((part) => part !== '');
  const key = meaningful.at(-1) ?? '';

  return {
    key,
    ctrl: meaningful.includes('ctrl'),
    shift: meaningful.includes('shift'),
    alt: meaningful.includes('alt'),
    meta: meaningful.includes('meta'),
  };
}

/**
 * Проверяет, что нажатие соответствует биндингу.
 *
 * Семантика:
 * - `ctrl`/`alt`/`meta` сверяются **строго** — и в сторону «нажато, а в
 *   биндинге нет» (`ctrl+s` не перехватывает одиночный `s`), и в сторону
 *   «в биндинге есть, а не нажато» (`ctrl+d` не срабатывает без Ctrl);
 * - у сочетания с `ctrl`/`alt`/`meta` `shift` тоже строгий: `ctrl+s` — это
 *   ровно Ctrl+S, а `Ctrl+Shift+S` в него не попадает;
 * - `shift` нестрогий только для **одиночной** клавиши: `S` — это и `s`, и
 *   `Shift+S` (пользователь не отпускает Shift мгновенно, получая заглавную
 *   букву);
 * - биндинг со своим `shift` (`shift+c`) требует Shift явно.
 *
 * Благодаря строгости `ctrl` одиночный `s` не может перехватить `Ctrl+S` — это
 * вторая половина правила приоритета `ctrl+*` > `shift+*` > одиночные.
 *
 * @param pressed - разобранное нажатие из {@link parseKey}
 * @param binding - разобранный биндинг из {@link parseBinding}
 * @returns `true`, если сочетание совпало
 */
export function matchesHotkey(
  pressed: ParsedHotkey,
  binding: ParsedHotkey,
): boolean {
  if (pressed.key !== binding.key) {
    return false;
  }

  const { ctrl: pressedCtrl, alt: pressedAlt, meta: pressedMeta } = pressed;

  if (
    pressedCtrl !== binding.ctrl ||
    pressedAlt !== binding.alt ||
    pressedMeta !== binding.meta
  ) {
    return false;
  }

  const isSingleKey = !binding.ctrl && !binding.alt && !binding.meta;

  if (binding.shift) {
    // `shift+c` — требует Shift явно (`Ctrl+Shift+C` отсекается выше, на
    // строгой сверке `ctrl`).
    return pressed.shift;
  }

  // Одиночная клавиша переживает зажатый Shift (заглавная буква — та же
  // клавиша); сочетание с `ctrl`/`alt`/`meta` — нет: `Ctrl+Shift+S` не должен
  // уходить в обработчик `Ctrl+S`.
  //
  // R6.4b.2b-fix: раньше эта ветка безусловно возвращала `false` для любого
  // `ctrl`/`alt`/`meta`-биндинга (проверялись поля **нажатия** наоборот —
  // `!pressed.ctrl && …`), из-за чего `Ctrl+D` (R6.4a) не срабатывал вовсе.
  return isSingleKey || !pressed.shift;
}

/**
 * Приоритет биндинга: чем больше число, тем раньше он проверяется (KI-186).
 *
 * `Ctrl+S` не должен срабатывать как одиночный `S` — поэтому сочетания с
 * `ctrl`/`meta`/`alt` проверяются раньше, затем `shift+*`, затем одиночные.
 *
 * @param binding - разобранный биндинг
 * @returns уровень приоритета: 2 — ctrl/alt/meta, 1 — shift, 0 — одиночная
 */
export function bindingPriority(binding: ParsedHotkey): number {
  if (binding.ctrl || binding.alt || binding.meta) {
    return 2;
  }

  return binding.shift ? 1 : 0;
}

/**
 * Проверяет, что фокус находится в поле ввода.
 *
 * Покрывает `INPUT`, `TEXTAREA`, `SELECT` и любой элемент с активным
 * `contenteditable` (в нём пользователь печатает текст, а не управляет графом).
 *
 * @param element - активный элемент документа (или `null`)
 * @returns `true`, если горячие клавиши перехватывать нельзя
 */
export function isInputElement(
  element: EditableCandidate | null | undefined,
): boolean {
  if (element === null || element === undefined) {
    return false;
  }

  if (element.isContentEditable === true) {
    return true;
  }

  return EDITABLE_TAGS.includes((element.tagName ?? '').toUpperCase());
}
