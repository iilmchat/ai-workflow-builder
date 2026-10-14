import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NODE_REGISTRY, NODE_TYPES } from '@/lib/node-registry';
import { NODE_CATEGORIES, type NodeCategory, type NodeType } from '@/types/graph';

interface NodeCatalogPopoverProps {
  /** Открыт ли поповер. */
  readonly open: boolean;
  /** Закрыть поповер. */
  readonly onClose: () => void;
  /** Добавить узел заданного типа. */
  readonly onAddNode: (type: NodeType) => void;
}

/** Узел в каталоге: тип, иконка и переведённая подпись. */
interface CatalogNode {
  readonly type: NodeType;
  readonly icon: string;
  readonly label: string;
}

/** Секция каталога: категория и её непустой список узлов. */
interface CatalogSection {
  readonly category: NodeCategory;
  readonly nodes: CatalogNode[];
}

/**
 * Поповер каталога узлов (KI-127, § 5.2 DESIGN v0.7).
 *
 * Секции строятся из единого реестра (`NODE_REGISTRY`): порядок категорий —
 * из `NODE_CATEGORIES`, пустые категории не показываются (`tools` и `output`
 * пока пусты). Строки — только через `t()`, классы — через переменные темы
 * (R5.2), поэтому поповер корректно выглядит в тёмной теме.
 *
 * Клавиатура: ↑/↓ — по плоскому списку узлов (заголовки секций пропускаются),
 * Enter — добавить выбранный узел, Escape — закрыть, `/` — фокус в поиск.
 * Клик вне поповера (кроме кнопки-переключателя) закрывает его.
 *
 * @param props.open - открыт ли поповер
 * @param props.onClose - закрыть поповер
 * @param props.onAddNode - добавить узел выбранного типа
 */
export function NodeCatalogPopover({
  open,
  onClose,
  onAddNode,
}: NodeCatalogPopoverProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Секции — из реестра: порядок категорий из NODE_CATEGORIES, пустые не показываем.
  const sections = useMemo<CatalogSection[]>(() => {
    const needle = query.trim().toLowerCase();

    return NODE_CATEGORIES.map((category) => ({
      category,
      nodes: NODE_TYPES.filter(
        (type) => NODE_REGISTRY[type].category === category,
      )
        .map((type) => ({
          type,
          icon: NODE_REGISTRY[type].icon,
          label: t(NODE_REGISTRY[type].labelKey),
        }))
        .filter(
          (node) => needle === '' || node.label.toLowerCase().includes(needle),
        ),
    })).filter((section) => section.nodes.length > 0);
  }, [query, t]);

  /** Плоский список узлов: по нему ходят стрелки, пропуская заголовки секций. */
  const flatNodes = useMemo(
    () => sections.flatMap((section) => section.nodes),
    [sections],
  );

  const selectedType = flatNodes[selectedIndex]?.type ?? null;

  // При открытии — чистое состояние: пустой поиск, выбран первый узел.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [open]);

  // Фильтр изменил список — курсор возвращаем в начало, иначе он «улетает».
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Клик вне поповера закрывает его. Кнопку-переключатель «+» игнорируем:
  // иначе её onClick открыл бы поповер заново сразу после закрытия.
  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;

      // Клик по кнопке-переключателю «+» обрабатывает сама кнопка (toggle).
      if (target !== null && target.closest('[data-catalog-toggle]') !== null) {
        return;
      }

      if (containerRef.current?.contains(target) !== true) {
        onClose();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);

    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, onClose]);

  // Escape и «/» слушаем на документе: фокус может быть вне инпута поиска.
  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== '/') {
        return;
      }

      const active = document.activeElement;

      // «/» в поле ввода — это символ, а не горячая клавиша.
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      ) {
        return;
      }

      event.preventDefault();
      searchRef.current?.focus();
    };

    document.addEventListener('keydown', onKeyDown);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  /**
   * Обрабатывает стрелки, Enter и Escape внутри поповера.
   *
   * @param event - событие клавиатуры от контейнера поповера
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (flatNodes.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % flatNodes.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex(
        (index) => (index - 1 + flatNodes.length) % flatNodes.length,
      );
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();

      const node = flatNodes[selectedIndex];

      if (node !== undefined) {
        onAddNode(node.type);
        onClose();
      }
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      data-node-catalog="open"
      role="dialog"
      aria-label={t('catalog.title')}
      onKeyDown={handleKeyDown}
      className="absolute inset-x-0 bottom-full mb-2 rounded-xl border border-border bg-background p-2 shadow-node"
    >
      <input
        ref={searchRef}
        type="text"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('catalog.search')}
        aria-label={t('catalog.search')}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
      />

      <div className="mt-2 max-h-80 overflow-y-auto">
        {sections.length === 0 && (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">
            {t('catalog.empty')}
          </p>
        )}

        {sections.map((section) => (
          <div key={section.category}>
            <h3 className="px-3 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t(`catalog.category.${section.category}`)}
            </h3>

            {section.nodes.map((node) => (
              <button
                key={node.type}
                type="button"
                onClick={() => {
                  onAddNode(node.type);
                  onClose();
                }}
                data-selected={node.type === selectedType}
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-muted data-[selected=true]:bg-muted"
              >
                <span aria-hidden="true">{node.icon}</span>
                <span>{node.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
