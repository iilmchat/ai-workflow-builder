import { describe, expect, it } from 'vitest';
import {
  MAX_TOKENS_LIMIT,
  validateMaxTokensOverride,
  validateReasoningEffort,
} from './llm-node-fields';

describe('validateReasoningEffort (R6.3.2)', () => {
  it('принимает три поддерживаемых режима', () => {
    expect(validateReasoningEffort('off')).toBe('off');
    expect(validateReasoningEffort('medium')).toBe('medium');
    expect(validateReasoningEffort('high')).toBe('high');
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
