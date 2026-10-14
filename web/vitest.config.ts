import { defineConfig } from 'vitest/config';

/**
 * Конфиг тестов фронтенда.
 *
 * Тесты — «чистые» (паритет ключей i18n и подобное), DOM не нужен, поэтому
 * `environment: 'node'`: jsdom не тянем.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
  },
});
