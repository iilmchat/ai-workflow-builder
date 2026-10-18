import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Конфиг тестов фронтенда.
 *
 * `environment: 'jsdom'` (KI-155): до v0.9.1 тесты шли в `node`, поэтому ни
 * один компонент нельзя было импортировать — `@/i18n` на этапе импорта
 * обращается к `document`, а `@testing-library/react` требует DOM. jsdom
 * делает возможными компонентные тесты (см. `src/components/nodes/*.spec.tsx`),
 * а чистые модули (`src/lib/*`) продолжают проверяться как раньше.
 *
 * `setupFiles` подключает матчеры `@testing-library/jest-dom` (`toBeInTheDocument`,
 * `toHaveClass`, …), очистку DOM между тестами и фиксированный язык интерфейса:
 * jsdom отдаёт `navigator.language = 'en-US'`, и без этого i18n в тестах
 * переключался бы на английский (KI-155).
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
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.spec.ts',
      'src/**/*.spec.tsx',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
  },
});
