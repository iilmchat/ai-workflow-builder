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
      // R6.2.2: навигация браузера на /workflow/share/:token — это deep-link
      // SPA-маршрута, а не вызов API. Прокси отдаёт index.html для HTML-запросов
      // (fetch с JSON всё так же уходит на backend).
      '/workflow': {
        target: 'http://localhost:3000',
        bypass: (request) =>
          request.headers.accept?.includes('text/html') === true ? '/index.html' : undefined,
      },
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
      // R6.6.2: шаблоны workflow (`GET /templates`,
      // `POST /templates/:id/instantiate`).
      // KI-296: в R6.6.1 префикс забыли — Vite отдавал на `/templates`
      // index.html SPA, и вкладка «Шаблоны» падала на Zod-разборе ответа.
      // Та же ловушка, что KI-072 (`/llm`) и KI-120 (`/media`); структурный
      // фикс — единый `/api`-префикс, он не сделан (PROMPT_V5 § 7.3).
      '/templates': 'http://localhost:3000',
    },
  },
});
