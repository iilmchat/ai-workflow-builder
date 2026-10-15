import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@xyflow/react/dist/style.css';
// i18n инициализируется до рендера: переводы нужны уже первому рендеру,
// а стор читает i18n.t() на этапе импорта (см. stores/workflow.ts).
import './i18n';
import './index.css';
import { App } from '@/App';
import { AuthProvider } from '@/components/auth/AuthProvider';
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
    {/* AuthProvider внутри Router: у него и будущих фич есть доступ к навигации. */}
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
