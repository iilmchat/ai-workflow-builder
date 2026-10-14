import { useTranslation } from 'react-i18next';
import { NODE_REGISTRY } from '@/lib/node-registry';
import type { NodeType } from '@/types/graph';

interface ToolbarProps {
  /** Добавляет узел указанного типа в центр канваса. */
  onAddNode: (type: NodeType) => void;
  /** Кнопки неактивны, пока канвас не сообщил функцию поиска центра. */
  disabled?: boolean;
}

/**
 * Порядок кнопок в тулбаре.
 *
 * Список явный, а не `NODE_TYPES`: порядок кнопок — часть UI, он не должен
 * меняться при перестановке ключей реестра. Иконка и подпись берутся из
 * реестра (KI-123; R5.1): эмодзи из `icon`, подпись — через `tLabel(labelKey)`.
 * До R5.3 подписи русские (вариант A), в R5.3 их заменит i18n.
 */
const TOOLBAR_TYPES: NodeType[] = ['text', 'llm', 'image_generation'];

/**
 * Нижний тулбар: кнопки добавления узлов.
 *
 * Позиционируется абсолютно по центру низа экрана, поверх канваса.
 */
export function Toolbar({ onAddNode, disabled = false }: ToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-xl bg-background px-3 py-2 shadow-lg ring-1 ring-border">
        {TOOLBAR_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            disabled={disabled}
            onClick={() => onAddNode(type)}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted active:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true">{NODE_REGISTRY[type].icon}</span>
            {t(NODE_REGISTRY[type].labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
