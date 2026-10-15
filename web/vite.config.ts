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
      // R6.1b.2: /auth/* уходит на backend вместе с httpOnly refresh-cookie.
      '/auth': 'http://localhost:3000',
      '/workflow': 'http://localhost:3000',
      '/engine': 'http://localhost:3000',
      // Модели для селекта LLM-узла (`GET /llm/models`, R4.1b): обычный JSON,
      // потоковость не нужна, поэтому короткая форма.
      '/llm': 'http://localhost:3000',
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
      // v0.6.0b.2.3: каталог media-моделей (`GET /media/models?type=IMAGE`).
      // KI-072: префиксы перечисляются вручную — /media забыли при
      // добавлении узла Image Generation.
      '/media': 'http://localhost:3000',
    },
  },
});
