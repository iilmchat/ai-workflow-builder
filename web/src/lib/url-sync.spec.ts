import { describe, expect, it } from 'vitest';
import { runIdOf, withRunId, withoutRunId } from './url-sync';

/** Базовый URL редактора с уже сохранённым workflow и посторонним параметром. */
const BASE_URL = 'http://localhost:5173/?workflowId=w-1&foo=bar';

describe('url-sync: ?runId= в адресной строке (KI-271)', () => {
  it('withRunId добавляет runId, сохраняя workflowId, другие параметры и hash', () => {
    const url = withRunId(`${BASE_URL}#top`, 'run-1');
    const parsed = new URL(url);

    expect(parsed.searchParams.get('runId')).toBe('run-1');
    expect(parsed.searchParams.get('workflowId')).toBe('w-1');
    expect(parsed.searchParams.get('foo')).toBe('bar');
    expect(parsed.hash).toBe('#top');
  });

  it('withRunId перезаписывает прежний runId, а не дублирует параметр', () => {
    const url = withRunId(withRunId(BASE_URL, 'run-1'), 'run-2');

    expect(new URL(url).searchParams.getAll('runId')).toEqual(['run-2']);
    expect(url.match(/runId=/g)).toHaveLength(1);
  });

  it('withoutRunId убирает runId и оставляет остальные параметры', () => {
    const url = withoutRunId(withRunId(BASE_URL, 'run-1'));
    const parsed = new URL(url);

    expect(parsed.searchParams.get('runId')).toBeNull();
    expect(parsed.searchParams.get('workflowId')).toBe('w-1');
    expect(parsed.searchParams.get('foo')).toBe('bar');
  });

  it('withoutRunId не меняет URL, в котором runId нет', () => {
    expect(withoutRunId(BASE_URL)).toBe(BASE_URL);
  });

  it('runIdOf читает значение параметра', () => {
    expect(runIdOf(withRunId(BASE_URL, 'run-7'))).toBe('run-7');
  });

  it('runIdOf возвращает null, если параметра нет', () => {
    expect(runIdOf(BASE_URL)).toBeNull();
    expect(runIdOf('http://localhost:5173/')).toBeNull();
  });
});
