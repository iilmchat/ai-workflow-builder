import type { ComponentType } from 'react';
import type { NodeProps, NodeTypes } from '@xyflow/react';
import { ImageGenNode } from './ImageGenNode';
import { LLMNode } from './LLMNode';
import { TextNode } from './TextNode';

/**
 * Реестр кастомных узлов React Flow.
 *
 * Ключ должен совпадать со значением `type` у узла
 * (`text` | `llm` | `image_generation`) — то же имя уходит в backend.
 *
 * Типы сужаем через `NodeTypes`: у каждого узла свои данные (`TextNodeData`,
 * `LlmNodeData`, ...), а `NodeProps` инвариантен по типу узла, поэтому без
 * приведения конкретные компоненты не подходят под общий `ComponentType`.
 * Во время выполнения React Flow передаёт компоненту props именно его узла.
 */
const registry = {
  text: TextNode,
  llm: LLMNode,
  image_generation: ImageGenNode,
} as unknown as NodeTypes;

export const nodeTypes: Record<string, ComponentType<NodeProps>> = registry;

export { ImageGenNode, LLMNode, TextNode };
