import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  fetchLlmHealthAsync,
  fetchWorkflowRunsAsync,
  type LlmHealthResponse,
} from '@/lib/api';
import { APP_VERSION } from '@/lib/app-version';
import { fetchOrganizationMembersAsync } from '@/lib/org-api';
import ru from '@/i18n/ru.json';
import { useAuthStore } from '@/stores/auth';
import { useWorkflowStore } from '@/stores/workflow';
import { TopBar } from './TopBar';

/**
 * Мок API истории запусков (v0.14 S2) и healthcheck'а GPU (v1.2.0 S3).
 *
 * При открытии `RunHistoryModal` сразу грузит первую страницу; в тесте шапки
 * сеть не нужна. `TopBar` при монтировании опрашивает `GET /llm/health` —
 * по умолчанию локальный GPU доступен (online), отдельные тесты переопределяют
 * ответ. Остальные функции `@/lib/api` остаются настоящими — их импортирует
 * стор, и подменять весь модуль ради двух функций не нужно.
 */
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();

  return {
    ...actual,
    fetchWorkflowRunsAsync: vi.fn(() =>
      Promise.resolve({ runs: [], nextCursor: null, total: 0 }),
    ),
    fetchLlmHealthAsync: vi.fn(() =>
      Promise.resolve({
        local: { available: true, lastCheck: '2026-11-06T09:00:00.000Z' },
        routerEnabled: true,
      }),
    ),
  };
});

/**
 * Мок API команды (v1.0.0 S5).
 *
 * `TeamPage` при открытии грузит участников организации; в тесте шапки сеть не
 * нужна — проверяется только факт открытия модалки.
 */
vi.mock('@/lib/org-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org-api')>();

  return {
    ...actual,
    fetchOrganizationMembersAsync: vi.fn(() =>
      Promise.resolve({ members: [], invitations: [] }),
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

describe('TopBar — команда и аудит (v1.0.0 S5)', () => {
  /** Пользователь организации в тестах шапки. */
  const USER = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    organizationId: '22222222-2222-4222-8222-222222222222',
    role: 'member' as const,
  };

  afterEach(() => {
    useAuthStore.setState({ user: null, accessToken: null, status: 'guest' });
    vi.mocked(fetchOrganizationMembersAsync).mockClear();
  });

  it('кнопка «Команда» открывает модалку команды (data-topbar-team)', async () => {
    useAuthStore.getState().setSession(USER, 'access-token');

    const { container } = renderTopBar();
    const button = container.querySelector(
      '[data-topbar-team]',
    ) as HTMLButtonElement | null;

    expect(button).not.toBeNull();
    // Кнопка не зависит от сохранённости workflow: она всегда доступна
    // аутентифицированному пользователю (workflow в тесте не сохранён).
    expect(button).not.toBeDisabled();
    expect(button?.textContent).toContain(ru['topbar.team']);

    fireEvent.click(button as HTMLButtonElement);

    expect(
      await screen.findByRole('dialog', { name: ru['team.title'] }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(vi.mocked(fetchOrganizationMembersAsync)).toHaveBeenCalled(),
    );
  });

  it('гостю кнопка не показывается: без сессии нет организации', () => {
    const { container } = renderTopBar();

    expect(container.querySelector('[data-topbar-team]')).toBeNull();
  });
});

/** healthcheck: локальный GPU доступен (v1.2.0 S3). */
const HEALTH_ONLINE: LlmHealthResponse = {
  local: { available: true, lastCheck: '2026-11-06T09:00:00.000Z' },
  routerEnabled: true,
};

/** healthcheck: LM Studio не ответил (v1.2.0 S3). */
const HEALTH_OFFLINE: LlmHealthResponse = {
  local: { available: false, lastCheck: '2026-11-06T09:00:30.000Z' },
  routerEnabled: true,
};

describe('TopBar — индикатор GPU (v1.2.0 S3)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(fetchLlmHealthAsync).mockReset();
    vi.mocked(fetchLlmHealthAsync).mockResolvedValue(HEALTH_ONLINE);
  });

  it('рисует online-статус, когда локальный GPU доступен', async () => {
    vi.mocked(fetchLlmHealthAsync).mockResolvedValue(HEALTH_ONLINE);

    const { container } = renderTopBar();
    const badge = await waitFor(() => {
      const element = container.querySelector('[data-gpu-status="online"]');
      expect(element).not.toBeNull();

      return element as HTMLElement;
    });

    expect(badge).toHaveTextContent(ru['topbar.gpu.online']);
    expect(container.querySelector('[data-gpu-status="offline"]')).toBeNull();
  });

  it('переходит в offline при ошибке healthcheck', async () => {
    vi.mocked(fetchLlmHealthAsync).mockRejectedValue(
      new Error('backend недоступен'),
    );

    const { container } = renderTopBar();
    const badge = await waitFor(() => {
      const element = container.querySelector('[data-gpu-status="offline"]');
      expect(element).not.toBeNull();

      return element as HTMLElement;
    });

    expect(badge).toHaveTextContent(ru['topbar.gpu.offline']);
  });

  it('offline при local.available=false', async () => {
    vi.mocked(fetchLlmHealthAsync).mockResolvedValue(HEALTH_OFFLINE);

    const { container } = renderTopBar();
    const badge = await waitFor(() => {
      const element = container.querySelector('[data-gpu-status="offline"]');
      expect(element).not.toBeNull();

      return element as HTMLElement;
    });

    expect(badge).toHaveTextContent(ru['topbar.gpu.offline']);
  });

  it('повторяет опрос через 30 000 мс (vi.useFakeTimers)', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchLlmHealthAsync).mockResolvedValue(HEALTH_ONLINE);

    renderTopBar();

    // Первый запрос уходит сразу при монтировании, не дожидаясь интервала.
    await act(async () => {
      await Promise.resolve();
    });
    expect(vi.mocked(fetchLlmHealthAsync)).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(vi.mocked(fetchLlmHealthAsync)).toHaveBeenCalledTimes(2);

    // Интервал ровно 30 с: за 29 999 мс нового запроса нет.
    await act(async () => {
      vi.advanceTimersByTime(29_999);
    });
    expect(vi.mocked(fetchLlmHealthAsync)).toHaveBeenCalledTimes(2);
  });

  it('после unmount не опрашивает и не обновляет состояние', async () => {
    vi.useFakeTimers();

    // Запрос «зависает» до unmount: ответ придёт уже размонтированному
    // компоненту — `cancelled`-флаг обязан погасить setState.
    const pending: { resolve: (value: LlmHealthResponse) => void } = {
      resolve: () => undefined,
    };
    vi.mocked(fetchLlmHealthAsync).mockImplementation(
      () =>
        new Promise<LlmHealthResponse>((resolve) => {
          pending.resolve = resolve;
        }),
    );

    const { unmount } = renderTopBar();

    expect(vi.mocked(fetchLlmHealthAsync)).toHaveBeenCalledTimes(1);

    unmount();

    // clearInterval снял таймер: новых опросов после unmount нет.
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(vi.mocked(fetchLlmHealthAsync)).toHaveBeenCalledTimes(1);

    // Поздний ответ не должен ни упасть, ни обновить состояние размонтированного
    // дерева: React 19 молча игнорирует setState после unmount, но `cancelled`
    // исключает сам вызов обновления.
    await act(async () => {
      pending.resolve(HEALTH_ONLINE);
      await Promise.resolve();
    });
    expect(vi.mocked(fetchLlmHealthAsync)).toHaveBeenCalledTimes(1);
  });
});

