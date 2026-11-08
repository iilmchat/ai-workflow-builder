import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ru from '@/i18n/ru.json';
import {
  compareRunsAsync,
  fetchWorkflowRunsAsync,
  type ApiRunSummary,
} from '@/lib/api';
import { useWorkflowStore } from '@/stores/workflow';
import { RunHistoryModal } from './RunHistoryModal';

/**
 * Мок API истории запусков.
 *
 * Модалка не должна ходить в сеть из тестов: контракт ответа проверяет
 * `api-contract.spec.ts`, а здесь — поведение UI (список, keyset-пагинация,
 * клик). `importOriginal` сохраняет остальные функции `@/lib/api`, которые
 * тянет стор.
 */
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();

  return { ...actual, fetchWorkflowRunsAsync: vi.fn(), compareRunsAsync: vi.fn() };
});

/** Сохранённый workflow, чью историю открывает модалка. */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Курсор-заглушка для элемента истории.
 *
 * В реальном API это base64url, но UI обращается с курсором как с непрозрачной
 * строкой — тесту достаточно предсказуемого значения.
 *
 * @param id - id запуска
 * @returns строка-курсор
 */
function cursorOf(id: string): string {
  return `cursor-${id}`;
}

/** Завершённый запуск с длительностью и стоимостью в USD. */
const COMPLETED_RUN: ApiRunSummary = {
  id: '22222222-2222-4222-8222-222222222222',
  cursor: cursorOf('completed'),
  status: 'completed',
  createdAt: '2026-11-02T09:00:00.000Z',
  startedAt: '2026-11-02T09:00:01.000Z',
  finishedAt: '2026-11-02T09:00:03.000Z',
  durationMs: 2000,
  costUsd: 0.012345,
  costRub: 0,
};

/** Упавший запуск с рублёвой стоимостью (media-узел). */
const FAILED_RUN: ApiRunSummary = {
  id: '33333333-3333-4333-8333-333333333333',
  cursor: cursorOf('failed'),
  status: 'failed',
  createdAt: '2026-11-02T08:00:00.000Z',
  startedAt: '2026-11-02T08:00:01.000Z',
  finishedAt: '2026-11-02T08:00:04.500Z',
  durationMs: 3500,
  costUsd: 0,
  costRub: 25.5,
};

/** Ожидающий запуск: длительности и стоимости ещё нет. */
const PENDING_RUN: ApiRunSummary = {
  id: '44444444-4444-4444-8444-444444444444',
  cursor: cursorOf('pending'),
  status: 'pending',
  createdAt: '2026-11-02T07:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  costUsd: 0,
  costRub: 0,
};

/**
 * Настраивает `fetchWorkflowRunsAsync` на последовательность ответов.
 *
 * @param pages - ответы по порядку вызовов (последний повторяется)
 */
function stubPages(
  ...pages: Awaited<ReturnType<typeof fetchWorkflowRunsAsync>>[]
): void {
  const mock = vi.mocked(fetchWorkflowRunsAsync);

  mock.mockReset();

  for (const page of pages) {
    mock.mockResolvedValueOnce(page);
  }

  mock.mockResolvedValue(pages[pages.length - 1] ?? { runs: [], nextCursor: null, total: 0 });
}

/**
 * Рендерит модалку истории с заглушкой `onClose`.
 *
 * @param workflowId - uuid workflow (по умолчанию тестовый)
 * @returns `onClose`-мок и результат `render`
 */
function renderHistory(workflowId = WORKFLOW_ID) {
  const onClose = vi.fn();

  const view = render(
    <RunHistoryModal workflowId={workflowId} onClose={onClose} />,
  );

  return { ...view, onClose };
}

