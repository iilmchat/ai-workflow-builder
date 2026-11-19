import { describe, expect, it } from 'vitest';
import {
  MAX_TOKENS_LIMIT,
  REASONING_EFFORTS,
  validateMaxTokensOverride,
  validateReasoningEffort,
} from './llm-node-fields';

describe('validateReasoningEffort (R6.3.2)', () => {
  it('принимает все шесть режимов backend-типа (KI-249)', () => {
    for (const effort of REASONING_EFFORTS) {
      expect(validateReasoningEffort(effort)).toBe(effort);
    }

    expect(REASONING_EFFORTS).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('отбрасывает неизвестные строки и не-строки', () => {
    expect(validateReasoningEffort('ultra')).toBeUndefined();
    expect(validateReasoningEffort('')).toBeUndefined();
    expect(validateReasoningEffort(undefined)).toBeUndefined();
    expect(validateReasoningEffort(3)).toBeUndefined();
  });
});

describe('validateMaxTokensOverride (R6.3.2)', () => {
  it('принимает положительное целое', () => {
    expect(validateMaxTokensOverride(1)).toBe(1);
    expect(validateMaxTokensOverride(2048)).toBe(2048);
    expect(validateMaxTokensOverride(MAX_TOKENS_LIMIT)).toBe(MAX_TOKENS_LIMIT);
  });

  it('отбрасывает ноль, отрицательные, дробные и не-числа', () => {
    expect(validateMaxTokensOverride(0)).toBeUndefined();
    expect(validateMaxTokensOverride(-10)).toBeUndefined();
    expect(validateMaxTokensOverride(1.5)).toBeUndefined();
    expect(validateMaxTokensOverride('2048')).toBeUndefined();
    expect(validateMaxTokensOverride(undefined)).toBeUndefined();
  });
});
