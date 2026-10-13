import { z } from 'zod';
import { CreateRunSchema } from './create-run.dto.js';

/** Валидный uuid для позитивных проверок. */
const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('CreateRunSchema', () => {
  it('принимает валидный uuid', () => {
    const parsed = CreateRunSchema.parse({ workflowId: VALID_UUID });

    expect(parsed).toEqual({ workflowId: VALID_UUID });
  });

  it('бросает ZodError на невалидный uuid', () => {
    expect(() => CreateRunSchema.parse({ workflowId: 'not-a-uuid' })).toThrow(z.ZodError);
  });

  it('бросает ZodError, если workflowId отсутствует', () => {
    expect(() => CreateRunSchema.parse({})).toThrow(z.ZodError);
  });
});
