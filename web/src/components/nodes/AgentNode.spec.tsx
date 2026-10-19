import {
  ReactFlowProvider,
  useReactFlow,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  type RenderResult,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMcpServersAsync, type McpServersResponse } from '@/lib/api';
import ru from '@/i18n/ru.json';
import { useWorkflowStore } from '@/stores/workflow';
import {
  AGENT_TOOLS,
  DEFAULT_AGENT_TOOLS,
  type AgentFlowNode,
  type AgentNodeData,
} from '@/types/graph';
import { AgentNode } from './AgentNode';

/**
 * Мок API каталога MCP (v0.11 S8): реальная сеть в jsdom не нужна, а остальные
 * экспорты `@/lib/api` (их тянет стор) остаются настоящими — иначе упал бы
 * импорт стора.
 */
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();

  return {
    ...actual,
    fetchMcpServersAsync: vi.fn(),
  };
});

/** id узла в тестовом графе. */
const NODE_ID = 'agent-1';

/**
 * Пропсы узла для изолированного рендера.
 *
 * Компонент читает только `id` и `data`; остальные обязательные поля
 * `NodeProps` нужны React Flow и в тесте не используются. Каст через
 * `unknown` — единственный способ не собирать служебный объект React Flow
 * целиком (RULES 1.16: `any` не используется).
 *
 * @param data - данные узла
 * @returns пропсы `AgentNode`
 */
function nodePropsOf(data: AgentNodeData): NodeProps<AgentFlowNode> {
  return {
    id: NODE_ID,
    type: 'agent',
    data,
    selected: false,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
  } as unknown as NodeProps<AgentFlowNode>;
}

/**
 * Собирает данные агента с валидным набором инструментов.
 *
 * @param overrides - поля, которые нужно переопределить
 * @returns `data` узла `agent`
 */
function agentData(overrides: Partial<AgentNodeData> = {}): AgentNodeData {
  return {
    kind: 'agent',
    model: '',
    tools: [...DEFAULT_AGENT_TOOLS],
    ...overrides,
  };
}

/**
 * Доступ к инстансу React Flow из теста.
 *
 * Правки полей идут через `useReactFlow().updateNodeData`, а не через
 * zustand-стор: проверяем именно то хранилище, куда пишет компонент.
 */
let flow: ReactFlowInstance | null = null;

/** Запоминает инстанс React Flow, смонтированный провайдером. */
function FlowProbe() {
  flow = useReactFlow();

  return null;
}

/**
 * Рендерит `AgentNode` внутри провайдера с тем же узлом в store.
 *
 * `defaultNodes` (не `initialNodes`) важен: только в uncontrolled-режиме
 * `updateNodeData` пишет прямо в store, а не отдаёт изменение в
 * `onNodesChange`, которого в изолированном тесте нет.
 *
 * @param data - данные узла
 * @returns результат `render` (нужен `container` для data-атрибутов MCP)
 */
function renderNode(data: AgentNodeData): RenderResult {
  flow = null;

  return render(
    <ReactFlowProvider
      defaultNodes={[
        { id: NODE_ID, type: 'agent', position: { x: 0, y: 0 }, data },
      ]}
    >
      <FlowProbe />
      <AgentNode {...nodePropsOf(data)} />
    </ReactFlowProvider>,
  );
}

/**
 * Каталог MCP для тестов (v0.11 S8).
 *
 * Два сервера: `filesystem` с читающим и пишущим инструментом и `broken` с
 * ошибкой подключения — этого хватает на проверки выбора, бейджей,
 * предупреждения и disabled-состояния.
 *
 * @param overrides - поля ответа, которые нужно переопределить
 * @returns ответ `GET /mcp/servers`
 */
function mcpCatalog(overrides: Partial<McpServersResponse> = {}): McpServersResponse {
  return {
    enabled: true,
    maxToolsPerNode: 5,
    servers: [
      {
        name: 'filesystem',
        transport: 'http',
        status: 'ok',
        tools: [
          {
            name: 'read_file',
            title: 'Read file',
            description: 'Прочитать файл',
            readOnlyHint: true,
            idempotentHint: true,
          },
          {
            name: 'write_file',
            title: 'Write file',
            description: 'Записать файл',
            destructiveHint: true,
          },
        ],
      },
      {
        name: 'broken',
        transport: 'http',
        status: 'error',
        error: 'не удалось получить каталог инструментов',
        tools: [],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // По умолчанию MCP выключен: старые тесты узла не должны видеть секцию.
  vi.mocked(fetchMcpServersAsync).mockResolvedValue({
    enabled: false,
    maxToolsPerNode: 20,
    servers: [],
  });

  // Стор — модульный синглтон: сбрасываем запуск, каталоги и историю.
  // `loadLlmModelsAsync`/`loadMcpServersAsync` не должны ходить в сеть из
  // `useEffect` узла, кроме замоканного каталога MCP.
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    nodeStatuses: {},
    nodeOutputs: {},
    nodeMetrics: {},
    llmModels: [],
    llmModelsLoaded: true,
    mcpServers: null,
    mcpServersLoaded: false,
    mcpServersError: null,
    loadMcpServersAsync: async () => {
      const catalog = await fetchMcpServersAsync();

      useWorkflowStore.setState({
        mcpServers: catalog,
        mcpServersLoaded: true,
      });
    },
    loadLlmModelsAsync: async () => undefined,
    pushHistoryCoalesced: () => undefined,
  });
});

