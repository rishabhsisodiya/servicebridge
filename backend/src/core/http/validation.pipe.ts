import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { type FieldError, validationFailed } from './app.exception';

/** Flattens nested class-validator errors into `a.b.c` field paths. */
export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

/** Strict by default: unknown properties are rejected, not silently dropped. */
export const createValidationPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) => validationFailed(flattenValidationErrors(errors)),
  });
