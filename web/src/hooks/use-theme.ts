import { useCallback, useEffect, useState } from 'react';

/** Тема приложения. */
export type Theme = 'light' | 'dark' | 'system';

/** Разрешённая тема (без system). */
export type ResolvedTheme = 'light' | 'dark';

/** Ключ, под которым выбор пользователя лежит в localStorage. */
const STORAGE_KEY = 'theme';

/**
 * Читает системную тему из `matchMedia`.
 *
 * @returns 'dark', если система в тёмной теме (вне браузера — 'light')
 */
function readSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/**
 * Читает сохранённый выбор темы.
 *
 * Невалидное или отсутствующее значение трактуется как 'system'.
 *
 * @returns сохранённая тема либо 'system'
 */
function readStoredTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'system';
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);

  return stored === 'light' || stored === 'dark' || stored === 'system'
    ? stored
    : 'system';
}

/**
 * Читает тему из localStorage, ставит `.dark` на `<html>`,
 * подписывается на изменения системной темы (matchMedia).
 *
 * Инлайн-скрипт в `index.html` делает то же самое до первого рендера — чтобы
 * страница не мигала светлой темой; хук дальше поддерживает состояние.
 *
 * @returns текущая тема, разрешённая тема, сеттер.
 */
export function useTheme(): {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (t: Theme) => void;
} {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(readSystemTheme);

  const resolved: ResolvedTheme = theme === 'system' ? systemTheme : theme;

  // Синхронизирует .dark на <html>: тему читает CSS (.dark { … }).
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  // Подписка на системную тему: нужна для 'system', а при явном выборе просто
  // обновляет состояние (на resolved не влияет).
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setSystemTheme(query.matches ? 'dark' : 'light');

    handler();
    query.addEventListener('change', handler);

    return () => query.removeEventListener('change', handler);
  }, []);

  /**
   * Сохраняет выбор пользователя.
   *
   * `system` убирает ключ из localStorage, чтобы вернуться к поведению
   * «как в операционной системе».
   *
   * @param next - выбранная тема
   */
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);

    if (next === 'system') {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  return { theme, resolved, setTheme };
}
