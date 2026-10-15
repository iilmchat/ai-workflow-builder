import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Конфиг тестов фронтенда.
 *
 * Тесты — «чистые» (паритет ключей i18n и подобное), DOM не нужен, поэтому
 * `environment: 'node'`: jsdom не тянем.
 *
 * Алиас `@` повторяет `vite.config.ts` (R6.4b.2b): тесты модулей, которые
 * импортируют друг друга через `@/…` (`stores/workflow.ts`), без него не
 * резолвятся — Vite-конфиг в тестовом прогоне не применяется.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
  },
});
