import { describe, expect, it } from 'vitest';
import { CONDITION_OPERATORS, validateConditionOperator } from './condition-node-fields';

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