describe('AgentNode — рендер и правки полей (KI-405)', () => {
  it('рендерит модель, системную инструкцию и инструменты', () => {
    renderNode(agentData({ systemPrompt: 'Ты — аналитик' }));

    const systemPrompt = screen.getByLabelText(ru['node.agent.systemPrompt']);

    expect(systemPrompt).toHaveValue('Ты — аналитик');
    expect(screen.getByLabelText(ru['node.agent.model'])).toBeInTheDocument();
    expect(
      screen.getByLabelText(ru['node.agent.maxIterations']),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: ru['node.agent.tools'] }),
    ).toBeInTheDocument();
    // Узел показывает все инструменты, включён только дефолтный набор.
    expect(screen.getAllByRole('checkbox')).toHaveLength(AGENT_TOOLS.length);
    expect(
      screen.getByRole('checkbox', { name: ru['tools.http_request'] }),
    ).toBeChecked();
  });

  it('fireEvent.change в systemPrompt обновляет data узла в React Flow store', async () => {
    renderNode(agentData());

    fireEvent.change(screen.getByLabelText(ru['node.agent.systemPrompt']), {
      target: { value: 'Сначала проверь факты' },
    });

    await waitFor(() => {
      expect(flow?.getNode(NODE_ID)?.data.systemPrompt).toBe(
        'Сначала проверь факты',
      );
    });
  });
});

describe('AgentNode — секция MCP-инструментов (v0.11 S8)', () => {
  it('при MCP_ENABLED=false секция не рендерится', async () => {
    renderNode(agentData());

    await waitFor(() => {
      expect(vi.mocked(fetchMcpServersAsync)).toHaveBeenCalled();
    });

    expect(
      screen.queryByText(ru['node.agent.mcp.title']),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(ru['node.agent.mcp.hint'])).not.toBeInTheDocument();
  });

  it('показывает серверы, бейджи и записывает выбор в data.mcpTools', async () => {
    vi.mocked(fetchMcpServersAsync).mockResolvedValue(mcpCatalog());

    const { container } = renderNode(agentData());

    expect(
      await screen.findByText(ru['node.agent.mcp.title']),
    ).toBeInTheDocument();
    // Секция видна, серверы помечены data-атрибутами для smoke.
    expect(
      container.querySelector('[data-agent-mcp-server="filesystem"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-agent-mcp-server="broken"]'),
    ).not.toBeNull();
    // Аннотации инструментов превращаются в бейджи.
    expect(screen.getByText(ru['node.agent.mcp.readOnly'])).toBeInTheDocument();
    expect(screen.getByText(ru['node.agent.mcp.idempotent'])).toBeInTheDocument();
    expect(screen.getByText(ru['node.agent.mcp.destructive'])).toBeInTheDocument();
    // Destructive-инструмент сопровождается предупреждением.
    expect(
      screen.getByText(ru['node.agent.mcp.destructiveWarning']),
    ).toBeInTheDocument();

    const readFile = container.querySelector<HTMLInputElement>(
      '[data-agent-mcp-tool="filesystem:read_file"]',
    );

    expect(readFile).not.toBeNull();
    expect(readFile).not.toBeChecked();

    fireEvent.click(readFile as HTMLInputElement);

    await waitFor(() => {
      expect(flow?.getNode(NODE_ID)?.data.mcpTools).toEqual([
        { server: 'filesystem', tool: 'read_file' },
      ]);
    });
  });

  it('при status=error инструменты disabled, текст ошибки показан', async () => {
    vi.mocked(fetchMcpServersAsync).mockResolvedValue(
      mcpCatalog({
        servers: [
          {
            name: 'broken',
            transport: 'sse',
            status: 'error',
            error: 'не удалось получить каталог инструментов',
            tools: [{ name: 'search', title: 'Search' }],
          },
        ],
      }),
    );

    const { container } = renderNode(agentData());

    await screen.findByText(ru['node.agent.mcp.title']);

    expect(
      container.querySelector<HTMLInputElement>(
        '[data-agent-mcp-tool="broken:search"]',
      ),
    ).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      ru['node.agent.mcp.serverError'].replace(
        '{{error}}',
        'не удалось получить каталог инструментов',
      ),
    );
  });

  it('при достигнутом maxToolsPerNode невыбранные инструменты disabled', async () => {
    vi.mocked(fetchMcpServersAsync).mockResolvedValue(
      mcpCatalog({ maxToolsPerNode: 1 }),
    );

    const { container } = renderNode(
      agentData({
        mcpTools: [{ server: 'filesystem', tool: 'read_file' }],
      }),
    );

    await screen.findByText(ru['node.agent.mcp.title']);

    const selected = container.querySelector<HTMLInputElement>(
      '[data-agent-mcp-tool="filesystem:read_file"]',
    );
    const other = container.querySelector<HTMLInputElement>(
      '[data-agent-mcp-tool="filesystem:write_file"]',
    );

    expect(selected).toBeChecked();
    expect(selected).toBeEnabled();
    // Уже выбранный инструмент снимается даже при достигнутом лимите.
    expect(other).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      ru['node.agent.mcp.limitReached'].replace('{{max}}', '1'),
    );
  });
});
