import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkflowStore } from '@/stores/workflow';
import type { AppNode, NodeType } from '@/types/graph';

/** Ключ localStorage: пользователь отказался от welcome-экрана (KI-232). */
export const WELCOME_HIDDEN_STORAGE_KEY = 'workflow-builder.welcome.hidden';

/** Описание узла шаблона: тип и позиция на холсте. */
interface TemplateNode {
  /** Тип узла из реестра React Flow. */
  readonly type: NodeType;
  /** Координата левого верхнего угла. */
  readonly x: number;
  /** Координата левого верхнего угла. */
  readonly y: number;
}

/** Описание связи шаблона: индексы узлов + id портов. */
interface TemplateEdge {
  /** Индекс узла-источника в массиве {@link TemplateNode}. */
  readonly from: number;
  /** Индекс узла-приёмника. */
  readonly to: number;
  /** id выходного порта источника. */
  readonly sourceHandle: string;
  /** id входного порта приёмника. */
  readonly targetHandle: string;
}

/** Шаблон графа для карточки welcome-экрана. */
interface WelcomeTemplate {
  /** Стабильный id для тестов/смоука. */
  readonly id: string;
  /** Ключ i18n заголовка. */
  readonly titleKey: string;
  /** Ключ i18n описания. */
  readonly descriptionKey: string;
  /** Узлы шаблона. */
  readonly nodes: readonly TemplateNode[];
  /** Связи шаблона. */
  readonly edges: readonly TemplateEdge[];
  /** Пример текста для Text-узла (если есть). */
  readonly sampleText?: string;
  /** Пример URL для HTTP-узла (если есть). */
  readonly sampleUrl?: string;
}

/**
 * Три стартовых сценария (KI-232).
 *
 * Позиции разнесены по X, чтобы карточки не накладывались друг на друга.
 * Порты совпадают с `Handle id` компонентов узлов: `text-output`,
 * `text-input`, `http-output`.
 */
const TEMPLATES: readonly WelcomeTemplate[] = [
  {
    id: 'text-to-image',
    titleKey: 'welcome.card.image.title',
    descriptionKey: 'welcome.card.image.description',
    nodes: [
      { type: 'text', x: 40, y: 160 },
      { type: 'image_generation', x: 360, y: 160 },
    ],
    edges: [
      {
        from: 0,
        to: 1,
        sourceHandle: 'text-output',
        targetHandle: 'text-input',
      },
    ],
    sampleText: 'Кот-космонавт в неоновом городе, кинематографичный свет',
  },
  {
    id: 'text-llm-image',
    titleKey: 'welcome.card.llm.title',
    descriptionKey: 'welcome.card.llm.description',
    nodes: [
      { type: 'text', x: 0, y: 160 },
      { type: 'llm', x: 300, y: 160 },
      { type: 'image_generation', x: 600, y: 160 },
    ],
    edges: [
      {
        from: 0,
        to: 1,
        sourceHandle: 'text-output',
        targetHandle: 'text-input',
      },
      {
        from: 1,
        to: 2,
        sourceHandle: 'text-output',
        targetHandle: 'text-input',
      },
    ],
    sampleText: 'Придумай промпт для иллюстрации к сказке о роботе-садовнике',
  },
  {
    id: 'http-llm',
    titleKey: 'welcome.card.http.title',
    descriptionKey: 'welcome.card.http.description',
    nodes: [
      { type: 'http', x: 0, y: 160 },
      { type: 'llm', x: 320, y: 160 },
    ],
    edges: [
      {
        from: 0,
        to: 1,
        sourceHandle: 'http-output',
        targetHandle: 'text-input',
      },
    ],
    sampleUrl: 'https://api.github.com/repos/facebook/react',
  },
];

/**
 * Читает сохранённый отказ от welcome-экрана.
 *
 * @returns `true`, если пользователь выбрал «Больше не показывать»
 */
function readHiddenPreference(): boolean {
  try {
    return localStorage.getItem(WELCOME_HIDDEN_STORAGE_KEY) === '1';
  } catch {
    // Приватный режим/запрет storage — экран просто показываем.
    return false;
  }
}

/**
 * Сохраняет отказ от welcome-экрана.
 *
 * @param hidden - `true` — больше не показывать
 * @returns ничего
 */
