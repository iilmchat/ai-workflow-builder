import type { ReactNode } from 'react';
import type { RunStatus } from '@/types/run-stream';

/**
 * Цвета рамки узла по статусу выполнения.
 *
 * Классы заданы литералами (не склейкой строк): Tailwind v4 находит их при
 * сканировании исходников, поэтому динамическая сборка имён недопустима.
 */
const STATUS_BORDER: Record<RunStatus, string> = {
  pending: 'border-slate-300',
  running: 'border-blue-500',
  completed: 'border-green-500',
  failed: 'border-red-500',
  cancelled: 'border-slate-400',
};

/** Лёгкая подсветка фона по статусу — визуальный акцент без «крика». */
const STATUS_BACKGROUND: Record<RunStatus, string> = {
  pending: 'bg-white',
  running: 'bg-blue-50',
  completed: 'bg-green-50',
  failed: 'bg-red-50',
  cancelled: 'bg-white',
};

interface BaseNodeProps {
  /** Иконка типа узла (эмодзи). */
  icon: string;
  /** Название узла в шапке. */
  title: string;
  /** Номер уровня выполнения из `/engine/plan` (нумерация с 1). */
  executionLevel?: number;
  /** Статус выполнения узла из SSE (`undefined` — запуск не идёт). */
  status?: RunStatus;
  /** Содержимое тела карточки. */
  children: ReactNode;
}

/**
 * Базовая карточка узла: скруглённая рамка, компактная шапка и тело.
 *
 * Используется всеми кастомными узлами, чтобы визуально они были одинаковыми.
 * Если передан `executionLevel`, в правом верхнем углу показывается бейдж
 * с номером уровня — узлы одного уровня можно запускать параллельно.
 *
 * Рамка и фон зависят от `status` (R4.2): серый — узел не выполнялся, синий —
 * выполняется, зелёный — успех, красный — ошибка.
 */
export function BaseNode({
  icon,
  title,
  executionLevel,
  status,
  children,
}: BaseNodeProps) {
  const border = STATUS_BORDER[status ?? 'pending'];
  const background = STATUS_BACKGROUND[status ?? 'pending'];

  return (
    <div
      data-status={status ?? 'idle'}
      className={`relative w-60 rounded-xl border-2 ${border} ${background} shadow-sm`}
    >
      {executionLevel !== undefined && (
        <span
          className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-slate-500 text-[10px] font-semibold text-white shadow-sm"
          title={`Уровень выполнения: ${executionLevel}`}
        >
          {executionLevel}
        </span>
      )}

      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <span className="text-sm" aria-hidden="true">
          {icon}
        </span>
        <span className="text-xs font-medium text-slate-500">{title}</span>
      </div>

      <div className="px-3 py-2">{children}</div>
    </div>
  );
}
