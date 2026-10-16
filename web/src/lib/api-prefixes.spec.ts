import { describe, expect, it } from 'vitest';
import { API_PREFIXES } from './api-prefixes';

/**
 * Тест-паритет для реестра `API_PREFIXES` (KI-299/072/120).
 *
 * Реестр — единственный источник правды для Vite-прокси. Если в
 * `web/src/lib` появится `fetch('/новый-префикс/...')`, а в реестре его не
 * будет, — Vite отдаст SPA-fallback (`200 text/html`) и ошибка всплывёт только
 * на CDP-смоуке (`/llm` → KI-072, `/media` → KI-120, `/templates` → KI-299).
 * Этот spec ловит такое на `pnpm test`.
 *
 * Исходники читаются через Vite `import.meta.glob(..., { query: '?raw' })`, а
 * не через `node:fs`: в `web/tsconfig.app.json` стоит `types: ["vite/client"]`,
 * поэтому модули `node:*` не типизированы и `pnpm build` (`tsc -b`) падал бы.
 */

/** Первый сегмент относительного пути: `'/auth/refresh'`, `` `/runs/${id}` ``. */
const PATH_SEGMENT_RE = /['"`]\/([a-z][a-z0-9_-]*)(?=[/'"?$`])/g;

/** Исходники `web/src/lib` (кроме spec'ов): имя файла → сырой текст. */
function readLibSources(): Map<string, string> {
  const raw = import.meta.glob('./*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, unknown>;

  const sources = new Map<string, string>();

  for (const [file, content] of Object.entries(raw)) {
    if (file.endsWith('.spec.ts') || typeof content !== 'string') {
      continue;
    }

    sources.set(file, content);
  }

  return sources;
}

/** Исходник `web/vite.config.ts` — чтобы поймать возврат к ручному списку. */
function readViteConfigSource(): string {
  const raw = import.meta.glob('../../vite.config.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, unknown>;

  const content = Object.values(raw)[0];

  return typeof content === 'string' ? content : '';
}

/**
 * Извлекает первые сегменты относительных API-путей из исходника.
 *
 * Служебные и внешние пути не попадают: `/index.html` и `/favicon.ico`
 * отсекаются lookahead'ом (после сегмента идёт `.`, а не `/`, кавычка, `?`
 * или `${`), `https://…` и `./модуль` — тем, что перед `/` нет кавычки или
 * первой идёт точка.
 *
 * @param source - текст TS-файла
 * @returns список сегментов в порядке появления (с повторами)
 */
function extractSegments(source: string): string[] {
  return [...source.matchAll(PATH_SEGMENT_RE)].map((match) => match[1]);
}

/** Множество префиксов из реестра. */
function knownPrefixes(): Set<string> {
  return new Set(API_PREFIXES.map((entry) => entry.prefix));
}

describe('API_PREFIXES (KI-299/072/120)', () => {
  it('реестр не пустой, префиксы — валидные сегменты пути без слэша', () => {
    expect(API_PREFIXES.length).toBeGreaterThanOrEqual(7);

    for (const entry of API_PREFIXES) {
      expect(entry.prefix).toMatch(/^[a-z][a-z0-9_-]*$/);
      expect(entry.prefix.startsWith('/')).toBe(false);
    }
  });

  it('нет дублей префиксов', () => {
    const prefixes = API_PREFIXES.map((entry) => entry.prefix);
    const unique = [...new Set(prefixes)];

    expect(unique).toHaveLength(prefixes.length);
    expect(unique.sort()).toEqual(prefixes.slice().sort());
  });

  it('каждый путь в web/src/lib начинается с известного префикса', () => {
    const known = knownPrefixes();
    const offenders = new Set<string>();

    for (const [file, source] of readLibSources()) {
      for (const segment of extractSegments(source)) {
        if (!known.has(segment)) {
          offenders.add(`${file} → /${segment}/…`);
        }
      }
    }

    expect(
      [...offenders],
      'Забыли добавить префикс в web/src/lib/api-prefixes.ts (иначе Vite отдаст SPA-fallback)',
    ).toEqual([]);
  });

  it('сканируются все исходники lib, включая файлы с вызовом fetch(', () => {
    const sources = readLibSources();
    const withFetch = [...sources.entries()]
      .filter(([, source]) => source.includes('fetch('))
      .map(([file]) => file);

    // Регрессия: если glob перестанет матчить (или файлы переедут), тест
    // «все пути» станет пустым и ложно зелёным.
    expect(sources.size).toBeGreaterThan(5);
    expect(sources.has('./api.ts')).toBe(true);
    expect(withFetch).toContain('./api.ts');
    expect(withFetch).toContain('./run-stream.ts');
  });

  it('извлечение сегмента корректно на API, служебных и внешних путях', () => {
    const known = knownPrefixes();

    expect(extractSegments("await fetch('/llm/models')")).toEqual(['llm']);
    expect(extractSegments('requestAsync(`/runs/${runId}/stream`)')).toEqual([
      'runs',
    ]);
    expect(extractSegments("requestAsync<unknown>('/workflow')")).toEqual([
      'workflow',
    ]);
    expect(extractSegments("fetch('/index.html')")).toEqual([]);
    expect(extractSegments("href = '/favicon.ico'")).toEqual([]);
    expect(extractSegments("fetch('https://example.com/llm/models')")).toEqual(
      [],
    );
    expect(extractSegments("import { x } from './api'")).toEqual([]);
    expect(known.has('llm')).toBe(true);
    expect(known.has('unknown')).toBe(false);
  });

  it('/runs помечен sse: true, /workflow помечен htmlFallback: true', () => {
    const byPrefix = new Map(
      API_PREFIXES.map((entry) => [entry.prefix, entry]),
    );

    expect(byPrefix.get('runs')?.sse).toBe(true);
    expect(byPrefix.get('workflow')?.htmlFallback).toBe(true);
    expect(
      API_PREFIXES.filter((entry) => entry.sse).map((entry) => entry.prefix),
    ).toContain('runs');
    expect(
      API_PREFIXES.filter((entry) => entry.htmlFallback).map(
        (entry) => entry.prefix,
      ),
    ).toContain('workflow');
  });

  it('vite.config.ts генерирует proxy из реестра, а не перечисляет ключи вручную', () => {
    const source = readViteConfigSource();

    expect(source).not.toBe('');
    expect(source).toMatch(/from '\.\/src\/lib\/api-prefixes(\.ts)?'/);
    expect(source).toMatch(/proxy:\s*buildProxy\(\)/);
    expect(source).not.toMatch(
      /['"]\/(auth|engine|llm|media|nodes|runs|templates|workflow)['"]\s*:/,
    );
  });
});
