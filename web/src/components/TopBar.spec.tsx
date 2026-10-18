import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '@/lib/app-version';
import ru from '@/i18n/ru.json';
import { TopBar } from './TopBar';

/**
 * Копирайт и версия в шапке (RULES 1.11/1.12, KI-446).
 *
 * Проверяется то, что нельзя проверить сборкой: версия действительно попала в
 * разметку, а не осталась константой в модуле. Строки берутся из `ru.json`
 * (язык зафиксирован в `src/test/setup.ts`), чтобы тест не дублировал перевод
 * литералом.
 */
beforeAll(() => {
  // jsdom не реализует `matchMedia`, а `useTheme` читает из него системную тему
  // (TopBar рендерит кнопку переключения темы).
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

/**
 * Рендерит шапку в роутере: `TopBar` использует `useNavigate` при выходе
 * из аккаунта.
 *
 * @returns результат `render` (доступ к `container` для поиска по `data-*`)
 */
function renderTopBar() {
  return render(
    <MemoryRouter>
      <TopBar />
    </MemoryRouter>,
  );
}

describe('TopBar — версия и копирайт (KI-446)', () => {
  it('показывает строку «© 2026 RuChating (iilmchat) · vX.Y.Z»', () => {
    const { container } = renderTopBar();
    const line = container.querySelector('[data-app-version]');

    expect(line).not.toBeNull();
    expect(line).toHaveAttribute('data-app-version', APP_VERSION);
    expect(line).toHaveTextContent(
      ru['topbar.copyright'].replace('{{version}}', APP_VERSION),
    );
  });

  it('в тултипе — полная форма копирайта с названием продукта (RULES 1.12)', () => {
    const { container } = renderTopBar();
    const line = container.querySelector('[data-app-version]');

    expect(line).toHaveAttribute(
      'title',
      ru['topbar.copyright.full'].replace('{{version}}', APP_VERSION),
    );
  });

  it('строка не перехватывает клики и не мешает шапке', () => {
    const { container } = renderTopBar();
    const line = container.querySelector('[data-app-version]');

    // Подпись — пассивный текст: не кнопка и не ссылка.
    expect(line?.tagName).toBe('SPAN');
    expect(line).toHaveClass('text-muted-foreground');
  });

  it('имя workflow остаётся редактируемым полем', () => {
    renderTopBar();

    expect(
      screen.getByPlaceholderText(ru['topbar.name.placeholder']),
    ).toBeInTheDocument();
  });
});
