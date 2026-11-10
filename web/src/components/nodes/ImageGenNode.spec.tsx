import { ReactFlowProvider } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ru from '@/i18n/ru.json';
import { useWorkflowStore } from '@/stores/workflow';
import type { ImageGenFlowNode } from '@/types/graph';
import { ImageGenNode } from './ImageGenNode';

/** URL результата в нашем хранилище (same-origin, KI-362). */
const STORED_URL = '/media/file/run-1/image.png';

/**
 * Собирает пропсы узла для изолированного рендера.
 *
 * @returns пропсы `ImageGenNode`
 */
function nodeProps(): NodeProps<ImageGenFlowNode> {
  return {
    id: 'img-1',
    type: 'image_generation',
    data: { kind: 'image', model: 'gpt-image-1' },
    selected: false,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
  } as unknown as NodeProps<ImageGenFlowNode>;
}

/**
 * Рендерит узел в провайдере React Flow (`Handle` требует контекст).
 *
 * @returns результат `render`
 */
function renderNode() {
  return render(
    <ReactFlowProvider>
      <ImageGenNode {...nodeProps()} />
    </ReactFlowProvider>,
  );
}

describe('ImageGenNode — «Открыть»/«Скачать» (S8.1/S8.2, KI-124/KI-466)', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  let clickedLink: HTMLAnchorElement | null;

  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    clickedLink = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickedLink = this;
    });

    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      nodeStatuses: {},
      nodeOutputs: {},
      nodeErrors: {},
      nodeLogs: {},
      nodeMetrics: {
        'img-1': {
          durationMs: 10,
          tokensIn: null,
          tokensOut: null,
          costUsd: null,
          costStatus: null,
          costRub: '1.000000',
          cacheReadTokens: null,
          cacheCreationTokens: null,
          cacheSavingsUsd: null,
          storedUrl: STORED_URL,
          storedExpiresAt: null,
        },
      },
      mediaModels: [],
      mediaModelsLoaded: true,
      loadMediaModelsAsync: async () => undefined,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('«Открыть» открывает ссылку в новой вкладке', () => {
    renderNode();

    fireEvent.click(screen.getByRole('button', { name: ru['node.image.open'] }));

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('/media/file/run-1/image.png'),
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('«Скачать» ведёт на same-origin прокси, а не качает blob в браузере', () => {
    renderNode();

    fireEvent.click(
      screen.getByRole('button', { name: ru['node.image.download'] }),
    );

    expect(clickedLink).not.toBeNull();

    const href = clickedLink?.getAttribute('href') ?? '';
    const parsed = new URL(href, 'http://localhost');

    expect(parsed.pathname).toBe('/media/download');
    expect(decodeURIComponent(parsed.searchParams.get('url') ?? '')).toContain(
      '/media/file/run-1/image.png',
    );
    // Старый blob-путь больше не используется: CORS на S3 не нужен.
    expect(href).not.toContain('blob:');
  });
});
