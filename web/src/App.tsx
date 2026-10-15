import { useCallback, useEffect } from 'react';
import { Route, Routes, useSearchParams } from 'react-router-dom';
import { Canvas } from '@/components/Canvas';
import { LoginPage } from '@/components/auth/LoginPage';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { ShareViewPage } from '@/components/ShareViewPage';
import { RunResultPanel } from '@/components/RunResultPanel';
import { useAuthStore } from '@/stores/auth';
import { Toast } from '@/components/Toast';
import { Toolbar } from '@/components/Toolbar';
import { TopBar } from '@/components/TopBar';
import {
  useWorkflowStore,
  type FindCenterHandler,
} from '@/stores/workflow';
import type { NodeType } from '@/types/graph';

/**
 * Корневой компонент редактора: верхняя панель, канвас, нижний тулбар и панель
 * результата.
 *
 * Создание узла живёт здесь: Canvas отдаёт функцию поиска центра вьюпорта
 * (у него есть доступ к трансформации React Flow), а стор — операцию добавления.
 * Раскладка — flex-колонка: канвас занимает всё свободное место (`flex-1`), а
 * панель результата — фиксированную высоту снизу, поэтому React Flow корректно
 * ресайзится при сворачивании панели (у контейнера всегда есть размер).
 */
export function App() {
  const addNode = useWorkflowStore((state) => state.addNode);
  const nodeCount = useWorkflowStore((state) => state.nodes.length);
  const findCenter = useWorkflowStore((state) => state.findCenter);
  const setFindCenter = useWorkflowStore((state) => state.setFindCenter);
  const loadWorkflowAsync = useWorkflowStore((state) => state.loadWorkflowAsync);

  // При открытии страницы с ?workflowId=... подтягиваем сохранённый граф.
  // KI-228: грузим только когда сессия готова и зависим от статуса. Иначе
  // эффект срабатывает один раз на маунте (ещё на /login, без сессии → 401),
  // а после логина query не меняется и граф уже не грузится.
  const [searchParams] = useSearchParams();
  const workflowIdParam = searchParams.get('workflowId');
  const authStatus = useAuthStore((state) => state.status);

  useEffect(() => {
    if (workflowIdParam && authStatus === 'authenticated') {
      void loadWorkflowAsync(workflowIdParam);
    }
  }, [loadWorkflowAsync, workflowIdParam, authStatus]);

  // Список моделей нужен не только LLM-узлам, но и созданию нового узла
  // (KI-074: модель по умолчанию = llmModels[0]), поэтому грузим его на старте.
  useEffect(() => {
    void useWorkflowStore.getState().loadLlmModelsAsync();
  }, []);

  // Каталог media-моделей — та же причина: image-узел создаётся сразу с
  // первой доступной моделью (v0.6.0b.2.3).
  useEffect(() => {
    void useWorkflowStore.getState().loadMediaModelsAsync();
  }, []);

  const handleCanvasReady = useCallback(
    (handler: FindCenterHandler) => {
      setFindCenter(handler);
    },
    [setFindCenter],
  );

  const handleAddNode = useCallback(
    (type: NodeType) => {
      if (!findCenter) {
        return;
      }

      const center = findCenter();
      // Раскладываем узлы сеткой от центра: карточка ~240x150, поэтому шаг
      // 280x190 — узлы не накладываются друг на друга.
      const column = nodeCount % 3;
      const row = Math.floor(nodeCount / 3);

      addNode(type, {
        x: center.x - 280 + column * 280,
        y: center.y - 80 + row * 190,
      });
    },
    [addNode, findCenter, nodeCount],
  );

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <div className="relative flex h-screen w-screen flex-col">
              <TopBar />

              <div className="relative min-h-0 flex-1">
                <Canvas onReady={handleCanvasReady} />
                <Toolbar onAddNode={handleAddNode} />
              </div>

              <RunResultPanel />
              <Toast />
            </div>
          </ProtectedRoute>
        }
      />
      {/* R6.2.2: публичный просмотр по share-ссылке — без ProtectedRoute. */}
      <Route path="/workflow/share/:token" element={<ShareViewPage />} />
    </Routes>
  );
}
