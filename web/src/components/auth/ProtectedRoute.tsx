import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
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
  const location = useLocation();
  const status = useAuthStore((state) => state.status);

  if (status === 'unknown') {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        {t('auth.bootstrap.loading')}
      </div>
    );
  }

  if (status !== 'authenticated') {
    // KI-228: query (?workflowId=…) сохраняем — иначе ссылка на граф теряется
    // при переходе на форму входа и после логина пользователь попадает в пустой
    // редактор.
    return <Navigate to={{ pathname: '/login', search: location.search }} replace />;
  }

  return <>{children}</>;
}
