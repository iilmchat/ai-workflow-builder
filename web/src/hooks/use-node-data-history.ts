import { useCallback } from 'react';
import { useReactFlow, type Node } from '@xyflow/react';
import { useWorkflowStore } from '@/stores/workflow';

/**
 * Правка данных узла, доступная истории графа.
 *
 * @param id - id узла
 * @param patch - поля `data`, которые нужно обновить
 */
export type NodeDataMutator = (id: string, patch: Record<string, unknown>) => void;

/**
 * Оборачивает `updateNodeData` React Flow записью в историю графа (R6.4b.2b).
 *
 * Правки полей узлов (`TextNode`, `LLMNode`, `ImageGenNode`, `CommentNode`)
 * идут не через actions стора, а через `updateNodeData` из `useReactFlow` —
 * поэтому обернуть их в сторе, как `addNode`/`removeNode`, нельзя. Хук
 * повторяет ту же схему: **до** записи нового значения в стор берётся снимок
 * текущего графа.
 *
 * Снимок берётся не на каждый символ: `pushHistoryCoalesced` склеивает правки
 * одного поля, разделённые меньше секунды (иначе одна фраза вытеснила бы всю
 * историю). Правка селекта — отдельный шаг: она и так одиночная.
 *
 * @returns функция правки `data` узла, эквивалентная `updateNodeData(id, patch)`
 */
export function useNodeDataHistory(): NodeDataMutator {
  const { updateNodeData } = useReactFlow<Node>();
  const pushHistoryCoalesced = useWorkflowStore(
    (state) => state.pushHistoryCoalesced,
  );

  return useCallback<NodeDataMutator>(
    (id, patch) => {
      // Снимок «до» — ровно как в actions стора (DESIGN v0.8 § 7.2).
      pushHistoryCoalesced();
      updateNodeData(id, patch);
    },
    [pushHistoryCoalesced, updateNodeData],
  );
}
