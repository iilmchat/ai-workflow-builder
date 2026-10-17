import { describe, expect, it, vi } from 'vitest';
import { NODE_REGISTRY } from './node-registry';
import {
  parseNumericInput,
  validateCollection,
  validateEmbeddingModel,
  validateMemoryKey,
  validateOptionalFieldName,
  validateScoreThreshold,
  validateTopK,
} from './vector-memory-node-fields';
import {
  DEFAULT_VECTOR_SCORE_THRESHOLD,
  DEFAULT_VECTOR_TOPK,
  EMBEDDING_MODELS,
  NODE_CATEGORIES,
  VECTOR_TOPK_LIMIT,
} from '@/types/graph';

/**
 * Заглушка i18n: настоящий модуль на импорте пишет `document.documentElement.lang`,
 * а тесты идут в `environment: 'node'` (KI-155). Тот же приём, что в
 * `node-registry.spec.ts`.
 */
vi.mock('@/i18n', () => {
  const t = (key: string): string => key;

  return { default: { t, language: 'ru' }, setLanguage: () => undefined };
});

/**
 * Юнит-тесты четырёх vector/memory-узлов (R7.4a).
 *
 * Vitest фронтенда идёт в `environment: 'node'` (KI-155): DOM и jsdom не
 * тянутся, поэтому «рендер» здесь — проверка контракта компонента (он
 * зарегистрирован как функция, его поля и i18n-ключи существуют), а логика
 * полей вынесена в `vector-memory-node-fields.ts` и проверяется напрямую.
 * Это тот же подход, что у `http-node-fields.spec.ts` (R6.5.2).
 */

describe('VectorUpsertNode (R7.4a)', () => {
  it('компонент зарегистрирован и относится к категории vector', () => {
    expect(NODE_CATEGORIES).toContain('vector');
    expect(NODE_REGISTRY.vector_upsert.category).toBe('vector');
    expect(typeof NODE_REGISTRY.vector_upsert.component).toBe('function');
    expect(NODE_REGISTRY.vector_upsert.capabilities.externalState).toBe(true);
    expect(NODE_REGISTRY.vector_upsert.canBeInsertedOnEdge).toBe(true);
  });

  it('валидирует collection: строка сохраняется, мусор — пустая строка', () => {
    expect(validateCollection('docs')).toBe('docs');
    expect(validateCollection(42)).toBe('');
    expect(validateCollection(undefined)).toBe('');
  });

  it('embeddingModel: известная модель сохраняется, крупная (3072) — дефолт', () => {
    expect(EMBEDDING_MODELS).toEqual(['text-embedding-3-small']);
    expect(validateEmbeddingModel('text-embedding-3-small')).toBe(
      'text-embedding-3-small',
    );
    // text-embedding-3-large не помещается в vector(1536) — не предлагаем.
    expect(validateEmbeddingModel('text-embedding-3-large')).toBe(
      'text-embedding-3-small',
    );
    expect(validateEmbeddingModel(null)).toBe('text-embedding-3-small');
  });

  it('contentField: пустое поле — undefined (не пишем лишний ключ)', () => {
    expect(validateOptionalFieldName('body')).toBe('body');
    expect(validateOptionalFieldName('  ')).toBeUndefined();
    expect(validateOptionalFieldName(7)).toBeUndefined();
  });
});

describe('VectorQueryNode (R7.4a)', () => {
  it('компонент зарегистрирован, дефолты соответствуют backend (5 / 0.7)', () => {
    expect(NODE_REGISTRY.vector_query.category).toBe('vector');
    expect(typeof NODE_REGISTRY.vector_query.component).toBe('function');
    expect(DEFAULT_VECTOR_TOPK).toBe(5);
    expect(DEFAULT_VECTOR_SCORE_THRESHOLD).toBe(0.7);
    expect(VECTOR_TOPK_LIMIT).toBe(100);
  });

  it('topK: принимает целое 1…100, остальное — undefined (дефолт backend)', () => {
    expect(validateTopK(1)).toBe(1);
    expect(validateTopK(5)).toBe(5);
    expect(validateTopK(VECTOR_TOPK_LIMIT)).toBe(VECTOR_TOPK_LIMIT);
    expect(validateTopK(0)).toBeUndefined();
    expect(validateTopK(101)).toBeUndefined();
    expect(validateTopK(2.5)).toBeUndefined();
    expect(validateTopK('5')).toBeUndefined();
  });

  it('scoreThreshold: принимает [-1, 1], остальное — undefined', () => {
    expect(validateScoreThreshold(-1)).toBe(-1);
    expect(validateScoreThreshold(0.7)).toBe(0.7);
    expect(validateScoreThreshold(1)).toBe(1);
    expect(validateScoreThreshold(1.5)).toBeUndefined();
    expect(validateScoreThreshold(Number.NaN)).toBeUndefined();
  });

  it('parseNumericInput: пустая строка и мусор — undefined', () => {
    expect(parseNumericInput('')).toBeUndefined();
    expect(parseNumericInput('  ')).toBeUndefined();
    expect(parseNumericInput('7')).toBe(7);
    expect(parseNumericInput('0.25')).toBe(0.25);
    expect(parseNumericInput('abc')).toBeUndefined();
  });
});

describe('MemoryReadNode (R7.4a)', () => {
  it('компонент зарегистрирован в категории state', () => {
    expect(NODE_CATEGORIES).toContain('state');
    expect(NODE_REGISTRY.memory_read.category).toBe('state');
    expect(typeof NODE_REGISTRY.memory_read.component).toBe('function');
    expect(NODE_REGISTRY.memory_read.capabilities.externalState).toBe(true);
    expect(NODE_REGISTRY.memory_read.canBeInsertedOnEdge).toBe(true);
  });

  it('key: строка сохраняется, мусор — пустая строка (Run упадёт валидацией)', () => {
    expect(validateMemoryKey('profile')).toBe('profile');
    expect(validateMemoryKey(123)).toBe('');
    expect(validateMemoryKey(undefined)).toBe('');
  });
});

describe('MemoryWriteNode (R7.4a)', () => {
  it('компонент зарегистрирован в категории state', () => {
    expect(NODE_REGISTRY.memory_write.category).toBe('state');
    expect(typeof NODE_REGISTRY.memory_write.component).toBe('function');
    expect(NODE_REGISTRY.memory_write.capabilities.externalState).toBe(true);
    expect(NODE_REGISTRY.memory_write.canBeInsertedOnEdge).toBe(true);
  });

  it('key и valueField валидируются как имена полей', () => {
    expect(validateMemoryKey('last_result')).toBe('last_result');
    expect(validateOptionalFieldName('result')).toBe('result');
    expect(validateOptionalFieldName('')).toBeUndefined();
  });

  it('обе memory-узла имеют label и i18n-ключи категории', async () => {
    // i18n-паритет проверяется отдельным спеком; здесь — что ключ не пустой
    // и что категория имеет подпись (иначе каталог показал бы сырой ключ).
    const en = (await import('@/i18n/en.json')).default;
    const ru = (await import('@/i18n/ru.json')).default;

    for (const type of ['memory_read', 'memory_write'] as const) {
      expect(en[NODE_REGISTRY[type].labelKey], type).toBeTruthy();
      expect(ru[NODE_REGISTRY[type].labelKey], type).toBeTruthy();
    }

    expect(en['catalog.category.state']).toBeTruthy();
    expect(ru['catalog.category.state']).toBeTruthy();
  });
});
