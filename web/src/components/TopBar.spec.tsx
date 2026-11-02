import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fetchWorkflowRunsAsync } from '@/lib/api';
import { APP_VERSION } from '@/lib/app-version';
import ru from '@/i18n/ru.json';
import { useWorkflowStore } from '@/stores/workflow';
import { TopBar } from './TopBar';

/**
 * Мок API истории запусков (v0.14 S2).
 *
 * При открытии `RunHistoryModal` сразу грузит первую страницу; в тесте шапки
 * сеть не нужна. Остальные функции `@/lib/api` остаются настоящими — их
 * импортирует стор, и подменять весь модуль ради одной функции не нужно.
 */
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();

  return {
    ...actual,
    fetchWorkflowRunsAsync: vi.fn(() =>
      Promise.resolve({ runs: [], nextCursor: null, total: 0 }),
    ),
  };
});

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

  it('показывает логотип 24 px слева от названия проекта (v0.10 S2)', () => {
    renderTopBar();

    const logo = screen.getByAltText('IIRuChating');

    expect(logo.tagName).toBe('IMG');
    expect(logo).toHaveClass('h-6');
    expect(logo).toHaveAttribute('src', '/logo.svg');
  });
});

describe('TopBar — история запусков (v0.14 S2)', () => {
  /** Сохранённый workflow, для которого история доступна. */
  const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';

  afterEach(() => {
    useWorkflowStore.setState({ currentWorkflowId: null, accessRole: null });
    vi.mocked(fetchWorkflowRunsAsync).mockClear();
  });

  it('кнопка «История» disabled, пока workflow не сохранён', () => {
    const { container } = renderTopBar();
    const button = container.querySelector('[data-topbar-history]');

    expect(button).not.toBeNull();
    expect(button).toBeDisabled();
  });

  it('клик открывает модалку истории сохранённого workflow', async () => {
    const { container } = renderTopBar();
    const button = container.querySelector(
      '[data-topbar-history]',
    ) as HTMLButtonElement;

    // Сначала новый (несохранённый) workflow: кнопка заблокирована.
    expect(button).toBeDisabled();

    // Появление id в сторе перерисовывает шапку и снимает блокировку —
    // проверяем именно переход, а не заранее выставленное состояние.
    act(() => {
      useWorkflowStore.setState({ currentWorkflowId: WORKFLOW_ID });
    });

    await waitFor(() => expect(button).not.toBeDisabled());

    fireEvent.click(button);

    expect(
      await screen.findByRole('dialog', { name: ru['history.title'] }),
    ).toBeInTheDocument();
    // Модалка сразу грузит первую страницу истории (v0.16 S1: без курсора).
    await waitFor(() =>
      expect(vi.mocked(fetchWorkflowRunsAsync)).toHaveBeenCalledWith(
        WORKFLOW_ID,
        20,
      ),
    );
  });

  it('viewer не видит кнопку: история требует роль editor (KI-537)', () => {
    useWorkflowStore.setState({
      currentWorkflowId: WORKFLOW_ID,
      accessRole: 'viewer',
    });

    const { container } = renderTopBar();

    expect(container.querySelector('[data-topbar-history]')).toBeNull();
  });
});

describe('TopBar — единый статус с номером попытки (v0.16 S1, KI-545)', () => {
  afterEach(() => {
    useWorkflowStore.setState({
      runStatus: null,
      attemptNumber: 0,
      attempts: null,
      runHasMoreAttempts: false,
    });
  });

  it('running с попыткой показывает «Выполняется (попытка 2/3)»', () => {
    useWorkflowStore.setState({
      runStatus: 'running',
      attemptNumber: 2,
      attempts: 3,
      runHasMoreAttempts: true,
    });

    const { container } = renderTopBar();
    const button = container.querySelector('[data-topbar-run]');
    const badge = container.querySelector('[data-run-badge]');

    // Один неймспейс `status.*`: текст складывается из `status.running` и
    // `status.attempt`; суффикс попытки не потерялся при унификации (KI-545).
    expect(button?.textContent ?? '').toContain(
      'Выполняется (попытка 2/3)',
    );
    expect(badge?.textContent ?? '').toContain(
      'Выполняется (попытка 2/3)',
    );
  });
});
