import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { NodeRunStatus } from '@/types/run-stream';

/**
 * Цвета рамки узла по статусу выполнения.
 *
 * Классы заданы литералами (не склейкой строк): Tailwind v4 находит их при
 * сканировании исходников, поэтому динамическая сборка имён недопустима.
 * Пропущенный узел (`skipped`, KI-288) отличается не только цветом, но и
 * пунктиром: он визуально «выключен» — движок его не выполнял.
 */
const STATUS_BORDER: Record<NodeRunStatus, string> = {
  pending: 'border-node-pending',
  running: 'border-blue-500',
  completed: 'border-green-500',
  failed: 'border-red-500',
  cancelled: 'border-slate-400',
  skipped: 'border-dashed border-node-skipped',
};

/** Лёгкая подсветка фона по статусу — визуальный акцент без «крика». */
const STATUS_BACKGROUND: Record<NodeRunStatus, string> = {
  pending: 'bg-node-bg',
  running: 'bg-blue-50',
  completed: 'bg-green-50',
  failed: 'bg-red-50',
  cancelled: 'bg-node-bg',
  // Полупрозрачный приглушённый фон: узел «погашен», но карточка читается.
  skipped: 'bg-muted/30',
};

/** Бейдж-подпись в правом верхнем углу карточки (например, capability модели). */
export interface NodeBadge {
  /** Короткий текст бейджа (`V`, `IMG`). */
  text: string;
  /** Классы Tailwind для фона и цвета текста. */
  className: string;
}

interface BaseNodeProps {
  /** Иконка типа узла (эмодзи). */
  icon: string;
  /** Название узла в шапке. */
  title: string;
  /** Номер уровня выполнения из `/engine/plan` (нумерация с 1). */
  executionLevel?: number;
  /** Статус выполнения узла из SSE (`undefined` — запуск не идёт). */
  status?: NodeRunStatus;
  /** Дополнительные бейджи (capabilities модели, v0.6.0a). */
  badges?: NodeBadge[];
  /**
   * Дополнительный `data-*` атрибут корня карточки (R6.5.2).
   *
   * Нужен узлам, которые обязаны быть адресуемы из смоука и e2e по типу
   * (`[data-http-node]`, `[data-compare-node]`): служебный `data-id` React Flow
   * несёт id узла, а не его тип. У `CommentNode` для этого свой корень.
   */
  dataNodeAttr?: { readonly name: string; readonly value: string };
  /** Удаляет узел вместе с его связями (A2). */
  onDelete: () => void;
  /** Содержимое тела карточки. */
  children: ReactNode;
}

/**
 * Базовая карточка узла: скруглённая рамка, компактная шапка и тело.
 *
 * Используется всеми кастомными узлами, чтобы визуально они были одинаковыми.
 * Если передан `executionLevel`, в правом верхнем углу показывается бейдж
 * с номером уровня — узлы одного уровня можно запускать параллельно.
 * `badges` рисуются там же, левее уровня: так видно, что модель умеет
 * (например, `V` — понимает картинки на входе).
 *
 * Рамка и фон зависят от `status` (R4.2): серый — узел не выполнялся, синий —
 * выполняется, зелёный — успех, красный — ошибка, серый пунктир — узел пропущен
 * (движок не запускал его из-за упавшего предшественника, KI-288).
 */
export function BaseNode({
  icon,
  title,
  executionLevel,
  status,
  badges,
  dataNodeAttr,
  onDelete,
  children,
}: BaseNodeProps) {
  const { t } = useTranslation();
  const border = STATUS_BORDER[status ?? 'pending'];
  const background = STATUS_BACKGROUND[status ?? 'pending'];

  return (
    <div
      data-status={status ?? 'idle'}
      // Имя атрибута задаёт узел (`data-http-node` и т.п.): вычислимый ключ
      // через spread — единственный способ отдать React атрибут с динамическим
      // именем, не собирая его строкой в className.
      {...(dataNodeAttr === undefined
        ? {}
        : { [dataNodeAttr.name]: dataNodeAttr.value })}
      // `group/node` — чтобы кнопка удаления (A2) показывалась при наведении
      // именно на этот узел, а не на любой узел холста.
      className={`group/node relative w-60 rounded-xl border-2 ${border} ${background} shadow-node`}
    >
      {badges !== undefined && badges.length > 0 && (
        <span className="absolute -top-2 right-5 flex gap-1">
          {badges.map((badge) => (
            <span
              key={badge.text}
              className={`rounded px-1.5 py-0.5 text-[9px] font-semibold shadow-sm ${badge.className}`}
            >
              {badge.text}
            </span>
          ))}
        </span>
      )}

      {executionLevel !== undefined && (
        <span
          className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-slate-500 text-[10px] font-semibold text-white shadow-sm"
          title={t('node.levels.title', { level: executionLevel })}
        >
          {executionLevel}
        </span>
      )}

      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm" aria-hidden="true">
          {icon}
        </span>
        <span className="text-xs font-medium text-muted-foreground">{title}</span>

        {/* A2: кнопка появляется при наведении на узел — в шапке она не мешает
            читать название, но всегда доступна мышью. */}
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('node.delete')}
          title={t('node.delete')}
          // nodrag: без этого клик по кнопке тащил бы узел.
          className="nodrag ml-auto cursor-pointer rounded px-1 text-xs leading-none text-muted-foreground opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 group-hover/node:opacity-100"
        >
          ×
        </button>
      </div>

      <div className="px-3 py-2">{children}</div>
    </div>
  );
}
