import type { NodeType } from '@/types/graph';

interface ToolbarProps {
  /** Добавляет узел указанного типа в центр канваса. */
  onAddNode: (type: NodeType) => void;
  /** Кнопки неактивны, пока канвас не сообщил функцию поиска центра. */
  disabled?: boolean;
}

/** Кнопки нижнего тулбара: иконка, подпись и тип создаваемого узла. */
const BUTTONS: { type: NodeType; label: string; icon: string }[] = [
  { type: 'text', label: 'Text', icon: '📝' },
  { type: 'llm', label: 'LLM', icon: '🤖' },
  { type: 'image', label: 'Image Generation', icon: '🖼' },
];

/**
 * Нижний тулбар: кнопки добавления узлов.
 *
 * Позиционируется абсолютно по центру низа экрана, поверх канваса.
 */
export function Toolbar({ onAddNode, disabled = false }: ToolbarProps) {
  return (
    <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-lg ring-1 ring-slate-200">
        {BUTTONS.map(({ type, label, icon }) => (
          <button
            key={type}
            type="button"
            disabled={disabled}
            onClick={() => onAddNode(type)}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 active:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true">{icon}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
