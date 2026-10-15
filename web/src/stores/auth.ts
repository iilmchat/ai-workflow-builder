import { create } from 'zustand';

/** Публичные данные пользователя (как отдаёт backend). */
export interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

/** Состояние сессии. */
interface AuthState {
  user: AuthUser | null;
  /**
   * Access-токен живёт **только в памяти** (R6.1b.2): localStorage
   * недоступен XSS-скриптам как источник токена. При F5 сессия
   * восстанавливается через `POST /auth/refresh` (httpOnly-cookie).
   */
  accessToken: string | null;
  /**
   * `unknown` — до первой попытки restore; `guest` — не залогинен;
   * `authenticated` — есть пользователь и access-токен.
   */
  status: 'unknown' | 'guest' | 'authenticated';

  /** Сохраняет сессию после login/register/refresh. */
  setSession: (user: AuthUser, accessToken: string) => void;
  /** Сбрасывает сессию (logout или неудачный refresh). */
  clearSession: () => void;
  /** Меняет только статус (например, `guest` при сетевой ошибке). */
  setStatus: (status: 'unknown' | 'guest' | 'authenticated') => void;
}

/**
 * Стор аутентификации.
 *
 * Токен и пользователь — в памяти процесса: перезагрузка страницы сбрасывает
 * состояние, а `AuthProvider` восстанавливает его через refresh-cookie.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  status: 'unknown',
  setSession: (user, accessToken) => set({ user, accessToken, status: 'authenticated' }),
  clearSession: () => set({ user: null, accessToken: null, status: 'guest' }),
  setStatus: (status) => set({ status }),
}));

/**
 * Текущий access-токен без подписки на стор.
 *
 * Нужен интерцептору `fetch` и другим не-React местам.
 *
 * @returns access-токен либо `null`, если сессии нет
 */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
