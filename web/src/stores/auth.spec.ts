import { beforeEach, describe, expect, it } from 'vitest';
import { getAccessToken, useAuthStore, type AuthUser } from './auth';

/** Тестовый пользователь. */
const USER: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('useAuthStore (R6.1b.2)', () => {
  beforeEach(() => {
    // Zustand-стор — модульный синглтон: между тестами возвращаем исходное
    // состояние вручную (status по умолчанию — 'unknown').
    useAuthStore.setState({ user: null, accessToken: null, status: 'unknown' });
  });

  it('стартовый статус — unknown (до попытки restore)', () => {
    expect(useAuthStore.getState().status).toBe('unknown');
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('setSession сохраняет пользователя, токен и статус authenticated', () => {
    useAuthStore.getState().setSession(USER, 'access-token');

    const state = useAuthStore.getState();

    expect(state.user).toEqual(USER);
    expect(state.accessToken).toBe('access-token');
    expect(state.status).toBe('authenticated');
  });

  it('clearSession сбрасывает сессию и переводит в guest', () => {
    useAuthStore.getState().setSession(USER, 'access-token');
    useAuthStore.getState().clearSession();

    const state = useAuthStore.getState();

    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.status).toBe('guest');
  });

  it('setStatus меняет только статус', () => {
    useAuthStore.getState().setSession(USER, 'access-token');
    useAuthStore.getState().setStatus('unknown');

    const state = useAuthStore.getState();

    expect(state.status).toBe('unknown');
    // Токен и пользователь остаются — setStatus не сбрасывает сессию.
    expect(state.user).toEqual(USER);
    expect(state.accessToken).toBe('access-token');
  });

  it('getAccessToken читает токен вне React (для интерцептора)', () => {
    expect(getAccessToken()).toBeNull();

    useAuthStore.getState().setSession(USER, 'access-token');

    expect(getAccessToken()).toBe('access-token');

    useAuthStore.getState().clearSession();

    expect(getAccessToken()).toBeNull();
  });
});
