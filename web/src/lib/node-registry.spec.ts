import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import ru from '@/i18n/ru.json';
import { canInsertOnEdge, isNodeType, NODE_REGISTRY, NODE_TYPES } from './node-registry';
import { NODE_CATEGORIES, type NodeType } from '@/types/graph';

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

/** Тип, добавленный в R6.7 (KI-200, DESIGN v0.8 § 5). */
const SUB_WORKFLOW_TYPE = 'sub_workflow' as const;

/** Тип, добавленный в R7.1 (KI-196, DESIGN v0.9 § 3.1). */
const IMAGE_TOOL_TYPE = 'image_tool' as const;

/** Все типы реестра — для проверки labelKey в обоих i18n-файлах. */
const ALL_TYPES: readonly NodeType[] = [...NODE_TYPES];

describe('NODE_REGISTRY — четыре типа R6.5.2', () => {
  it('все четыре типа зарегистрированы, реестр покрывает NodeType целиком', () => {
    // R6.7: типов стало девять (+sub_workflow); R7.1 — десять (+image_tool).
    expect(ALL_TYPES).toHaveLength(10);
    expect(ALL_TYPES).toEqual(
      expect.arrayContaining([
        'text',
        'llm',
        'image_generation',
        ...NEW_TYPES,
        SUB_WORKFLOW_TYPE,
        IMAGE_TOOL_TYPE,
      ]),
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

  it('R6.7: sub_workflow — отдельная категория «Композиция» (DESIGN § 5.4)', () => {
    expect(NODE_REGISTRY.sub_workflow.category).toBe('composition');
    expect(NODE_CATEGORIES).toContain('composition');
    expect(NODE_REGISTRY.sub_workflow.icon).toBe('🧩');
    expect(typeof NODE_REGISTRY.sub_workflow.component).toBe('function');
    // Вход `text-input` есть — узел вставляется в связь (KI-259).
    expect(canInsertOnEdge(SUB_WORKFLOW_TYPE)).toBe(true);
    // Подграф выбирают до запуска; внешнего состояния узел не держит.
    expect(NODE_REGISTRY.sub_workflow.capabilities).toEqual({
      externalState: false,
      userConfig: true,
    });
  });

  it('R6.7: isNodeType узнаёт sub_workflow, а label есть в обоих i18n', () => {
    expect(isNodeType(SUB_WORKFLOW_TYPE)).toBe(true);

    const key = NODE_REGISTRY.sub_workflow.labelKey;

    expect(ru, `ru: ${key}`).toHaveProperty([key]);
    expect(en, `en: ${key}`).toHaveProperty([key]);
    // Ключ категории — иначе секция каталога показала бы сырой ключ.
    expect(ru).toHaveProperty(['catalog.category.composition']);
    expect(en).toHaveProperty(['catalog.category.composition']);
  });

  it('R7.1: image_tool — категория «Медиа-инструменты» и ключи в обоих i18n', () => {
    expect(NODE_REGISTRY.image_tool.category).toBe('media_tools');
    expect(NODE_CATEGORIES).toContain('media_tools');
    expect(typeof NODE_REGISTRY.image_tool.component).toBe('function');
    // Входной порт есть — узел вставляется в связь (KI-259).
    expect(canInsertOnEdge(IMAGE_TOOL_TYPE)).toBe(true);
    expect(isNodeType(IMAGE_TOOL_TYPE)).toBe(true);
    // До запуска выбираются операция и модель.
    expect(NODE_REGISTRY.image_tool.capabilities).toEqual({
      externalState: false,
      userConfig: true,
    });

    const key = NODE_REGISTRY.image_tool.labelKey;

    expect(ru, `ru: ${key}`).toHaveProperty([key]);
    expect(en, `en: ${key}`).toHaveProperty([key]);
    // Ключ категории — иначе секция каталога показала бы сырой ключ.
    expect(ru).toHaveProperty(['catalog.category.media_tools']);
    expect(en).toHaveProperty(['catalog.category.media_tools']);
  });
});
