import { HttpException, HttpStatus } from '@nestjs/common';

export interface FieldError {
  field: string;
  message: string;
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields?: FieldError[];
    requestId?: string;
  };
}

/**
 * Throw this for any failure the client should understand and act on.
 * `code` is a stable UPPER_SNAKE identifier the frontend can switch on;
 * `message` is plain English shown to the user.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly fields?: FieldError[],
  ) {
    super({ code, message, fields }, status);
  }
}

export const validationFailed = (fields: FieldError[]) =>
  new AppException(
    'VALIDATION_FAILED',
    'Some fields need attention.',
    HttpStatus.BAD_REQUEST,
    fields,
  );
