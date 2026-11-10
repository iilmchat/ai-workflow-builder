import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ru from '@/i18n/ru.json';
import { useWorkflowStore } from '@/stores/workflow';
import { WELCOME_HIDDEN_STORAGE_KEY, WelcomeScreen } from './WelcomeScreen';

/** Сбрасывает граф и настройку welcome-экрана между тестами. */
function resetState(): void {
  useWorkflowStore.getState().newWorkflow();
  localStorage.removeItem(WELCOME_HIDDEN_STORAGE_KEY);
}

describe('WelcomeScreen (KI-232)', () => {
  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    resetState();
  });

  it('показывает три стартовых сценария на пустом холсте', () => {
    render(<WelcomeScreen />);

    expect(screen.getByText(ru['welcome.title'])).toBeInTheDocument();
    expect(screen.getByText(ru['welcome.card.image.title'])).toBeInTheDocument();
    expect(screen.getByText(ru['welcome.card.llm.title'])).toBeInTheDocument();
    expect(screen.getByText(ru['welcome.card.http.title'])).toBeInTheDocument();
  });

  it('по клику на карточку создаёт Text → ImageGen и связь', () => {
    render(<WelcomeScreen />);

    fireEvent.click(screen.getByText(ru['welcome.card.image.title']));

    const { nodes, edges } = useWorkflowStore.getState();

    expect(nodes.map((node) => node.type)).toEqual(['text', 'image_generation']);
    expect(nodes[0]?.data).toMatchObject({
      kind: 'text',
      value: expect.stringContaining('Кот-космонавт'),
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: nodes[0]?.id,
      target: nodes[1]?.id,
      sourceHandle: 'text-output',
      targetHandle: 'text-input',
    });
  });

  it('создаёт цепочку Text → LLM → ImageGen с двумя связями', () => {
    render(<WelcomeScreen />);

    fireEvent.click(screen.getByText(ru['welcome.card.llm.title']));

    const { nodes, edges } = useWorkflowStore.getState();

    expect(nodes.map((node) => node.type)).toEqual([
      'text',
      'llm',
      'image_generation',
    ]);
    expect(edges).toHaveLength(2);
  });

  it('создаёт HTTP → LLM с публичным примером URL', () => {
    render(<WelcomeScreen />);

    fireEvent.click(screen.getByText(ru['welcome.card.http.title']));

    const { nodes, edges } = useWorkflowStore.getState();

    expect(nodes.map((node) => node.type)).toEqual(['http', 'llm']);
    expect(nodes[0]?.data).toMatchObject({
      kind: 'http',
      url: 'https://api.github.com/repos/facebook/react',
    });
    expect(edges).toHaveLength(1);
  });

  it('скрывается кнопкой «Скрыть» без сохранения настройки', () => {
    render(<WelcomeScreen />);

    fireEvent.click(screen.getByText(ru['welcome.hide']));

    expect(screen.queryByText(ru['welcome.title'])).not.toBeInTheDocument();
    expect(localStorage.getItem(WELCOME_HIDDEN_STORAGE_KEY)).toBeNull();
  });

  it('«Больше не показывать» сохраняется в localStorage и скрывает экран при следующем монтировании', () => {
    const first = render(<WelcomeScreen />);

    fireEvent.click(screen.getByLabelText(ru['welcome.dont_show']));

    expect(localStorage.getItem(WELCOME_HIDDEN_STORAGE_KEY)).toBe('1');
    first.unmount();

    render(<WelcomeScreen />);

    expect(screen.queryByText(ru['welcome.title'])).not.toBeInTheDocument();
  });

  it('не показывается, если в графе уже есть узлы или workflow сохранён', () => {
    useWorkflowStore.getState().addNode('text', { x: 0, y: 0 });

    const first = render(<WelcomeScreen />);

    expect(screen.queryByText(ru['welcome.title'])).not.toBeInTheDocument();
    first.unmount();

    resetState();
    useWorkflowStore.setState({ currentWorkflowId: 'wf-1' });

    render(<WelcomeScreen />);

    expect(screen.queryByText(ru['welcome.title'])).not.toBeInTheDocument();
  });
});
