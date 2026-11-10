import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelRunAsync,
  fetchLlmHealthAsync,
  fetchWorkflowRunsAsync,
  type LlmHealthResponse,
} from '@/lib/api';
import { APP_VERSION } from '@/lib/app-version';
import { computeGraphHash } from '@/lib/graph-hash';
import { fetchOrganizationMembersAsync } from '@/lib/org-api';
import ru from '@/i18n/ru.json';
import { useAuthStore } from '@/stores/auth';
import { useWorkflowStore } from '@/stores/workflow';
import { TopBar } from './TopBar';

/**
 * Мок платформы и нативного QR-сканера (v1.5.0 S1).
 *
 * Кнопка сканера рендерится только при `isNative() === true`, поэтому
 * платформа управляется переменной `qr.native`. Сам сканер подменён: в jsdom
 * нет ни камеры, ни нативного моста Capacitor, а проверить нужно разбор
 * результата и реакцию шапки (`loadWorkflowAsync` / `navigate`).
 */
const qr = vi.hoisted(() => ({
  native: false,
  scanQr: vi.fn(),
}));

vi.mock('@/lib/platform', () => ({
  isNative: () => qr.native,
  isAndroid: () => qr.native,
  isIOS: () => false,
  isWeb: () => !qr.native,
}));

vi.mock('@/hooks/useQrScanner', () => ({ scanQr: qr.scanQr }));

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
    // v1.4.0 S1: отмена запуска из шапки.
    cancelRunAsync: vi.fn(() => Promise.resolve({ status: 'cancelled' })),
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

