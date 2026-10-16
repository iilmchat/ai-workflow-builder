import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';
import { API_PREFIXES } from './src/lib/api-prefixes.ts';

/** Адрес backend'а (NestJS), на который уходят API-запросы dev-сервера. */
const TARGET = 'http://localhost:3000';

/**
 * Генерирует `server.proxy` из единого реестра `API_PREFIXES`.
 *
 * Раньше префиксы перечислялись здесь руками, и трижды список расходился с
 * backend'ом: `/llm` (KI-072), `/media` (KI-120), `/templates` (KI-299).
 * Забытый префикс не ломал сборку и unit-тесты — запрос уходил в SPA-fallback
 * Vite, возвращал `200 text/html`, и ошибка всплывала только на CDP-смоуке
 * (Zod не мог разобрать HTML). Теперь источник правды один
 * (`web/src/lib/api-prefixes.ts`), а паритет с backend-контроллерами проверяют
 * spec'и на обеих сторонах.
 *
 * Поведение каждого префикса сохраняется:
 * - `sse: true` — поток не обрывается таймаутом (`timeout`/`proxyTimeout`: 0);
 * - `htmlFallback: true` — HTML-запросы (deep-link) получают `/index.html`,
 *   а `fetch` с JSON всё так же уходит на backend (R6.2.2);
 * - остальные — короткая форма (строка с target).
 *
 * @returns карта прокси: ключ — `/префикс`, значение — target или настройки
 */
function buildProxy(): Record<string, string | ProxyOptions> {
  const proxy: Record<string, string | ProxyOptions> = {};

  for (const entry of API_PREFIXES) {
    const key = `/${entry.prefix}`;

    if (entry.sse) {
      proxy[key] = {
        target: TARGET,
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      };
    } else if (entry.htmlFallback) {
      proxy[key] = {
        target: TARGET,
        bypass: (request: IncomingMessage) =>
          request.headers.accept?.includes('text/html') === true
            ? '/index.html'
            : undefined,
      };
    } else {
      proxy[key] = TARGET;
    }
  }

  return proxy;
}

/**
 * Конфиг dev-сервера визуального редактора.
 *
 * Запросы к backend-API проксируются на NestJS по списку из `API_PREFIXES`
 * (см. `web/src/lib/api-prefixes.ts`), поэтому фронтенд обращается к
 * относительным путям и не упирается в CORS.
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
    proxy: buildProxy(),
  },
});
