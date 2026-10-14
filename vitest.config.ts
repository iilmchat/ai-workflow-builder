import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Корневой прогон — только бэкенд (KI-137): `web/` — отдельный пакет со своим
    // vitest.config.ts, его тесты гоняются в CI-job `web`. Без этого root
    // `pnpm test` подхватывал `web/src/i18n/i18n.spec.ts` (327 вместо 325) и
    // зависел от наличия `web/node_modules`.
    exclude: ['**/node_modules/**', '**/dist/**', 'web/**'],
  },
});
