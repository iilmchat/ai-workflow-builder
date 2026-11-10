import { ReactFlowProvider } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('ImageGenNode — «Открыть»/«Скачать» (S8.1, KI-124)', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  let createObjectUrl: ReturnType<typeof vi.fn>;
  let revokeObjectUrl: ReturnType<typeof vi.fn>;
  let clickedLink: HTMLAnchorElement | null;

  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    createObjectUrl = vi.fn(() => 'blob:mock-image');
    revokeObjectUrl = vi.fn();
    clickedLink = null;

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    });
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
    vi.unstubAllGlobals();
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

  it('«Скачать» скачивает blob и подставляет имя файла', async () => {
    const blob = new Blob(['image'], { type: 'image/png' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(blob) })),
    );

    renderNode();

    fireEvent.click(
      screen.getByRole('button', { name: ru['node.image.download'] }),
    );

    await waitFor(() => expect(createObjectUrl).toHaveBeenCalledWith(blob));

    expect(clickedLink?.download).toBe('image.png');
    expect(clickedLink?.href).toContain('blob:mock-image');
  });

  it('при CORS/сетевой ошибке «Скачать» открывает ссылку в новой вкладке', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    renderNode();

    fireEvent.click(
      screen.getByRole('button', { name: ru['node.image.download'] }),
    );

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining('/media/file/run-1/image.png'),
        '_blank',
        'noopener,noreferrer',
      ),
    );
    expect(createObjectUrl).not.toHaveBeenCalled();
  });
});
