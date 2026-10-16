/**
 * Кастомные узлы React Flow.
 *
 * Тонкий реэкспорт единого реестра (KI-121): и компоненты, и метаданные
 * (подписи, иконки, категории) теперь живут в `@/lib/node-registry`.
 * Файл оставлен, чтобы не менять импорт `@/components/nodes` у потребителей.
 */
export { nodeTypes, NODE_REGISTRY } from '@/lib/node-registry';

export { CommentNode } from './CommentNode';
export { CompareNode } from './CompareNode';
export { ConditionNode } from './ConditionNode';
export { HttpNode } from './HttpNode';
export { ImageGenNode } from './ImageGenNode';
export { ImageToolNode } from './ImageToolNode';
export { LLMNode } from './LLMNode';
export { OutputNode } from './OutputNode';
export { SubWorkflowNode } from './SubWorkflowNode';
export { TextNode } from './TextNode';
