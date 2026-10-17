import { describe, expect, it } from 'vitest';
import {
  CONDITION_MODES,
  CONDITION_OPERATORS,
  validateConditionMode,
  validateConditionOperator,
} from './condition-node-fields';

describe('validateConditionOperator (R6.5.2)', () => {
  it('принимает шесть операций MVP-DSL', () => {
    expect([...CONDITION_OPERATORS]).toEqual(['>', '<', '>=', '<=', '===', 'includes']);
    expect(validateConditionOperator('>')).toBe('>');
    expect(validateConditionOperator('includes')).toBe('includes');
  });

  it('неизвестную операцию заменяет на ===', () => {
    expect(validateConditionOperator('!=')).toBe('===');
    expect(validateConditionOperator('==')).toBe('===');
    expect(validateConditionOperator(undefined)).toBe('===');
    expect(validateConditionOperator(1)).toBe('===');
  });
});

describe('validateConditionMode (R7.5)', () => {
  it('принимает dsl и sandbox', () => {
    expect([...CONDITION_MODES]).toEqual(['dsl', 'sandbox']);
    expect(validateConditionMode('dsl')).toBe('dsl');
    expect(validateConditionMode('sandbox')).toBe('sandbox');
  });

  it('неизвестный режим заменяет на dsl (backward compat)', () => {
    expect(validateConditionMode('wasm')).toBe('dsl');
    expect(validateConditionMode(undefined)).toBe('dsl');
    expect(validateConditionMode(null)).toBe('dsl');
  });
});
