import { describe, expect, it } from 'vitest';
import {
  bindingPriority,
  isInputElement,
  matchesHotkey,
  parseBinding,
  parseKey,
  type HotkeyKeyEvent,
} from './hotkeys-utils';

/**
 * Собирает событие клавиатуры для тестов.
 *
 * @param key - значение `KeyboardEvent.key`
 * @param modifiers - нажатые модификаторы
 * @returns объект, совместимый с `HotkeyKeyEvent`
 */
function keyEvent(
  key: string,
  modifiers: Partial<Pick<HotkeyKeyEvent, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>> = {},
): HotkeyKeyEvent {
  return { key, ...modifiers };
}

describe('parseKey (KI-186)', () => {
  it('одиночная клавиша: s', () => {
    expect(parseKey(keyEvent('s'))).toEqual({
      key: 's',
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
    });
  });

  it('Ctrl+S: клавиша в lower-case, ctrl отмечен', () => {
    expect(parseKey(keyEvent('S', { ctrlKey: true }))).toEqual({
      key: 's',
      ctrl: true,
      shift: false,
      alt: false,
      meta: false,
    });
  });

  it('Ctrl+Shift+Z', () => {
    expect(parseKey(keyEvent('Z', { ctrlKey: true, shiftKey: true }))).toEqual({
      key: 'z',
      ctrl: true,
      shift: true,
      alt: false,
      meta: false,
    });
  });

  it('Tab', () => {
    expect(parseKey(keyEvent('Tab'))?.key).toBe('tab');
  });

  it('пробел нормализуется в space', () => {
    expect(parseKey(keyEvent(' '))?.key).toBe('space');
  });

  it('Escape нормализуется в escape', () => {
    expect(parseKey(keyEvent('Escape'))?.key).toBe('escape');
  });

  it('одна клавиша-модификатор не даёт биндинга', () => {
    expect(parseKey(keyEvent('Control', { ctrlKey: true }))).toBeNull();
    expect(parseKey(keyEvent('Shift', { shiftKey: true }))).toBeNull();
    expect(parseKey(keyEvent('Alt', { altKey: true }))).toBeNull();
    expect(parseKey(keyEvent('Meta', { metaKey: true }))).toBeNull();
  });
});

describe('parseBinding / matchesHotkey (KI-186)', () => {
  it('описание ctrl+shift+z разбирается в модификаторы и клавишу', () => {
    expect(parseBinding('ctrl+shift+z')).toEqual({
      key: 'z',
      ctrl: true,
      shift: true,
      alt: false,
      meta: false,
    });
  });

  it('одиночный S срабатывает и с зажатым Shift (Shift+S — та же буква)', () => {
    expect(
      matchesHotkey(parseKey(keyEvent('S', { shiftKey: true }))!, parseBinding('s')),
    ).toBe(true);
  });

  it('Ctrl+S не путается с Ctrl+Shift+S (строгий ctrl)', () => {
    expect(
      matchesHotkey(
        parseKey(keyEvent('S', { ctrlKey: true, shiftKey: true }))!,
        parseBinding('ctrl+s'),
      ),
    ).toBe(false);
  });

  it('одиночный S не срабатывает на Ctrl+S (разные приоритеты)', () => {
    expect(
      matchesHotkey(parseKey(keyEvent('S', { ctrlKey: true }))!, parseBinding('s')),
    ).toBe(false);
  });

  it('shift+c требует Shift', () => {
    expect(matchesHotkey(parseKey(keyEvent('c'))!, parseBinding('shift+c'))).toBe(
      false,
    );
    expect(
      matchesHotkey(parseKey(keyEvent('C', { shiftKey: true }))!, parseBinding('shift+c')),
    ).toBe(true);
  });

  it('приоритет: ctrl+* > shift+* > одиночные', () => {
    expect(bindingPriority(parseBinding('ctrl+s'))).toBe(2);
    expect(bindingPriority(parseBinding('shift+c'))).toBe(1);
    expect(bindingPriority(parseBinding('s'))).toBe(0);
  });
});

describe('isInputElement (KI-186)', () => {
  it('INPUT/TEXTAREA/SELECT — поле ввода', () => {
    expect(isInputElement({ tagName: 'INPUT' })).toBe(true);
    expect(isInputElement({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isInputElement({ tagName: 'SELECT' })).toBe(true);
  });

  it('contenteditable — поле ввода', () => {
    expect(isInputElement({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('обычный DIV — не поле ввода', () => {
    expect(isInputElement({ tagName: 'DIV' })).toBe(false);
  });

  it('null и отсутствующие свойства безопасны', () => {
    expect(isInputElement(null)).toBe(false);
    expect(isInputElement(undefined)).toBe(false);
    expect(isInputElement({})).toBe(false);
  });

  it('регистр тега не важен', () => {
    expect(isInputElement({ tagName: 'input' })).toBe(true);
  });
});
