import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { LoginPage } from './LoginPage';

/**
 * Логотип на странице входа (v0.10 S2).
 *
 * Проверяем то, что не видно сборке: `alt`, высоту 64 px и переключение
 * светлого/тёмного SVG по сохранённой теме.
 */
beforeAll(() => {
  // jsdom не реализует `matchMedia`, а `useTheme` читает из него системную тему.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
});

beforeEach(() => {
  window.localStorage.setItem('theme', 'light');
});

/**
 * Рендерит страницу входа в роутере.
 *
 * @returns результат `render`
 */
function renderLoginPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage — логотип (v0.10 S2)', () => {
  it('показывает логотип 64 px с alt="IIRuChating"', () => {
    renderLoginPage();

    const logo = screen.getByAltText('IIRuChating');

    expect(logo.tagName).toBe('IMG');
    expect(logo).toHaveClass('h-16');
    expect(logo).toHaveAttribute('src', '/logo.svg');
  });

  it('в тёмной теме подставляет logo-dark.svg', () => {
    window.localStorage.setItem('theme', 'dark');

    renderLoginPage();

    expect(screen.getByAltText('IIRuChating')).toHaveAttribute(
      'src',
      '/logo-dark.svg',
    );
  });
});
