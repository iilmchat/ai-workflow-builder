import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/auth';

/**
 * Пускает дальше только аутентифицированных.
 *
 * Пока идёт восстановление сессии (`unknown`), показываем заглушку: иначе
 * пользователь с валидной cookie на миг увидел бы форму входа.
 *
 * @param props.children - защищённое поддерево
 * @returns поддерево либо редирект на `/login`
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const status = useAuthStore((state) => state.status);

  if (status === 'unknown') {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        {t('auth.bootstrap.loading')}
      </div>
    );
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
