import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAsync } from './api';
import { useAuthStore } from '@/stores/auth';

/**
 * Заголовки `sendAsync` (KI-479, DESIGN v0.11 § 3.1.8).
 *
 * `sendAsync` не экспортируется, поэтому проверяется через публичный
 * `requestAsync` с подменённым `fetch`: тест смотрит ровно на `Headers`,
 * которые ушли бы в сеть. Backend меняет только `Content-Type`-ветку, поэтому
 * остальные опции (`method`, `body`) не влияют на результат.
 */

/**
 * Заглушка `fetch`, возвращающая JSON-ответ.
 *
 * @param body - тело ответа
 * @param status - HTTP-статус (по умолчанию 200)
 * @returns объект, минимально совместимый с `Response` для `parseResponseAsync`
 */
function jsonResponse(body: unknown, status = 200): Response {
  const text = JSON.stringify(body);

  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

/**
 * Ставит заглушку `fetch` и возвращает её.
 *
 * @param implementation - реализация `fetch`
 * @returns mock-функция
 */
function stubFetch(
  implementation: (url: string, init: RequestInit) => Response = () => jsonResponse({}),
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string, init: RequestInit) =>
    Promise.resolve(implementation(url, init)),
  );
  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

/**
 * Достаёт заголовки из вызова `fetch`.
 *
 * @param fetchMock - подменённый `fetch`
 * @param index - индекс вызова
 * @returns заголовки запроса
 */
function headersOf(fetchMock: ReturnType<typeof vi.fn>, index = 0): Headers {
  const call = fetchMock.mock.calls[index] as [string, RequestInit];

  return call[1].headers as Headers;
}

/**
 * Достаёт тело из вызова `fetch`.
 *
 * @param fetchMock - подменённый `fetch`
 * @param index - индекс вызова
 * @returns `body` запроса
 */
function bodyOf(fetchMock: ReturnType<typeof vi.fn>, index = 0): BodyInit | null {
  const call = fetchMock.mock.calls[index] as [string, RequestInit];

  return call[1].body ?? null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useAuthStore.getState().clearSession();
});

describe('requestAsync: Content-Type (KI-479)', () => {
  it('FormData уходит без Content-Type: boundary добавит браузер', async () => {
    const fetchMock = stubFetch();
    const formData = new FormData();
    formData.append('name', 'Договор 2026');

    await requestAsync('/workflow/11111111-1111-4111-8111-111111111111/document-templates', {
      method: 'POST',
      body: formData,
    });

    const headers = headersOf(fetchMock);
    expect(headers.has('Content-Type')).toBe(false);
    expect(bodyOf(fetchMock)).toBe(formData);
  });

  it('JSON-тело по-прежнему получает application/json', async () => {
    const fetchMock = stubFetch();

    await requestAsync('/workflow', {
      method: 'POST',
      body: JSON.stringify({ name: 'Graph' }),
    });

    expect(headersOf(fetchMock).get('Content-Type')).toBe('application/json');
  });

  it('явно заданный Content-Type не перезаписывается', async () => {
    const fetchMock = stubFetch();

    await requestAsync('/media/upload', {
      method: 'POST',
      body: 'raw-bytes',
      headers: { 'Content-Type': 'application/octet-stream' },
    });

    expect(headersOf(fetchMock).get('Content-Type')).toBe('application/octet-stream');
  });

  it('FormData с токеном: Authorization ставится, Content-Type — нет', async () => {
    const fetchMock = stubFetch();
    useAuthStore.getState().setSession(
      { id: 'user-1', email: 'user@example.com', createdAt: '2026-01-01T00:00:00.000Z' },
      'access-token-1',
    );
    const formData = new FormData();
    formData.append('file', new Blob(['docx']), 'contract.docx');

    await requestAsync('/workflow/11111111-1111-4111-8111-111111111111/document-templates', {
      method: 'POST',
      body: formData,
    });

    const headers = headersOf(fetchMock);
    expect(headers.get('Authorization')).toBe('Bearer access-token-1');
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('после refresh FormData повторяется с тем же телом (KI-479)', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['docx']), 'contract.docx');
    let call = 0;
    const fetchMock = vi.fn(() => {
      call += 1;

      if (call === 1) {
        return Promise.resolve(jsonResponse({ message: 'Нет токена' }, 401));
      }

      if (call === 2) {
        return Promise.resolve(
          jsonResponse({
            user: {
              id: 'user-1',
              email: 'user@example.com',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            accessToken: 'access-token-2',
          }),
        );
      }

      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    await requestAsync('/workflow/11111111-1111-4111-8111-111111111111/document-templates', {
      method: 'POST',
      body: formData,
    });

    // 1 — исходный 401, 2 — POST /auth/refresh, 3 — повтор исходного запроса.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(bodyOf(fetchMock, 2)).toBe(formData);
    expect(headersOf(fetchMock, 2).has('Content-Type')).toBe(false);
    expect(headersOf(fetchMock, 2).get('Authorization')).toBe('Bearer access-token-2');
  });
});
