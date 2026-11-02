import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ru from '@/i18n/ru.json';
import { fetchWorkflowRunsAsync, type ApiRunSummary } from '@/lib/api';
import { useWorkflowStore } from '@/stores/workflow';
import { RunHistoryModal } from './RunHistoryModal';

/**
 * Мок API истории запусков.
 *
 * Модалка не должна ходить в сеть из тестов: контракт ответа проверяет
 * `api-contract.spec.ts`, а здесь — поведение UI (список, пагинация, клик).
 * `importOriginal` сохраняет остальные функции `@/lib/api`, которые тянет стор.
 */
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();

  return { ...actual, fetchWorkflowRunsAsync: vi.fn() };
});

/** Сохранённый workflow, чью историю открывает модалка. */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';

/** Завершённый запуск с длительностью и стоимостью в USD. */
const COMPLETED_RUN: ApiRunSummary = {
  id: '22222222-2222-4222-8222-222222222222',
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

  mock.mockResolvedValue(pages[pages.length - 1] ?? { runs: [], total: 0 });
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

describe('RunHistoryModal (v0.14 S2)', () => {
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
    vi.restoreAllMocks();
  });

  it('загружает страницу, рендерит статусы/дату/длительность/стоимость', async () => {
    stubPages({ runs: [COMPLETED_RUN, FAILED_RUN, PENDING_RUN], total: 3 });

    const { container } = renderHistory();

    await screen.findByText('Завершён');
    expect(screen.getByText('Ошибка')).toBeInTheDocument();
    expect(screen.getByText('Ожидает')).toBeInTheDocument();
    // Запрос первой страницы по умолчанию.
    expect(vi.mocked(fetchWorkflowRunsAsync)).toHaveBeenCalledWith(
      WORKFLOW_ID,
      20,
      0,
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
    // Пагинация: 3 записи из 3 — одна страница.
    expect(screen.getByText('Страница 1 из 1')).toBeInTheDocument();
    expect(container.querySelector('[data-history-prev]')).toBeDisabled();
    expect(container.querySelector('[data-history-next]')).toBeDisabled();
  });

  it('пустая история показывает «Запусков пока нет»', async () => {
    stubPages({ runs: [], total: 0 });

    const { container } = renderHistory();

    await screen.findByText('Запусков пока нет');
    expect(container.querySelector('[data-history-empty]')).not.toBeNull();
    expect(container.querySelectorAll('[data-history-run]')).toHaveLength(0);
  });

  it('пагинация: «Вперёд» запрашивает offset+20, «Назад» возвращает offset 0', async () => {
    stubPages(
      { runs: [COMPLETED_RUN], total: 45 },
      { runs: [FAILED_RUN], total: 45 },
      { runs: [COMPLETED_RUN], total: 45 },
    );

    const { container } = renderHistory();

    await screen.findByText('Завершён');
    expect(screen.getByText('Страница 1 из 3')).toBeInTheDocument();

    const next = container.querySelector(
      '[data-history-next]',
    ) as HTMLButtonElement;
    const prev = container.querySelector(
      '[data-history-prev]',
    ) as HTMLButtonElement;

    expect(prev).toBeDisabled();
    expect(next).not.toBeDisabled();

    fireEvent.click(next);

    await screen.findByText('Ошибка');
    expect(vi.mocked(fetchWorkflowRunsAsync)).toHaveBeenLastCalledWith(
      WORKFLOW_ID,
      20,
      20,
    );
    expect(screen.getByText('Страница 2 из 3')).toBeInTheDocument();
    expect(prev).not.toBeDisabled();

    fireEvent.click(prev);

    await screen.findByText('Завершён');
    expect(vi.mocked(fetchWorkflowRunsAsync)).toHaveBeenLastCalledWith(
      WORKFLOW_ID,
      20,
      0,
    );
  });

  it('граничное округление длительности: не печатает «60 с» и «1 мин 60 с»', async () => {
    // 59.999 с раньше давало «60.0 с», 119.5 с — «1 мин 60 с».
    stubPages({
      runs: [
        { ...COMPLETED_RUN, id: `${COMPLETED_RUN.id}-a`, durationMs: 59_999 },
        { ...COMPLETED_RUN, id: `${COMPLETED_RUN.id}-b`, durationMs: 119_500 },
      ],
      total: 2,
    });

    renderHistory();

    await screen.findByText('1 мин 0 с');
    expect(screen.getByText('2 мин 0 с')).toBeInTheDocument();
    expect(screen.queryByText('60.0 с')).toBeNull();
    expect(screen.queryByText('1 мин 60 с')).toBeNull();
  });

  it('последняя страница: «Вперёд» выключается на границе total=21', async () => {
    stubPages(
      { runs: [COMPLETED_RUN], total: 21 },
      { runs: [FAILED_RUN], total: 21 },
    );

    const { container } = renderHistory();

    await screen.findByText('Завершён');
    expect(screen.getByText('Страница 1 из 2')).toBeInTheDocument();

    fireEvent.click(
      container.querySelector('[data-history-next]') as HTMLElement,
    );

    await screen.findByText('Ошибка');
    expect(screen.getByText('Страница 2 из 2')).toBeInTheDocument();
    expect(container.querySelector('[data-history-next]')).toBeDisabled();
  });

  it('клик по запуску закрывает модалку и восстанавливает его в сторе', async () => {
    stubPages({ runs: [COMPLETED_RUN, FAILED_RUN], total: 2 });

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
    expect(useWorkflowStore.getState().restoreRunAsync).toHaveBeenCalledWith(
      FAILED_RUN.id,
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

  it('показывает ошибку загрузки и повторяет запрос по кнопке', async () => {
    const mock = vi.mocked(fetchWorkflowRunsAsync);

    mock.mockReset();
    mock.mockRejectedValueOnce(new Error('boom'));
    mock.mockResolvedValueOnce({ runs: [COMPLETED_RUN], total: 1 });

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

  it('закрывается кликом по фону', async () => {
    stubPages({ runs: [], total: 0 });

    const { container, onClose } = renderHistory();

    await screen.findByText(ru['history.empty']);
    fireEvent.click(
      container.querySelector('[data-history-modal-backdrop]') as HTMLElement,
    );

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('закрывается кнопкой ✕', async () => {
    stubPages({ runs: [], total: 0 });

    const { onClose } = renderHistory();

    await screen.findByText(ru['history.empty']);
    fireEvent.click(screen.getByLabelText(ru['common.close']));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape закрывает окно', async () => {
    stubPages({ runs: [], total: 0 });

    const { onClose } = renderHistory();

    await screen.findByText('Запусков пока нет');
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
