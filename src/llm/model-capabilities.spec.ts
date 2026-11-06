import { describe, expect, it } from 'vitest';
import {
  buildModelCapabilities,
  describeCapabilityGaps,
  isCapabilityCompatible,
  type LlmCapabilityRequirements,
} from './model-capabilities.js';
import type { ModelInfo } from './llm-provider.interface.js';

/**
 * Собирает объявление модели для теста.
 *
 * @param overrides - поля поверх минимального текстового паспорта
 * @returns объявление модели
 */
function model(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: 'model-1',
    label: 'Model 1',
    inputModalities: ['text'],
    outputModalities: ['text'],
    ...overrides,
  };
}

/**
 * Собирает требования к подмене.
 *
 * @param overrides - поля поверх «текст без ограничений»
 * @returns требования
 */
function requirements(
  overrides: Partial<LlmCapabilityRequirements> = {},
): LlmCapabilityRequirements {
  return {
    inputModalities: ['text'],
    requiresReasoning: false,
    requiresTools: false,
    minTokens: 0,
    ...overrides,
  };
}

describe('model-capabilities (v1.3 S1, KI-617)', () => {
  describe('buildModelCapabilities', () => {
    it('заполняет отсутствующие поля безопасными значениями', () => {
      expect(buildModelCapabilities('lmstudio', model())).toEqual({
        id: 'model-1',
        provider: 'lmstudio',
        inputModalities: ['text'],
        supportsReasoning: false,
        // Текстовая модель по умолчанию способна вести tool-цикл агента.
        supportsTools: true,
        maxTokens: 0,
      });
    });

    it('сохраняет явные возможности модели', () => {
      const capabilities = buildModelCapabilities(
        'openai',
        model({
          inputModalities: ['text', 'vision'],
          supportsReasoning: true,
          supportsTools: false,
          maxTokens: 128_000,
        }),
      );

      expect(capabilities).toEqual({
        id: 'model-1',
        provider: 'openai',
        inputModalities: ['text', 'vision'],
        supportsReasoning: true,
        supportsTools: false,
        maxTokens: 128_000,
      });
    });

    it('модель без текста не поддерживает tool-calling по умолчанию', () => {
      const capabilities = buildModelCapabilities(
        'media',
        model({ inputModalities: ['image-generation'] }),
      );

      expect(capabilities.supportsTools).toBe(false);
    });
  });

  describe('isCapabilityCompatible / describeCapabilityGaps', () => {
    it('совпадение модальностей — совместимо', () => {
      const candidate = buildModelCapabilities(
        'lmstudio',
        model({ inputModalities: ['text', 'vision'] }),
      );

      expect(
        isCapabilityCompatible(
          candidate,
          requirements({ inputModalities: ['text', 'vision'] }),
        ),
      ).toBe(true);
      expect(
        describeCapabilityGaps(
          candidate,
          requirements({ inputModalities: ['text', 'vision'] }),
        ),
      ).toEqual([]);
    });

    it('не хватает модальности — перечисляет её', () => {
      const candidate = buildModelCapabilities('lmstudio', model());
      const required = requirements({ inputModalities: ['text', 'vision'] });

      expect(isCapabilityCompatible(candidate, required)).toBe(false);
      expect(describeCapabilityGaps(candidate, required)).toEqual([
        'нет модальности vision',
      ]);
    });

    it('лишние модальности кандидата не мешают', () => {
      const candidate = buildModelCapabilities(
        'openai',
        model({ inputModalities: ['text', 'vision'] }),
      );

      expect(isCapabilityCompatible(candidate, requirements())).toBe(true);
    });

    it('reasoning требуется, но отсутствует', () => {
      const candidate = buildModelCapabilities('lmstudio', model());

      expect(
        describeCapabilityGaps(
          candidate,
          requirements({ requiresReasoning: true }),
        ),
      ).toEqual(['нет reasoning']);
    });

    it('tool-calling требуется, но модель его не поддерживает', () => {
      const candidate = buildModelCapabilities(
        'deepseek',
        model({ supportsTools: false }),
      );

      expect(
        describeCapabilityGaps(candidate, requirements({ requiresTools: true })),
      ).toEqual(['нет tool-calling']);
    });

    it('контекст меньше требуемого — несовместимо', () => {
      const candidate = buildModelCapabilities(
        'lmstudio',
        model({ maxTokens: 8_192 }),
      );

      expect(
        describeCapabilityGaps(candidate, requirements({ minTokens: 128_000 })),
      ).toEqual(['контекст 8192 < 128000 токенов']);
    });

    it('неизвестный контекст кандидата не блокирует подмену (KI-629)', () => {
      const candidate = buildModelCapabilities('lmstudio', model());

      expect(
        isCapabilityCompatible(candidate, requirements({ minTokens: 128_000 })),
      ).toBe(true);
    });

    it('неизвестный контекст исходной модели (minTokens=0) не блокирует', () => {
      const candidate = buildModelCapabilities(
        'lmstudio',
        model({ maxTokens: 8_192 }),
      );

      expect(isCapabilityCompatible(candidate, requirements())).toBe(true);
    });

    it('несколько несовместимостей перечисляются через запятую', () => {
      const candidate = buildModelCapabilities('lmstudio', model());
      const gaps = describeCapabilityGaps(
        candidate,
        requirements({
          inputModalities: ['text', 'vision'],
          requiresReasoning: true,
          requiresTools: false,
        }),
      );

      expect(gaps).toEqual(['нет модальности vision', 'нет reasoning']);
    });
  });
});
