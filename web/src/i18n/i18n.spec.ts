import { describe, expect, it } from 'vitest';
import ru from './ru.json';
import en from './en.json';

describe('i18n паритет ключей', () => {
  it('ru.json и en.json содержат одинаковый набор ключей', () => {
    const ruKeys = Object.keys(ru).sort();
    const enKeys = Object.keys(en).sort();

    expect(ruKeys).toEqual(enKeys);
  });

  it('нет пустых значений', () => {
    for (const [key, value] of Object.entries(ru)) {
      expect(value, `ru.${key} пусто`).toBeTruthy();
    }

    for (const [key, value] of Object.entries(en)) {
      expect(value, `en.${key} пусто`).toBeTruthy();
    }
  });
});