describe('RunHistoryModal (v0.14 S2; keyset — v0.16 S1)', () => {
  beforeEach(() => {
    // Клик по запуску вызывает действия стора — подменяем их, чтобы тест не
    // ходил в API восстановления и не зависел от живого backend'а.
    useWorkflowStore.setState({
      restoreRunAsync: vi.fn(() => Promise.resolve()),
      setSelectedNodeId: vi.fn(),
    });
  });

  afterEach(() => {
    vi.mocked(fetchWorkflowRunsAsync).mockReset();
    vi.mocked(compareRunsAsync).mockReset();
    vi.restoreAllMocks();
  });

  it('загружает первую страницу и рендерит статусы/дату/длительность/стоимость', async () => {
    stubPages({ runs: [COMPLETED_RUN, FAILED_RUN, PENDING_RUN], nextCursor: null, total: 3 });

    const { container } = renderHistory();

    await screen.findByText('Завершён');
    expect(screen.getByText('Ошибка')).toBeInTheDocument();
    expect(screen.getByText('Ожидает')).toBeInTheDocument();
    // v0.16 S1 (KI-542): первая страница запрашивается без курсора.
    expect(vi.mocked(fetchWorkflowRunsAsync)).toHaveBeenCalledWith(
      WORKFLOW_ID,
      20,
    );
    expect(container.querySelectorAll('[data-history-run]')).toHaveLength(3);
    // Дата — в локали интерфейса (ru), а не ISO; ожидаемое значение считаем
    // тем же `toLocaleString`, чтобы тест не зависел от таймзоны CI.
    expect(
      screen.getByText(
        new Date(COMPLETED_RUN.createdAt).toLocaleString('ru-RU'),
      ),
    ).toBeInTheDocument();
    // durations: 2000 мс → 2.0 с, 3500 мс → 3.5 с, у pending — прочерк.
    expect(screen.getByText('2.0 с')).toBeInTheDocument();
    expect(screen.getByText('3.5 с')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    // Стоимости: USD с 4 знаками, RUB с 2 знаками, нулевая валюта не шумит.
    expect(screen.getByText('$0.0123')).toBeInTheDocument();
    expect(screen.getByText('25.50 ₽')).toBeInTheDocument();
    // Запуск без трат — честный ноль, а не «нет данных».
    expect(screen.getByText('$0.0000')).toBeInTheDocument();
    // Все 3 записи загружены — «Загрузить ещё» не нужен.
    expect(screen.getByText('Показано 3 из 3')).toBeInTheDocument();
    expect(container.querySelector('[data-history-load-more]')).toBeNull();
    expect(container.querySelector('[data-history-end]')).not.toBeNull();
  });

  it('пустая история показывает «Запусков пока нет»', async () => {
    stubPages({ runs: [], nextCursor: null, total: 0 });

    const { container } = renderHistory();

    await screen.findByText('Запусков пока нет');
    expect(container.querySelector('[data-history-empty]')).not.toBeNull();
    expect(container.querySelectorAll('[data-history-run]')).toHaveLength(0);
    expect(container.querySelector('[data-history-load-more]')).toBeNull();
  });

  it('«Загрузить ещё» догружает следующую страницу по курсору и дописывает её', async () => {
    stubPages(
      { runs: [COMPLETED_RUN], nextCursor: COMPLETED_RUN.cursor, total: 25 },
      { runs: [FAILED_RUN, PENDING_RUN], nextCursor: PENDING_RUN.cursor, total: 25 },
    );

    const { container } = renderHistory();

    await screen.findByText('Завершён');
    expect(screen.getByText('Показано 1 из 25')).toBeInTheDocument();

    const loadMore = container.querySelector(
      '[data-history-load-more]',
    ) as HTMLButtonElement;

    expect(loadMore).not.toBeNull();
    fireEvent.click(loadMore);

    await screen.findByText('Ошибка');
    // Второй запрос — с курсором последнего элемента первой страницы.
    expect(vi.mocked(fetchWorkflowRunsAsync)).toHaveBeenNthCalledWith(
      2,
      WORKFLOW_ID,
      20,
      COMPLETED_RUN.cursor,
    );
    expect(container.querySelectorAll('[data-history-run]')).toHaveLength(3);
    expect(screen.getByText('Показано 3 из 25')).toBeInTheDocument();
    // Курсор следующей страницы — у последнего элемента.
    fireEvent.click(
      container.querySelector('[data-history-load-more]') as HTMLElement,
    );
    await waitFor(() =>
      expect(vi.mocked(fetchWorkflowRunsAsync)).toHaveBeenNthCalledWith(
        3,
        WORKFLOW_ID,
        20,
        PENDING_RUN.cursor,
      ),
    );
  });

  it('не дублирует строки, если страница пересекается с загруженной', async () => {
    stubPages(
      { runs: [COMPLETED_RUN, FAILED_RUN], nextCursor: FAILED_RUN.cursor, total: 3 },
      // Сервер вернул уже загруженный FAILED_RUN повторно.
      { runs: [FAILED_RUN, PENDING_RUN], nextCursor: null, total: 3 },
    );

    const { container } = renderHistory();

    await screen.findByText('Завершён');
    fireEvent.click(
      container.querySelector('[data-history-load-more]') as HTMLElement,
    );

    await screen.findByText('Ожидает');
    expect(container.querySelectorAll('[data-history-run]')).toHaveLength(3);
    expect(screen.getByText('Показано 3 из 3')).toBeInTheDocument();
    expect(container.querySelector('[data-history-load-more]')).toBeNull();
  });

  it('не дублирует строки внутри одной страницы (защита от дублей сервера)', async () => {
    stubPages(
      { runs: [COMPLETED_RUN], nextCursor: COMPLETED_RUN.cursor, total: 3 },
      { runs: [FAILED_RUN, FAILED_RUN], nextCursor: null, total: 3 },
    );

    const { container } = renderHistory();

    await screen.findByText('Завершён');
    fireEvent.click(
      container.querySelector('[data-history-load-more]') as HTMLElement,
    );

    await screen.findByText('Ошибка');
    expect(container.querySelectorAll('[data-history-run]')).toHaveLength(2);
  });

  it('ошибка догрузки показывается отдельно и повторяется по кнопке', async () => {
    const mock = vi.mocked(fetchWorkflowRunsAsync);

    mock.mockReset();
    mock.mockResolvedValueOnce({ runs: [COMPLETED_RUN], nextCursor: COMPLETED_RUN.cursor, total: 25 });
    mock.mockRejectedValueOnce(new Error('boom'));
    mock.mockResolvedValueOnce({ runs: [FAILED_RUN], nextCursor: null, total: 25 });

    const { container } = renderHistory();

    await screen.findByText('Завершён');
    fireEvent.click(
      container.querySelector('[data-history-load-more]') as HTMLElement,
    );

    await screen.findByText('Не удалось загрузить ещё: boom');
    expect(
      container.querySelector('[data-history-load-more-error]'),
    ).not.toBeNull();
    // Первая страница не пропала: список остался на экране.
    expect(screen.getByText('Завершён')).toBeInTheDocument();

    fireEvent.click(
      container.querySelector('[data-history-load-more-retry]') as HTMLElement,
    );

    await screen.findByText('Ошибка');
    expect(container.querySelectorAll('[data-history-run]')).toHaveLength(2);
    expect(container.querySelector('[data-history-load-more-error]')).toBeNull();
  });

  it('граничное округление длительности: не печатает «60 с» и «1 мин 60 с»', async () => {
    // 59.999 с раньше давало «60.0 с», 119.5 с — «1 мин 60 с».
    stubPages({
      runs: [
        { ...COMPLETED_RUN, id: `${COMPLETED_RUN.id}-a`, cursor: 'c-a', durationMs: 59_999 },
        { ...COMPLETED_RUN, id: `${COMPLETED_RUN.id}-b`, cursor: 'c-b', durationMs: 119_500 },
      ],
      nextCursor: null,
      total: 2,
    });

    renderHistory();

    await screen.findByText('1 мин 0 с');
    expect(screen.getByText('2 мин 0 с')).toBeInTheDocument();
    expect(screen.queryByText('60.0 с')).toBeNull();
    expect(screen.queryByText('1 мин 60 с')).toBeNull();
  });

  it('клик по запуску закрывает модалку, пишет ?runId= и восстанавливает его (KI-541)', async () => {
    stubPages({ runs: [COMPLETED_RUN, FAILED_RUN], nextCursor: null, total: 2 });
    const replaceState = vi.spyOn(window.history, 'replaceState');

    const { container, onClose } = renderHistory();

    await screen.findByText('Завершён');

    const rows = container.querySelectorAll('[data-history-run]');
    fireEvent.click(rows[1] as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
    // Панель результата должна показать запуск целиком, а не ранее выбранный
    // узел: клик сбрасывает `selectedNodeId`.
    expect(useWorkflowStore.getState().setSelectedNodeId).toHaveBeenCalledWith(
      null,
    );
    // KI-541: `?runId=` пишется в адресную строку ещё до восстановления.
    expect(replaceState).toHaveBeenCalled();
    expect(String(replaceState.mock.calls[0]?.[2])).toContain(
      `runId=${FAILED_RUN.id}`,
    );
    // KI-541: restoreRunAsync получает preserveRunIdInUrl, чтобы F5 не потерял
    // панель результата.
    expect(useWorkflowStore.getState().restoreRunAsync).toHaveBeenCalledWith(
      FAILED_RUN.id,
      { preserveRunIdInUrl: true },
    );

    // Требование порядка: модалка закрывается ДО восстановления запуска;
    // `selectedNodeId` сбрасывается между этими действиями.
    const setSelectedNodeIdMock = useWorkflowStore.getState()
      .setSelectedNodeId as ReturnType<typeof vi.fn>;
    const restoreMock = useWorkflowStore.getState()
      .restoreRunAsync as ReturnType<typeof vi.fn>;
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      setSelectedNodeIdMock.mock.invocationCallOrder[0],
    );
    expect(setSelectedNodeIdMock.mock.invocationCallOrder[0]).toBeLessThan(
      restoreMock.mock.invocationCallOrder[0],
    );
  });

  it('показывает ошибку загрузки первой страницы и повторяет запрос', async () => {
    const mock = vi.mocked(fetchWorkflowRunsAsync);

    mock.mockReset();
    mock.mockRejectedValueOnce(new Error('boom'));
    mock.mockResolvedValueOnce({ runs: [COMPLETED_RUN], nextCursor: null, total: 1 });

    const { container } = renderHistory();

    await screen.findByText('Не удалось загрузить историю: boom');
    expect(container.querySelector('[data-history-error]')).not.toBeNull();

    fireEvent.click(
      container.querySelector('[data-history-retry]') as HTMLElement,
    );

    await screen.findByText('Завершён');
    expect(mock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-history-error]')).toBeNull();
  });

  it('во время первой загрузки не показывает «конец списка» и счётчик', () => {
    // Не отвечающая страница: UI должен показать «Загрузка…» без футера,
    // иначе при nextCursor=null он соврёт «Показано 0 из 0 / дальше нет».
    let resolvePage: (
      page: Awaited<ReturnType<typeof fetchWorkflowRunsAsync>>,
    ) => void = () => undefined;
    const pending = new Promise<
      Awaited<ReturnType<typeof fetchWorkflowRunsAsync>>
    >((resolve) => {
      resolvePage = resolve;
    });

    vi.mocked(fetchWorkflowRunsAsync).mockReturnValue(pending);

    const { container } = renderHistory();

    expect(container.querySelector('[data-history-loading]')).not.toBeNull();
    expect(container.querySelector('[data-history-loaded]')).toBeNull();
    expect(container.querySelector('[data-history-end]')).toBeNull();

    resolvePage({ runs: [], nextCursor: null, total: 0 });
  });

  it('закрывается кликом по фону', async () => {
    stubPages({ runs: [], nextCursor: null, total: 0 });

    const { container, onClose } = renderHistory();

    await screen.findByText(ru['history.empty']);
    fireEvent.click(
      container.querySelector('[data-history-modal-backdrop]') as HTMLElement,
    );

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('закрывается кнопкой ✕', async () => {
    stubPages({ runs: [], nextCursor: null, total: 0 });

    const { onClose } = renderHistory();

    await screen.findByText(ru['history.empty']);
    fireEvent.click(screen.getByLabelText(ru['common.close']));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape закрывает окно', async () => {
    stubPages({ runs: [], nextCursor: null, total: 0 });

    const { onClose } = renderHistory();

    await screen.findByText('Запусков пока нет');
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('выбирает два запуска и открывает сравнение (v1.4.0 S2)', async () => {
    stubPages({
      runs: [COMPLETED_RUN, FAILED_RUN, PENDING_RUN],
      nextCursor: null,
      total: 3,
    });
    vi.mocked(compareRunsAsync).mockResolvedValue({
      run1: COMPLETED_RUN,
      run2: FAILED_RUN,
      diffs: {
        nodeDiffs: [],
        totalDiff: { durationMs: 1500, costUsd: -0.012345, costRub: 25.5 },
      },
    });

    const { container } = renderHistory();

    await screen.findByText('Завершён');

    const compareButton = container.querySelector(
      '[data-history-compare]',
    ) as HTMLButtonElement;

    expect(compareButton).toBeDisabled();

    fireEvent.click(
      container.querySelector(
        `[data-history-select="${COMPLETED_RUN.id}"]`,
      ) as HTMLElement,
    );
    fireEvent.click(
      container.querySelector(
        `[data-history-select="${FAILED_RUN.id}"]`,
      ) as HTMLElement,
    );

    expect(compareButton).not.toBeDisabled();
    // Третий чекбокс блокируется, пока не снят один из выбранных.
    expect(
      container.querySelector(
        `[data-history-select="${PENDING_RUN.id}"]`,
      ),
    ).toBeDisabled();

    fireEvent.click(compareButton);

    expect(
      await screen.findByRole('dialog', {
        name: ru['compare.title'],
      }),
    ).toBeInTheDocument();
    expect(vi.mocked(compareRunsAsync)).toHaveBeenCalledWith(
      COMPLETED_RUN.id,
      FAILED_RUN.id,
    );
  });
});
