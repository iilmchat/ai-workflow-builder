import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import { ApiError } from '@/lib/api';
import { loginAsync, registerAsync } from '@/lib/auth-api';
import {
  PASSWORD_MAX,
  isValidEmail,
  isValidPassword,
} from '@/lib/auth-validate';
import { useAuthStore } from '@/stores/auth';

/** Режим формы: вход или регистрация. */
type Mode = 'login' | 'register';

/**
 * Переводит ошибку запроса в текст для пользователя.
 *
 * @param error - пойманное исключение
 * @param translate - функция перевода
 * @returns ключ перевода
 */
function errorKeyOf(error: unknown, translate: (key: string) => string): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return translate('auth.login.error.emailTaken');
    }

    if (error.status === 401) {
      return translate('auth.login.error.invalid');
    }

    if (error.status === undefined) {
      return translate('auth.login.error.network');
    }
  }

  return translate('auth.login.error.network');
}

/**
 * Страница входа и регистрации.
 *
 * Одна форма на два режима: переключатель меняет подпись кнопки и вызов
 * (`loginAsync` / `registerAsync`). После успеха сессия кладётся в стор
 * (access — в память), и происходит переход в редактор.
 *
 * @returns разметка страницы
 */
export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((state) => state.setSession);

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // KI-157: контролируемые поля теряют позицию курсора при перерисовке.
  const handleEmailChange = usePreserveCursor<HTMLInputElement>(setEmail);
  const handlePasswordChange = usePreserveCursor<HTMLInputElement>(setPassword);

  /**
   * Отправляет форму: валидирует поля и вызывает API.
   *
   * @param event - событие submit
   * @returns промис без значения
   */
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    if (!isValidEmail(email)) {
      setError(t('auth.validation.email'));

      return;
    }

    if (!isValidPassword(password)) {
      setError(t('auth.validation.passwordLength'));

      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const result =
        mode === 'login'
          ? await loginAsync(email, password)
          : await registerAsync(email, password);

      setSession(result.user, result.accessToken);
      // KI-228: возвращаемся на исходный query (например, ?workflowId=…),
      // который ProtectedRoute сохранил при редиректе на форму входа.
      void navigate({ pathname: '/', search: location.search }, { replace: true });
    } catch (caught) {
      setError(errorKeyOf(caught, t));
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Переключает режим формы и сбрасывает ошибку.
   *
   * @returns промис без значения
   */
  const handleToggle = () => {
    setMode((current) => (current === 'login' ? 'register' : 'login'));
    setError(null);
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-lg"
      >
        <h1 className="text-lg font-semibold text-foreground">
          {t('auth.login.title')}
        </h1>

        <label className="mt-4 block text-xs font-medium text-muted-foreground">
          {t('auth.login.email')}
          <input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={handleEmailChange}
            aria-label={t('auth.login.email')}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </label>

        <label className="mt-3 block text-xs font-medium text-muted-foreground">
          {t('auth.login.password')}
          <input
            type="password"
            name="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            maxLength={PASSWORD_MAX}
            value={password}
            onChange={handlePasswordChange}
            aria-label={t('auth.login.password')}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </label>

        {error !== null && (
          <p role="alert" className="mt-3 text-xs text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-4 w-full cursor-pointer rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mode === 'login' ? t('auth.login.submit') : t('auth.login.register')}
        </button>

        <button
          type="button"
          onClick={handleToggle}
          className="mt-3 w-full cursor-pointer text-center text-xs text-blue-600 hover:underline"
        >
          {mode === 'login'
            ? t('auth.login.toggle.toRegister')
            : t('auth.login.toggle.toLogin')}
        </button>
      </form>
    </div>
  );
}
