import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Конфиг dev-сервера визуального редактора.
 *
 * Запросы к backend-API (`/workflow`, `/engine`) проксируются на NestJS,
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
    },
  },
});
