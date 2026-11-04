/**
 * Тесты query-параметров `GET /admin/audit` (v1.1.0 S3, KI-585).
 *
 * Компонентный тест `TeamPage` проверяет, что UI передаёт фильтры в
 * `fetchAuditLogsAsync`, но не проверяет, как они превращаются в query-строку.
 * Здесь — граница API: пустые фильтры не отправляются, курсор и фильтры
 * уходят вместе, значения кодируются `URLSearchParams`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAuditLogsAsync } from './audit-api';

/** Автор действия для фильтра. */
const AUTHOR_ID = '88888888-8888-4888-8888-888888888888';

/** Пустая страница журнала — минимальный валидный ответ backend. */
const EMPTY_PAGE = { logs: [], nextCursor: null, total: 0 };

/** Собирает JSON-ответ на запрос. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('audit-api — фильтры журнала (v1.1.0 S3)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(jsonResponse(EMPTY_PAGE)));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * Возвращает URL первого запроса.
   *
   * @returns разобранный URL с query-параметрами
   */
  function requestUrl(): URL {
    const call = fetchMock.mock.calls[0] as [string] | undefined;

    return new URL(String(call?.[0]), 'http://localhost');
  }

  it('без фильтров отправляет только limit', async () => {
    await fetchAuditLogsAsync();

    const url = requestUrl();

    expect(url.pathname).toBe('/admin/audit');
    expect(url.searchParams.get('limit')).toBe('20');
    expect([...url.searchParams.keys()]).toEqual(['limit']);
  });

  it('передаёт action/userId/from/to и курсор', async () => {
    await fetchAuditLogsAsync(5, 'cursor-page-2', {
      action: 'workflow.create',
      userId: AUTHOR_ID,
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-02T23:59:59.999Z',
    });

    const params = requestUrl().searchParams;

    expect(params.get('limit')).toBe('5');
    expect(params.get('cursor')).toBe('cursor-page-2');
    expect(params.get('action')).toBe('workflow.create');
    expect(params.get('userId')).toBe(AUTHOR_ID);
    expect(params.get('from')).toBe('2026-11-01T00:00:00.000Z');
    expect(params.get('to')).toBe('2026-11-02T23:59:59.999Z');
  });

  it('не отправляет пустые значения фильтров', async () => {
    await fetchAuditLogsAsync(20, null, {
      action: '',
      userId: undefined,
      from: '',
      to: undefined,
    });

    expect([...requestUrl().searchParams.keys()]).toEqual(['limit']);
  });
});
