/**
 * Кастомные узлы React Flow.
 *
 * Тонкий реэкспорт единого реестра (KI-121): и компоненты, и метаданные
 * (подписи, иконки, категории) теперь живут в `@/lib/node-registry`.
 * Файл оставлен, чтобы не менять импорт `@/components/nodes` у потребителей.
 */
export { nodeTypes, NODE_REGISTRY } from '@/lib/node-registry';

export { ImageGenNode } from './ImageGenNode';
export { LLMNode } from './LLMNode';
export { TextNode } from './TextNode';
