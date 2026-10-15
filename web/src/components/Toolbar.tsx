import { useTranslation } from 'react-i18next';
import { NODE_REGISTRY } from '@/lib/node-registry';
import { useWorkflowStore } from '@/stores/workflow';
import type { NodeType } from '@/types/graph';
import { NodeCatalogPopover } from './NodeCatalogPopover';

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
 * Нижний тулбар: быстрые кнопки добавления узлов и каталог (KI-127).
 *
 * Позиционируется абсолютно по центру низа экрана, поверх канваса. Поповер
 * каталога раскрывается вверх и позиционируется относительно панели тулбара
 * (поэтому вокруг панели — `relative`).
 *
 * Состояние каталога живёт в сторе (`isCatalogOpen`), а не в локальном
 * `useState` (KI-186): тот же каталог открывает клавиша `Tab` на холсте, а два
 * независимых состояния показывали бы разное.
 */
export function Toolbar({ onAddNode, disabled = false }: ToolbarProps) {
  const { t } = useTranslation();
  const catalogOpen = useWorkflowStore((state) => state.isCatalogOpen);
  const setCatalogOpen = useWorkflowStore((state) => state.setCatalogOpen);

  return (
    <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
      <div className="relative">
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

          <button
            type="button"
            data-catalog-toggle="true"
            onClick={() => setCatalogOpen(!catalogOpen)}
            aria-label={t('catalog.open')}
            aria-expanded={catalogOpen}
            className="cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            +
          </button>
        </div>

        <NodeCatalogPopover
          open={catalogOpen}
          onClose={() => setCatalogOpen(false)}
          onAddNode={onAddNode}
        />
      </div>
    </div>
  );
}
