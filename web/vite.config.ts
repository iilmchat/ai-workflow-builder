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
 *
 * `host: '127.0.0.1'` (KI-326): без явного host'а Vite слушал только
 * `[::1]:5173`, и `fetch('http://127.0.0.1:5173/…')` (CDP-смоук, скрипты,
 * любой инструмент с IPv4-адресом) падал с `ECONNREFUSED`, а Chrome по
 * `127.0.0.1` показывал `chrome-error://chromewebdata/`. Смоук теперь ходит
 * на `127.0.0.1` — ровно на тот адрес, который слушает сервер.
 * Внимание: `localhost` на этой машине резолвится в `::1`, поэтому
 * `http://localhost:5173` после этого изменения может не открыться.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    /**
     * KI-008/KI-390: код-сплит вместо повышения порога.
     *
     * До v0.9.3 все узлы лежали в одном `index-*.js` (~775 kB): каждый новый
     * тип узла приближал сборку к лимиту, а порог warning'а приходилось
     * поднимать (780 kB). Теперь компоненты узлов ленивые (`React.lazy` в
     * `src/lib/node-registry.ts`), а `codeSplitting` раскладывает бандл так,
     * чтобы при старте не грузились ни узлы, ни их общие зависимости:
     *
     * - по чанку на каждый компонент `*Node.tsx` (ленивые чанки);
     * - `react` — React/React DOM/Scheduler (нужны всегда);
     * - `reactflow` — `@xyflow/react` и `@xyflow/system`;
     * - `i18n` — i18next + react-i18next;
     * - `vendor` — остальные библиотеки (zod, zustand, router).
     *
     * Порог оставлен 500 kB (дефолт Vite), чтобы предупреждение снова ловило
     * регрессию, а не маскировалось высоким лимитом.
     */
    chunkSizeWarningLimit: 500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Только сами компоненты (`*Node.tsx`), без `nodes/index.ts`:
            // реэкспорт реестра статически импортируется `Canvas`, и если
            // сгруппировать его с узлами, стартовый чанк потянет ленивые
            // модули (modulepreload). `includeDependenciesRecursively: false`
            // обязателен: иначе группа затянет в чанк React, @xyflow и стор —
            // ровно то, что должно остаться в стартовых чанках.
            {
              // Каждый узел — свой чанк: граф с одним Text-узлом не тянет
              // LLM/media/vector-компоненты. `BaseNode` тоже попадает сюда и
              // грузится один раз как общая зависимость.
              debugName: 'nodes',
              name(moduleId) {
                const match = /nodes[\\/]([A-Za-z]+Node)\.tsx$/.exec(moduleId);

                return match?.[1] ?? 'nodes';
              },
              test: /src[\\/]components[\\/]nodes[\\/][A-Za-z]+Node\.tsx$/,
              priority: 50,
              includeDependenciesRecursively: false,
            },
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 40,
            },
            {
              name: 'reactflow',
              test: /node_modules[\\/]@xyflow[\\/]/,
              priority: 30,
            },
            {
              name: 'i18n',
              test: /node_modules[\\/](i18next|react-i18next)[\\/]/,
              priority: 20,
            },
            {
              name: 'vendor',
              test: /node_modules[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: buildProxy(),
  },
});