describe('TopBar — отмена запуска (v1.4.0 S1)', () => {
  /** uuid активного запуска в тестах отмены. */
  const RUN_ID = '33333333-3333-4333-8333-333333333333';

  afterEach(() => {
    useWorkflowStore.setState({ runStatus: null, runId: null });
    vi.mocked(cancelRunAsync).mockClear();
    vi.mocked(cancelRunAsync).mockResolvedValue({ status: 'cancelled' });
  });

  it('кнопка видна только при running и вызывает POST /runs/:id/cancel', async () => {
    useWorkflowStore.setState({ runStatus: 'running', runId: RUN_ID });

    const { container } = renderTopBar();
    const button = container.querySelector(
      '[data-topbar-cancel-run]',
    ) as HTMLButtonElement | null;

    expect(button).not.toBeNull();
    expect(button).toHaveTextContent(ru['topbar.cancel_run']);

    fireEvent.click(button as HTMLButtonElement);

    await waitFor(() =>
      expect(vi.mocked(cancelRunAsync)).toHaveBeenCalledWith(RUN_ID),
    );
    // После принятого запроса запуск ещё `running` (движок остановится на
    // следующем уровне/узле), поэтому кнопка показывает «Отмена...».
    await waitFor(() =>
      expect(button).toHaveTextContent(ru['topbar.cancel_run.cancelling']),
    );
  });

  it('кнопки нет при pending, completed и без запуска', () => {
    for (const status of ['pending', 'completed', 'failed', 'cancelled'] as const) {
      useWorkflowStore.setState({ runStatus: status, runId: RUN_ID });

      const { container, unmount } = renderTopBar();

      expect(
        container.querySelector('[data-topbar-cancel-run]'),
        `кнопка не должна показываться при status=${status}`,
      ).toBeNull();

      unmount();
    }
  });

  it('ошибка отмены снимает «Отмена...» и показывает уведомление', async () => {
    useWorkflowStore.setState({ runStatus: 'running', runId: RUN_ID });
    vi.mocked(cancelRunAsync).mockRejectedValue(new Error('409'));

    const { container } = renderTopBar();
    const button = container.querySelector(
      '[data-topbar-cancel-run]',
    ) as HTMLButtonElement;

    fireEvent.click(button);

    await waitFor(() =>
      expect(useWorkflowStore.getState().notice?.kind).toBe('error'),
    );
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent(ru['topbar.cancel_run']);
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

describe('TopBar — индикатор GPU (v1.2.0 S3)', () => {  afterEach(() => {
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


describe('TopBar — адаптивность шапки (v1.4.0 S3, KI-628)', () => {
  /** Сохранённый workflow: включает кнопки истории/экспорта. */
  const WORKFLOW_ID = '44444444-4444-4444-8444-444444444444';

  /** Пользователь с сессией: включает кнопки команды и профиля. */
  const USER = {
    id: '55555555-5555-4555-8555-555555555555',
    email: 'adaptive@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    organizationId: '66666666-6666-4666-8666-666666666666',
    role: 'member' as const,
  };

  afterEach(() => {
    useWorkflowStore.setState({ currentWorkflowId: null, accessRole: null });
    useAuthStore.setState({ user: null, accessToken: null, status: 'guest' });
  });

  /**
   * Рендерит шапку в состоянии «всё доступно»: сохранённый workflow и сессия.
   *
   * @returns результат `render` и контейнер
   */
  function renderFullTopBar() {
    useWorkflowStore.setState({ currentWorkflowId: WORKFLOW_ID });
    useAuthStore.getState().setSession(USER, 'access-token');

    return renderTopBar();
  }

  it('копирайт скрыт до 1440 px и не переносится по буквам', () => {
    const { container } = renderFullTopBar();
    const line = container.querySelector('[data-app-version]');

    // jsdom не применяет media queries, поэтому проверяется контракт классов:
    // `hidden` — до 1440 px, `truncate` — без переноса по одной букве.
    expect(line).toHaveClass('hidden');
    expect(line).toHaveClass('min-[1440px]:block');
    expect(line).toHaveClass('truncate');
    expect(line).toHaveClass('whitespace-nowrap');
    // data-атрибут и полный копирайт в тултипе не потеряны (RULES 1.12).
    expect(line).toHaveAttribute('data-app-version', APP_VERSION);
  });

  it('подписи второстепенных кнопок скрыты до 1760 px, иконки остаются', () => {
    const { container } = renderFullTopBar();
    const selectors = [
      '[data-topbar-new]',
      '[data-topbar-load]',
      '[data-topbar-export]',
      '[data-topbar-import]',
      '[data-topbar-history]',
      '[data-topbar-team]',
      '[data-share-button]',
    ];

    for (const selector of selectors) {
      const button = container.querySelector(selector);

      expect(button, `кнопка ${selector} должна быть в DOM`).not.toBeNull();

      const label = Array.from(button?.querySelectorAll('span') ?? []).find(
        (element) => !element.hasAttribute('aria-hidden'),
      );

      expect(label, `у ${selector} должна быть подпись`).not.toBeUndefined();
      expect(label).toHaveClass('hidden');
      expect(label).toHaveClass('min-[1760px]:inline');
      // Иконка остаётся видимой: кнопка не исчезает на узком экране.
      expect(button?.querySelector('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('поле имени не сжимается, а группа действий имеет аварийную прокрутку', () => {
    const { container } = renderFullTopBar();
    const input = screen.getByPlaceholderText(ru['topbar.name.placeholder']);
    const header = container.querySelector('header');
    const actions = header?.lastElementChild;

    // Ширина поля адаптивная, но колонка не схлопывается: `shrink-0`.
    expect(input).toHaveClass('w-32');
    expect(input).toHaveClass('xl:w-64');
    expect(input.parentElement).toHaveClass('shrink-0');
    // Группа действий может сузиться, а её кнопки — нет; при нехватке места
    // прокручивается сама группа, а не вся страница.
    expect(actions).toHaveClass('min-w-0');
    expect(actions).toHaveClass('overflow-x-auto');
    expect(actions).toHaveClass('[&>*]:shrink-0');
  });
});

describe('TopBar — QR-сканер (v1.5.0 S1)', () => {
  /** Сохранённый workflow, который «находит» сканер. */
  const WORKFLOW_ID = '33333333-3333-4333-8333-333333333333';
  /** Токен из share-ссылки, которую «находит» сканер. */
  const SHARE_TOKEN = '55555555-5555-4555-8555-555555555555';
  /** Настоящее действие загрузки — восстанавливается в `afterEach`. */
  const originalLoadWorkflowAsync =
    useWorkflowStore.getState().loadWorkflowAsync;

  afterEach(() => {
    qr.native = false;
    qr.scanQr.mockReset();
    useWorkflowStore.setState({
      currentWorkflowId: null,
      currentWorkflowOwnerId: null,
      notice: null,
      isLoading: false,
      loadWorkflowAsync: originalLoadWorkflowAsync,
    });
    vi.restoreAllMocks();
  });

  /** Кликает по кнопке сканера (она уже отрендерена). */
  function clickScanButton(): void {
    const button = screen.getByRole('button', {
      name: ru['topbar.scan_qr'],
    });

    fireEvent.click(button);
  }

  it('в браузере кнопки нет: isNative() === false', () => {
    const { container } = renderTopBar();

    expect(container.querySelector('[data-topbar-scan-qr]')).toBeNull();
  });

  it('в нативном приложении кнопка видна и подписана (aria-label)', () => {
    qr.native = true;

    const { container } = renderTopBar();
    const button = container.querySelector('[data-topbar-scan-qr]');

    expect(button).not.toBeNull();
    expect(button).toHaveAttribute('aria-label', ru['topbar.scan_qr']);
    expect(button).toHaveTextContent(ru['topbar.scan_qr']);
  });

  it('клик сканирует QR и открывает workflow по uuid', async () => {
    qr.native = true;
    qr.scanQr.mockResolvedValue(WORKFLOW_ID);
    const loadSpy = vi
      .spyOn(useWorkflowStore.getState(), 'loadWorkflowAsync')
      .mockResolvedValue(undefined);

    renderTopBar();
    clickScanButton();

    await waitFor(() => expect(qr.scanQr).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(loadSpy).toHaveBeenCalledWith(WORKFLOW_ID));

    // id попадает в стор до загрузки — шапка сразу знает новый граф.
    expect(useWorkflowStore.getState().currentWorkflowId).toBe(WORKFLOW_ID);
    expect(useWorkflowStore.getState().notice).toEqual({
      kind: 'success',
      text: ru['topbar.scan_qr_ok'],
    });
  });

  it('QR со share-ссылкой переводит на публичную страницу', async () => {
    qr.native = true;
    qr.scanQr.mockResolvedValue(
      `https://app.example/workflow/share/${SHARE_TOKEN}`,
    );

    /**
     * Пробник текущего маршрута: `TopBar` навигирует через `useNavigate`,
     * и проверить это можно только по location внутри роутера.
     *
     * @returns текущий путь в `data-testid="location"`
     */
    function LocationProbe() {
      const location = useLocation();

      return <span data-testid="location">{location.pathname}</span>;
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <TopBar />
        <LocationProbe />
      </MemoryRouter>,
    );

    clickScanButton();

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        `/workflow/share/${SHARE_TOKEN}`,
      ),
    );
  });

  it('некорректный QR — тост об ошибке, workflow не загружается', async () => {
    qr.native = true;
    qr.scanQr.mockResolvedValue('https://evil.example/login');
    const loadSpy = vi
      .spyOn(useWorkflowStore.getState(), 'loadWorkflowAsync')
      .mockResolvedValue(undefined);

    renderTopBar();
    clickScanButton();

    await waitFor(() =>
      expect(useWorkflowStore.getState().notice).toEqual({
        kind: 'error',
        text: ru['topbar.scan_qr_error'],
      }),
    );
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('отмена сканирования не показывает ошибку: scanQr() → null', async () => {
    qr.native = true;
    qr.scanQr.mockResolvedValue(null);

    renderTopBar();
    clickScanButton();

    await waitFor(() => expect(qr.scanQr).toHaveBeenCalledTimes(1));
    expect(useWorkflowStore.getState().notice).toBeNull();
  });
});

describe('TopBar — индикатор автосохранения (KI-195, S8)', () => {
  beforeEach(() => {
    useWorkflowStore.getState().newWorkflow();
  });

  afterEach(() => {
    useWorkflowStore.getState().newWorkflow();
    useWorkflowStore.setState({ isSaving: false });
  });

  it('показывает «Сохранено», когда хэш графа совпадает с последним сохранением', () => {
    useWorkflowStore.setState({
      currentWorkflowId: 'wf-1',
      lastSavedHash: computeGraphHash([], []),
      isSaving: false,
    });

    const { container } = renderTopBar();
    const indicator = container.querySelector('[data-dirty-indicator]');

    expect(indicator).toHaveAttribute('data-dirty-indicator', 'saved');
    expect(indicator).toHaveTextContent(ru['topbar.saved']);
  });

  it('показывает «Есть изменения» после правки графа', () => {
    useWorkflowStore.setState({
      currentWorkflowId: 'wf-1',
      lastSavedHash: computeGraphHash([], []),
      isSaving: false,
    });
    useWorkflowStore.getState().addNode('text', { x: 0, y: 0 });

    const { container } = renderTopBar();
    const indicator = container.querySelector('[data-dirty-indicator]');

    expect(indicator).toHaveAttribute('data-dirty-indicator', 'dirty');
    expect(indicator).toHaveTextContent(ru['topbar.dirty']);
  });

  it('показывает «Сохранение...», пока идёт запрос', () => {
    useWorkflowStore.setState({
      currentWorkflowId: 'wf-1',
      lastSavedHash: computeGraphHash([], []),
      isSaving: true,
    });

    const { container } = renderTopBar();
    const indicator = container.querySelector('[data-dirty-indicator]');

    expect(indicator).toHaveAttribute('data-dirty-indicator', 'saving');
    expect(indicator).toHaveTextContent(ru['topbar.saving']);
  });
});
