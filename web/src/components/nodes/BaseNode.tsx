import type { ReactNode } from 'react';

interface BaseNodeProps {
  /** Иконка типа узла (эмодзи). */
  icon: string;
  /** Название узла в шапке. */
  title: string;
  /** Номер уровня выполнения из `/engine/plan` (нумерация с 1). */
  executionLevel?: number;
  /** Содержимое тела карточки. */
  children: ReactNode;
}

/**
 * Базовая карточка узла: скруглённая рамка, компактная шапка и тело.
 *
 * Используется всеми кастомными узлами, чтобы визуально они были одинаковыми.
 * Если передан `executionLevel`, в правом верхнем углу показывается бейдж
 * с номером уровня — узлы одного уровня можно запускать параллельно.
 */
export function BaseNode({ icon, title, executionLevel, children }: BaseNodeProps) {
  return (
    <div className="relative w-60 rounded-xl border border-slate-200 bg-white shadow-sm">
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