function writeHiddenPreference(hidden: boolean): void {
  try {
    if (hidden) {
      localStorage.setItem(WELCOME_HIDDEN_STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(WELCOME_HIDDEN_STORAGE_KEY);
    }
  } catch {
    // storage недоступен — настройка живёт только до перезагрузки.
  }
}

/**
 * Применяет шаблон к холсту (KI-232).
 *
 * Узлы создаются через `addNode` — так используются те же дефолты моделей и
 * история отмены, что у ручного добавления. id новых узлов читаются из стора
 * после вставки: `addNode` не возвращает созданный узел. Связи добавляются
 * через `onConnect` с явными портами, иначе React Flow не знает, какой вход
 * соединять.
 *
 * @param template - выбранный шаблон
 * @returns ничего
 */
function applyTemplate(template: WelcomeTemplate): void {
  const store = useWorkflowStore.getState();
  const startIndex = store.nodes.length;

  for (const node of template.nodes) {
    store.addNode(node.type, { x: node.x, y: node.y });
  }

  const created = useWorkflowStore.getState().nodes.slice(startIndex);

  // Пример контента: Text-узел получает осмысленный промпт, HTTP — безопасный
  // публичный URL. Это демонстрация, а не скрытая подстановка: пользователь
  // видит и может изменить оба поля.
  const textIndex = template.nodes.findIndex((node) => node.type === 'text');
  const httpIndex = template.nodes.findIndex((node) => node.type === 'http');

  if (
    (template.sampleText !== undefined && textIndex >= 0) ||
    (template.sampleUrl !== undefined && httpIndex >= 0)
  ) {
    const nodes = useWorkflowStore.getState().nodes.map((node, index): AppNode => {
      const createdIndex = index - startIndex;

      if (createdIndex === textIndex && template.sampleText !== undefined) {
        return {
          ...node,
          data: { ...node.data, value: template.sampleText },
        } as AppNode;
      }

      if (createdIndex === httpIndex && template.sampleUrl !== undefined) {
        return {
          ...node,
          data: { ...node.data, url: template.sampleUrl },
        } as AppNode;
      }

      return node;
    });

    useWorkflowStore.getState().setNodes(nodes);
  }

  for (const edge of template.edges) {
    const source = created[edge.from];
    const target = created[edge.to];

    if (source === undefined || target === undefined) {
      continue;
    }

    store.onConnect({
      source: source.id,
      target: target.id,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    });
  }
}

/**
 * Welcome-экран пустого редактора (KI-232).
 *
 * Показывается, когда граф пуст и workflow ещё не сохранён. Три карточки
 * создают готовый граф одним кликом — новичок сразу видит ценность продукта,
 * а не белый холст. Экран можно скрыть на сессию или навсегда (localStorage).
 */
export function WelcomeScreen() {
  const { t } = useTranslation();
  const nodes = useWorkflowStore((state) => state.nodes);
  const currentWorkflowId = useWorkflowStore((state) => state.currentWorkflowId);
  const [hidden, setHidden] = useState(readHiddenPreference);
  const [dontShow, setDontShow] = useState(readHiddenPreference);

  if (hidden || nodes.length > 0 || currentWorkflowId !== null) {
    return null;
  }

  /**
   * Создаёт граф из шаблона и закрывает экран.
   *
   * @param template - выбранный шаблон
   * @returns ничего
   */
  const handleTemplate = (template: WelcomeTemplate): void => {
    applyTemplate(template);
    setHidden(true);
  };

  /**
   * Переключает «Больше не показывать».
   *
   * @param checked - состояние чекбокса
   * @returns ничего
   */
  const handleDontShow = (checked: boolean): void => {
    setDontShow(checked);
    writeHiddenPreference(checked);
  };

  return (
    <div
      data-welcome-screen=""
      className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
    >
      <div className="max-h-full w-full max-w-4xl overflow-y-auto rounded-2xl border border-border bg-background p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {t('welcome.title')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('welcome.subtitle')}
            </p>
          </div>

          <button
            type="button"
            data-welcome-hide=""
            onClick={() => setHidden(true)}
            aria-label={t('welcome.hide')}
            title={t('welcome.hide')}
            className="cursor-pointer rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            {t('welcome.hide')}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              data-welcome-template={template.id}
              onClick={() => handleTemplate(template)}
              className="cursor-pointer rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-primary hover:bg-muted/40"
            >
              <span className="block text-sm font-semibold text-foreground">
                {t(template.titleKey)}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {t(template.descriptionKey)}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              data-welcome-dont-show=""
              checked={dontShow}
              onChange={(event) => handleDontShow(event.target.checked)}
              className="size-3.5 cursor-pointer accent-primary"
            />
            {t('welcome.dont_show')}
          </label>

          <span className="text-[11px] text-muted-foreground">
            {t('welcome.hint')}
          </span>
        </div>
      </div>
    </div>
  );
}
