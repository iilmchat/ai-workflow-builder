import { describe, expect, it } from 'vitest';
import {
  parseMaxResultsInput,
  readWebSearchResults,
  validateMaxResults,
  validateQuery,
} from './web-search-node-fields';

describe('web-search-node-fields (v0.10 S2)', () => {
  it('validateMaxResults принимает только целые 1–10', () => {
    expect(validateMaxResults(1)).toBe(1);
    expect(validateMaxResults(10)).toBe(10);
    expect(validateMaxResults(0)).toBeUndefined();
    expect(validateMaxResults(11)).toBeUndefined();
    expect(validateMaxResults(2.5)).toBeUndefined();
    expect(validateMaxResults('5')).toBeUndefined();
    expect(validateMaxResults(undefined)).toBeUndefined();
  });

  it('parseMaxResultsInput разбирает строку и пустое значение', () => {
    expect(parseMaxResultsInput('7')).toBe(7);
    expect(parseMaxResultsInput('')).toBeUndefined();
    expect(parseMaxResultsInput('  ')).toBeUndefined();
    expect(parseMaxResultsInput('abc')).toBeUndefined();
  });

  it('validateQuery не подставляет запрос за пользователя', () => {
    expect(validateQuery('  typescript ')).toBe('  typescript ');
    expect(validateQuery(undefined)).toBe('');
    expect(validateQuery(42)).toBe('');
  });

  it('readWebSearchResults отбрасывает битые элементы и ограничивает список', () => {
    const valid = {
      title: 'A',
      url: 'https://example.com/a',
      snippet: 'snippet',
    };

    expect(readWebSearchResults(undefined)).toEqual([]);
    expect(readWebSearchResults({ results: 'nope' })).toEqual([]);
    expect(
      readWebSearchResults({
        results: [valid, null, { title: 1 }, { ...valid, url: 2 }],
      }),
    ).toEqual([valid]);

    const many = Array.from({ length: 15 }, (_, index) => ({
      ...valid,
      title: `A${index}`,
    }));

    expect(readWebSearchResults({ results: many })).toHaveLength(10);
  });
});
