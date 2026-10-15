import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { refreshSessionAsync } from '@/lib/api';

/**
 * Восстанавливает сессию при загрузке страницы.
 *
 * Access-токен живёт только в памяти, поэтому после F5 его нужно получить
 * заново: `POST /auth/refresh` уходит с httpOnly-cookie (её ставит браузер),
 * backend ротирует refresh-токен и возвращает новый access.
 *
 * Пока попытка не завершена, `status` остаётся `unknown` — `ProtectedRoute`
 * показывает заглушку и не редиректит раньше времени.
 *
 * @param props.children - поддерево приложения
 * @returns поддерево без дополнительной разметки
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // `refreshSessionAsync` — single-flight: в StrictMode эффект вызывается
    // дважды, но запрос на backend уходит один (иначе вторая ротация
    // отозвала бы только что выданный токен).
    void refreshSessionAsync();
  }, []);

  return <>{children}</>;
}
