import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@/i18n';
import type { NodeRunStatus } from '@/types/run-stream';
import { BaseNode } from './BaseNode';

/**
 * Ожидаемые токен-классы рамки и фона для каждого статуса узла.
 *
 * KI-448 (DESIGN v0.11 § 3.6): цвета статуса приходят из переменных темы
 * (`--color-node-bg-*` / `--color-node-border-*`), поэтому в `.dark` они
 * переопределяются без `dark:`-утилит (их вариант в Tailwind v4 привязан к
 * `prefers-color-scheme`, а тема переключается классом `.dark`).
 *
 * Таблица фиксирует контракт «статус → литеральные классы»: имена собираются
 * не склейкой (Tailwind v4 сканирует исходники), а тест ловит случайную
 * замену на светлый литерал.
 */
const STATUS_TOKENS: ReadonlyArray<{
  readonly status: NodeRunStatus;
  readonly border: string;
  readonly background: string;
}> = [
  { status: 'pending', border: 'border-node-pending', background: 'bg-node-bg-pending' },
  {
    status: 'running',
    border: 'border-node-border-running',
    background: 'bg-node-bg-running',
  },
  {
    status: 'completed',
    border: 'border-node-border-completed',
    background: 'bg-node-bg-completed',
  },
  {
    status: 'failed',
    border: 'border-node-border-failed',
    background: 'bg-node-bg-failed',
  },
  {
    status: 'cancelled',
    border: 'border-node-border-cancelled',
    background: 'bg-node-bg-cancelled',
  },
  {
    status: 'skipped',
    border: 'border-node-border-skipped',
    background: 'bg-node-bg-skipped',
  },
];

/**
 * Светлые литералы, из-за которых возник KI-448: на тёмной теме они давали
 * светлые пятна. Возврат любого из них — регресс.
 */
const LEGACY_LIGHT_CLASSES: readonly string[] = [
  'bg-blue-50',
  'bg-green-50',
  'bg-red-50',
  'bg-muted/30',
  'border-blue-500',
  'border-green-500',
  'border-red-500',
  'border-slate-400',
];

/**
 * Рендерит карточку и возвращает её корень (`[data-status]`).
 *
 * @param status - статус запуска узла (`undefined` — запуск не идёт)
 * @returns корневой элемент карточки
 */
function renderRoot(status?: NodeRunStatus): HTMLElement {
  const { container } = render(
    <BaseNode icon="🧪" title="Тестовый узел" status={status} onDelete={() => undefined}>
      тело
    </BaseNode>,
  );
  const root = container.querySelector<HTMLElement>('[data-status]');

  if (root === null) {
    throw new Error('У BaseNode нет корня с data-status');
  }

  return root;
}

describe('BaseNode — статусные классы на токенах темы (KI-448)', () => {
  for (const { status, border, background } of STATUS_TOKENS) {
    it(`статус ${status}: рамка и фон — токены темы`, () => {
      const root = renderRoot(status);

      expect(root).toHaveAttribute('data-status', status);
      expect(root).toHaveClass(border, background);
    });
  }

  it('running: применяет bg-node-bg-running и border-node-border-running', () => {
    const root = renderRoot('running');

    expect(root).toHaveClass('bg-node-bg-running', 'border-node-border-running');
  });

  it('skipped: пунктирная рамка — отдельный признак «узел не выполнялся»', () => {
    const root = renderRoot('skipped');

    expect(root).toHaveClass('border-dashed', 'border-node-border-skipped');
  });

  it('без статуса: карточка получает статус idle и токены pending', () => {
    const root = renderRoot();

    expect(root).toHaveAttribute('data-status', 'idle');
    expect(root).toHaveClass('bg-node-bg-pending', 'border-node-pending');
  });

  it('ни один статус не возвращает светлые литералы (регресс KI-448)', () => {
    for (const { status } of STATUS_TOKENS) {
      const root = renderRoot(status);

      for (const legacyClass of LEGACY_LIGHT_CLASSES) {
        expect(root).not.toHaveClass(legacyClass);
      }
    }
  });

  it('кнопка удаления: hover использует токены темы, а не red-50/red-600', () => {
    renderRoot('completed');

    const button = screen.getByRole('button', { name: 'Удалить узел' });

    expect(button).toHaveClass('hover:bg-node-bg-failed', 'hover:text-foreground');
    expect(button).not.toHaveClass('hover:bg-red-50', 'hover:text-red-600');
  });
});
