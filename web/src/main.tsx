import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './index.css';
import { App } from '@/App';
import { useWorkflowStore } from '@/stores/workflow';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Не найден контейнер #root в index.html');
}

// В dev-режиме стор доступен из консоли браузера для отладки.
// В production-сборке этот блок вырезается.
if (import.meta.env.DEV) {
  (window as unknown as { __wfStore?: typeof useWorkflowStore }).__wfStore =
    useWorkflowStore;
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
