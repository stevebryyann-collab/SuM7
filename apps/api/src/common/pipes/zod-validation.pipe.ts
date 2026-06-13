import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodError, ZodTypeAny, infer as ZodInfer } from 'zod';
import type { ApiFieldError } from '@b2b/shared';

/**
 * Validates and parses a value against a Zod schema. The codebase uses Zod (not
 * class-validator) as its single source of truth for request shapes, so this
 * pipe lets controllers reuse the shared schemas while emitting the SAME error
 * envelope as the global class-validator ValidationPipe in main.ts:
 *   { statusCode, code: 'VALIDATION_FAILED', message, errors: [{ field, message, code }] }
 *
 * Usage: `@Body(new ZodValidationPipe(UpsertMerchantSchema)) body: UpsertMerchantInput`
 */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): ZodInfer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        errors: this.flatten(result.error),
      });
    }
    return result.data;
  }

  private flatten(error: ZodError): ApiFieldError[] {
    return error.issues.map((issue) => ({
      field: issue.path.join('.') || '(root)',
      message: issue.message,
      // Zod issue codes (e.g. 'invalid_type', 'too_small') mirror the constraint
      // names class-validator surfaces, keeping the `code` field meaningful.
      code: issue.code,
    }));
  }
}
