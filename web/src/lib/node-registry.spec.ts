import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import ru from '@/i18n/ru.json';
import { canInsertOnEdge, isNodeType, NODE_REGISTRY, NODE_TYPES } from './node-registry';
import type { NodeType } from '@/types/graph';

/**
 * Заглушка i18n: настоящий модуль на импорте пишет `document.documentElement.lang`
 * (см. `@/i18n`), а тесты идут в `environment: 'node'` — без jsdom (KI-155).
 *
 * `vi.mock` поднимается к началу файла, поэтому реальный модуль не выполняется
 * и при импорте реестра (он резолвит подписи через глобальный i18next).
 */
vi.mock('@/i18n', () => {
  const t = (key: string): string => key;

  return { default: { t, language: 'ru' }, setLanguage: () => undefined };
});

/** Типы, добавленные в R6.5.2 (KI-105, DESIGN v0.8 § 8). */
const NEW_TYPES = ['http', 'condition', 'output', 'compare'] as const;

/** Все типы реестра — для проверки labelKey в обоих i18n-файлах. */
const ALL_TYPES: readonly NodeType[] = [...NODE_TYPES];

describe('NODE_REGISTRY — четыре типа R6.5.2', () => {
  it('все четыре типа зарегистрированы, реестр покрывает NodeType целиком', () => {
    expect(ALL_TYPES).toHaveLength(8);
    expect(ALL_TYPES).toEqual(
      expect.arrayContaining(['text', 'llm', 'image_generation', 'comment', ...NEW_TYPES]),
    );
  });

  it('категории соответствуют KI-127/KI-130', () => {
    expect(NODE_REGISTRY.http.category).toBe('tools');
    expect(NODE_REGISTRY.condition.category).toBe('tools');
    expect(NODE_REGISTRY.output.category).toBe('output');
    expect(NODE_REGISTRY.compare.category).toBe('ai');
  });

  it('иконки и компоненты заданы: тип можно показать в каталоге', () => {
    for (const type of NEW_TYPES) {
      expect(NODE_REGISTRY[type].icon, `иконка ${type}`).not.toBe('');
      expect(typeof NODE_REGISTRY[type].component, `компонент ${type}`).toBe('function');
    }
  });

  it('labelKey каждого типа есть и в ru.json, и в en.json (RULES 1.14)', () => {
    for (const type of ALL_TYPES) {
      const key = NODE_REGISTRY[type].labelKey;

      expect(ru, `ru: ${key}`).toHaveProperty([key]);
      expect(en, `en: ${key}`).toHaveProperty([key]);
    }
  });

  it('вставка в связь разрешена только там, где есть входной порт (KI-259)', () => {
    // R6.5.2: у всех четырёх узлов есть target-хендл.
    for (const type of NEW_TYPES) {
      expect(NODE_REGISTRY[type].canBeInsertedOnEdge, type).toBe(true);
      expect(canInsertOnEdge(type), type).toBe(true);
    }

    // Text и comment вставлять в связь нельзя — входных портов у них нет.
    expect(canInsertOnEdge('text')).toBe(false);
    expect(canInsertOnEdge('comment')).toBe(false);
  });

  it('isNodeType узнаёт новые типы и отвергает неизвестные', () => {
    for (const type of NEW_TYPES) {
      expect(isNodeType(type), type).toBe(true);
    }

    // `note` из DESIGN § 8.4 отдельным типом не заводится — он `comment`.
    expect(isNodeType('note')).toBe(false);
    expect(isNodeType('')).toBe(false);
  });

  it('capabilities: пользовательская конфигурация только у http', () => {
    expect(NODE_REGISTRY.http.capabilities).toEqual({
      externalState: false,
      userConfig: true,
    });

    for (const type of ['condition', 'output', 'compare'] as const) {
      expect(NODE_REGISTRY[type].capabilities, type).toEqual({
        externalState: false,
        userConfig: false,
      });
    }
  });
});
