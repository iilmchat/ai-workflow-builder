import type { ReactNode } from 'react';

interface BaseNodeProps {
  /** Иконка типа узла (эмодзи). */
  icon: string;
  /** Название узла в шапке. */
  title: string;
  /** Содержимое тела карточки. */
  children: ReactNode;
}

/**
 * Базовая карточка узла: скруглённая рамка, компактная шапка и тело.
 *
 * Используется всеми кастомными узлами, чтобы визуально они были одинаковыми.
 */
export function BaseNode({ icon, title, children }: BaseNodeProps) {
  return (
    <div className="w-60 rounded-xl border border-slate-200 bg-white shadow-sm">
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
