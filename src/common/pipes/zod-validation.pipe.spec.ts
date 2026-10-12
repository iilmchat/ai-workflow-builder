import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  it('возвращает распарсенное значение', () => {
    const pipe = new ZodValidationPipe(
      z.object({ name: z.string().min(1), nodes: z.array(z.unknown()).default([]) }),
    );

    expect(pipe.transform({ name: 'ok' })).toEqual({ name: 'ok', nodes: [] });
  });

  it('применяет default и приведение типов', () => {
    const pipe = new ZodValidationPipe(
      z.object({ limit: z.coerce.number().int().default(50) }),
    );

    expect(pipe.transform({ limit: '10' })).toEqual({ limit: 10 });
    expect(pipe.transform({})).toEqual({ limit: 50 });
  });

  it('бросает BadRequestException с flatten() из ZodError', () => {
    const pipe = new ZodValidationPipe(
      z.object({ name: z.string().min(3, 'name слишком короткий') }),
    );

    let caught: unknown;

    try {
      pipe.transform({ name: 'ab' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadRequestException);

    const body = (caught as BadRequestException).getResponse() as {
      statusCode: number;
      message: string;
      validation: {
        formErrors: string[];
        fieldErrors: Record<string, string[] | undefined>;
      };
    };

    expect(body.statusCode).toBe(400);
    expect(body.validation.fieldErrors.name).toContain('name слишком короткий');
    expect(body.message).toContain('name слишком короткий');
  });

  it('сообщает об ошибке уровня всего объекта (refine)', () => {
    const pipe = new ZodValidationPipe(
      z
        .object({ name: z.string().optional() })
        .refine((data) => Object.keys(data).length > 0, {
          message: 'Не передано ни одного поля для обновления',
        }),
    );

    let caught: unknown;

    try {
      pipe.transform({});
    } catch (error) {
      caught = error;
    }

    const body = (caught as BadRequestException).getResponse() as {
      message: string;
      validation: { formErrors: string[] };
    };

    expect(body.validation.formErrors).toContain(
      'Не передано ни одного поля для обновления',
    );
    expect(body.message).toContain('Не передано ни одного поля для обновления');
  });
});
