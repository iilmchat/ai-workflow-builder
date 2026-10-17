import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCollaboratorsAsync,
  inviteCollaboratorAsync,
  removeCollaboratorAsync,
  updateCollaboratorRoleAsync,
} from './collaborators-api';

/** Стабильные идентификаторы (валидные uuid). */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const INVITED_AT = '2026-10-17T10:00:00.000Z';

/** Строка ответа backend `CollaboratorResponse`. */
const collaborator = {
  userId: USER_ID,
  email: 'viewer@example.com',
  role: 'viewer',
  invitedAt: INVITED_AT,
  invitedBy: '22222222-2222-4222-8222-222222222222',
} as const;

/**
 * Собирает успешный JSON-ответ.
 *
 * @param body - тело ответа
 * @returns Response с JSON-телом
 */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('collaborators-api (R7.6)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(jsonResponse([collaborator])));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetchCollaboratorsAsync делает GET и разбирает список', async () => {
    const result = await fetchCollaboratorsAsync(WORKFLOW_ID);

    expect(result).toEqual([collaborator]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/workflow/${WORKFLOW_ID}/collaborators`,
    );
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBeUndefined();
  });

  it('inviteCollaboratorAsync отправляет POST с userId и role (форма инвайта)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(collaborator));

    const result = await inviteCollaboratorAsync(WORKFLOW_ID, {
      userId: USER_ID,
      role: 'viewer',
    });

    expect(result).toEqual(collaborator);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(`/workflow/${WORKFLOW_ID}/collaborators`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ userId: USER_ID, role: 'viewer' });
  });

  it('inviteCollaboratorAsync не отправляет запрос с невалидным uuid', async () => {
    await expect(
      inviteCollaboratorAsync(WORKFLOW_ID, {
        userId: 'not-a-uuid',
        role: 'viewer',
      }),
    ).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('updateCollaboratorRoleAsync отправляет PATCH с новой ролью', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...collaborator, role: 'editor' }));

    await updateCollaboratorRoleAsync(WORKFLOW_ID, USER_ID, 'editor');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(`/workflow/${WORKFLOW_ID}/collaborators/${USER_ID}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ role: 'editor' });
  });

  it('removeCollaboratorAsync отправляет DELETE и не ждёт тела', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      removeCollaboratorAsync(WORKFLOW_ID, USER_ID),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(`/workflow/${WORKFLOW_ID}/collaborators/${USER_ID}`);
    expect(init.method).toBe('DELETE');
  });
});
