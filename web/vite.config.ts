import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Конфиг dev-сервера визуального редактора.
 *
 * Запросы к backend-API (`/workflow`, `/engine`, `/runs`) проксируются на NestJS,
 * поэтому фронтенд обращается к относительным путям и не упирается в CORS.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/workflow': 'http://localhost:3000',
      '/engine': 'http://localhost:3000',
      /**
       * SSE-поток прогресса запуска (R4.1).
       *
       * `http-proxy` (внутри Vite) отдаёт ответ потоково, без буферизации, но по
       * умолчанию ограничивает время соединения — долгий запуск (LLM-узлы и
       * ретраи job'а, KI-040) легко переживёт такой таймаут, и поток оборвётся
       * до `run_completed`. Поэтому таймауты сняты: `timeout`/`proxyTimeout: 0`
       * отключают ограничения, `changeOrigin` нужен для корректного Host.
       */
      '/runs': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
});
