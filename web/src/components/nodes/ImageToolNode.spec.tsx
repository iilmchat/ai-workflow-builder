import { ReactFlowProvider } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowStore } from '@/stores/workflow';
import type { ImageToolFlowNode, ImageToolNodeData } from '@/types/graph';
import ru from '@/i18n/ru.json';
import { ImageToolNode } from './ImageToolNode';

/**
 * Подписи поля `audioUrl` берутся из `i18n/ru.json` (язык зафиксирован в
 * `src/test/setup.ts`): тест ловит и рендер, и наличие ключа, не дублируя
 * перевод строкой-литералом.
 */
const AUDIO_LABEL = ru['node.image_tool.audioUrl'];
const INVALID_AUDIO_HINT = ru['node.image_tool.audioUrl.invalid'];
const OPERATION_LABEL = ru['node.image_tool.operation'];
const CHROMAKEY_LABEL = ru['node.image_tool.operation.chromakey'];
const UNAVAILABLE_LABEL = ru['node.image_tool.operation.unavailable'];

/**
 * Собирает пропсы узла для изолированного рендера.
 *
 * Компонент читает только `id` и `data`; остальные обязательные поля
 * `NodeProps` (позиция, `selected`, `dragging`) нужны React Flow и в тесте не
 * используются. Каст через `unknown` — единственный способ не собирать
 * служебный объект React Flow целиком (RULES 1.16: `any` не используется).
 *
 * @param params - `data.params` узла (`audioUrl` живёт здесь, KI-369)
 * @param operation - операция узла (по умолчанию `lipsync`)
 * @returns пропсы `ImageToolNode`
 */
function nodePropsOf(
  params: Record<string, unknown> | undefined,
  operation: ImageToolNodeData['operation'] = 'lipsync',
): NodeProps<ImageToolFlowNode> {
  const data: ImageToolNodeData = {
    kind: 'image_tool',
    operation,
    model: 'creativelab-lipsync',
    ...(params === undefined ? {} : { params }),
  };

  return {
    id: 'tool-1',
    type: 'image_tool',
    data,
    selected: false,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
  } as unknown as NodeProps<ImageToolFlowNode>;
}

/**
 * Рендерит узел в провайдере React Flow (`Handle` и `useReactFlow` требуют
 * контекст, даже когда сам холст не монтируется).
 *
 * @param params - `data.params` узла
 * @returns результат `render` (для `unmount`, если понадобится)
 */
function renderNode(
  params?: Record<string, unknown>,
  operation?: ImageToolNodeData['operation'],
) {
  return render(
    <ReactFlowProvider>
      <ImageToolNode {...nodePropsOf(params, operation)} />
    </ReactFlowProvider>,
  );
}

/**
 * Поле ввода аудио по подписи (идёт из `<label htmlFor>`).
 *
 * @returns элемент `<input type="url">`
 */
function audioField(): HTMLElement {
  return screen.getByLabelText(AUDIO_LABEL);
}

beforeEach(() => {
  // Стор — модульный синглтон: сбрасываем данные запуска и каталог моделей.
  // `loadToolModelsAsync` подменяем no-op'ом — иначе `useEffect` узла пойдёт
  // в `fetch` на относительный URL и тест будет зависеть от backend'а.
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    nodeStatuses: {},
    nodeOutputs: {},
    nodeMetrics: {},
    toolModels: [],
    toolModelsLoaded: true,
    loadToolModelsAsync: async () => undefined,
  });
});

describe('ImageToolNode — операции (KI-418)', () => {
  /**
   * Возвращает текст опций селекта операций.
   *
   * @returns подписи доступных операций
   */
  function operationLabels(): (string | null)[] {
    const select = screen.getByLabelText(OPERATION_LABEL);

    return within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
  }

  it('не предлагает chromakey: у операции нет ни одной модели', () => {
    renderNode(undefined, 'bg_removal');

    expect(operationLabels()).not.toContain(CHROMAKEY_LABEL);
  });

  it('старый chromakey показывает выбранным, но недоступным', () => {
    renderNode(undefined, 'chromakey');

    const option = screen.getByRole('option', {
      name: `${CHROMAKEY_LABEL} — ${UNAVAILABLE_LABEL}`,
    });

    expect(option).toBeDisabled();
  });
});

describe('ImageToolNode — валидация audioUrl (KI-424)', () => {
  it('подсвечивает поле и показывает подсказку для не-http(s) ссылки', () => {
    renderNode({ audioUrl: 'ftp://cdn/voice.mp3' });

    const input = audioField();

    expect(input).toHaveAttribute('type', 'url');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveClass('border-red-500');
    expect(screen.getByText(INVALID_AUDIO_HINT)).toBeInTheDocument();
  });

  it('не подсвечивает корректную https-ссылку', () => {
    renderNode({ audioUrl: 'https://cdn.example.com/voice.mp3' });

    const input = audioField();

    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input).toHaveClass('border-border');
    expect(input).not.toHaveClass('border-red-500');
    expect(screen.queryByText(INVALID_AUDIO_HINT)).not.toBeInTheDocument();
  });

  it('пустое поле — не ошибка: подсветки и подсказки нет', () => {
    renderNode({});

    const input = audioField();

    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input).not.toHaveClass('border-red-500');
    expect(screen.queryByText(INVALID_AUDIO_HINT)).not.toBeInTheDocument();
  });
});
