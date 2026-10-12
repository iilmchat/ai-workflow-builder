import {
  BadRequestException,
  Injectable,
  Logger,
  PipeTransform,
} from '@nestjs/common';
import { z } from 'zod';

/**
 * Плоское представление ошибок Zod: ошибки по конкретным полям (paths) и
 * ошибки уровня всего объекта (например, нераспознанный ключ).
 */
type ZodIssues = ReturnType<typeof z.flattenError>;

/** Тело ответа 400 Bad Request с деталями валидации. */
export interface ZodValidationErrorBody {
  statusCode: number;
  error: string;
  message: string;
  validation: ZodIssues;
}

/**
 * Пайп валидации значения по Zod-схеме.
 *
 * Применяется к body / query / param: `@Body(new ZodValidationPipe(Schema))`.
 * После успешной валидации в handler попадает уже распарсенное значение
 * (применяются `.default()`, `.transform()` и приведение типов), поэтому
 * повторно вызывать `.parse()` внутри сервиса не нужно.
 *
 * @example
 * ```ts
 * @Post()
 * create(@Body(ZodValidationPipe.create(CreateWorkflowSchema)) dto: CreateWorkflowDto) {}
 * ```
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  private static readonly logger = new Logger(ZodValidationPipe.name);

  constructor(private readonly schema: z.ZodType) {}

  /**
   * Удобная фабрика для использования прямо в декораторах:
   * `@Body(ZodValidationPipe.create(Schema))`.
   *
   * @param schema - Zod-схема, по которой валидируется значение
   */
  static create(schema: z.ZodType): ZodValidationPipe {
    return new ZodValidationPipe(schema);
  }

  /**
   * Валидирует входящее значение по схеме.
   *
   * @param value - значение из body / query / param
   * @returns распарсенное значение (с применёнными default/transform)
   * @throws BadRequestException если значение не соответствует схеме
   */
  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);

    if (result.success) {
      return result.data;
    }

    const validation = z.flattenError(result.error);
    const issues = [...validation.formErrors, ...Object.values(validation.fieldErrors).flat()];

    ZodValidationPipe.logger.debug(
      `Zod validation failed: ${JSON.stringify(validation)}`,
    );

    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: issues.length > 0 ? issues.join('; ') : z.prettifyError(result.error),
      validation,
    } satisfies ZodValidationErrorBody);
  }
}
