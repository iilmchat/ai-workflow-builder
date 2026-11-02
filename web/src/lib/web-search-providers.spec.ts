/**
 * Паритет контракта web-search backend ↔ web (v0.15 S3).
 *
 * Имена провайдеров и карты возможностей продублированы в двух независимых
 * пакетах: `src/web-search/web-search.interface.ts` (backend: env-схема,
 * Zod-схема узла, реестр, capability-гейт исполнителя) и
 * `web/src/types/graph.ts` (фронтенд: типы узла и селекты). Без паритет-теста
 * список можно добавить с одной стороны — UI либо предложит провайдера,
 * который не скомпилируется на backend, либо спрячет поддерживаемую настройку.
 *
 * Backend-исходник читается из тестового бандла как текст (`import.meta.glob`
 * с `?raw`) — так же, как `api-contract.spec.ts` читает JSON-контракт.
 */
import { describe, expect, it } from 'vitest';
import {
  WEB_SEARCH_DEPTH_PROVIDERS,
  WEB_SEARCH_FRESHNESS_PROVIDERS,
  WEB_SEARCH_PROVIDER_NAMES,
} from '@/types/graph';

/** Путь к backend-константам (в сообщениях об ошибке). */
const BACKEND_INTERFACE = 'src/web-search/web-search.interface.ts';

/** Кэш backend-исходника: файл читается один раз на spec. */
let backendSourceCache: string | null = null;

/**
 * Читает текст backend-исходника из тестового бандла.
 *
 * @returns содержимое `web-search.interface.ts`
 * @throws Error если glob не нашёл файл
 */
function readBackendSource(): string {
  if (backendSourceCache !== null) {
    return backendSourceCache;
  }

  const modules = import.meta.glob(
    '../../../src/web-search/web-search.interface.ts',
    { query: '?raw', import: 'default', eager: true },
  ) as Record<string, unknown>;
  const source = Object.values(modules)[0];

  if (typeof source !== 'string' || source.length === 0) {
    throw new Error(
      `Не прочитан ${BACKEND_INTERFACE}: проверь pattern import.meta.glob в этом spec'е`,
    );
  }

  backendSourceCache = source;

  return source;
}

/**
 * Достаёт значение backend-константы-массива строк.
 *
 * @param constName - имя экспортируемой константы
 * @returns строковые элементы массива в порядке объявления
 * @throws Error если константа не найдена
 */
function readBackendList(constName: string): string[] {
  const pattern = new RegExp(
    `export const ${constName}[^=]*=\\s*\\[([^\\]]*)\\]`,
  );
  const match = pattern.exec(readBackendSource());

  if (match === null) {
    throw new Error(
      `${BACKEND_INTERFACE}: не найдена константа ${constName}`,
    );
  }

  return [...match[1].matchAll(/'([a-z]+)'/g)].map((item) => item[1]);
}

describe('web-search контракт: паритет web ↔ backend (v0.15 S3)', () => {
  it('список провайдеров совпадает с backend', () => {
    expect([...WEB_SEARCH_PROVIDER_NAMES]).toEqual(
      readBackendList('WEB_SEARCH_PROVIDER_NAMES'),
    );
  });

  it('карта глубины поиска совпадает с backend (KI-546)', () => {
    expect([...WEB_SEARCH_DEPTH_PROVIDERS]).toEqual(
      readBackendList('WEB_SEARCH_DEPTH_PROVIDERS'),
    );
  });

  it('карта свежести совпадает с backend', () => {
    expect([...WEB_SEARCH_FRESHNESS_PROVIDERS]).toEqual(
      readBackendList('WEB_SEARCH_FRESHNESS_PROVIDERS'),
    );
  });

  it('парсер не пропускает пустой список (негативная проверка)', () => {
    expect(readBackendList('WEB_SEARCH_PROVIDER_NAMES').length).toBeGreaterThan(
      0,
    );
    expect(() => readBackendList('НЕТ_ТАКОЙ_КОНСТАНТЫ')).toThrow();
  });
});
