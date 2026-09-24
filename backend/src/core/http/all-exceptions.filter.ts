import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { stripUrlCredentials } from '../logging/redact';
import { AppException, type ErrorBody } from './app.exception';

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  502: 'UPSTREAM_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

/** Converts every thrown error into the single ErrorBody shape. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: string }>();
    const response = http.getResponse<Response>();

    const { status, body } = this.toBody(exception);
    body.error.requestId = request.id;

    if (status >= 500) {
      this.logger.error(
        { err: describeError(exception), requestId: request.id, path: request.url },
        'Unhandled error',
      );
    }

    response.status(status).json(body);
  }

  private toBody(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            ...(exception.fields?.length ? { fields: exception.fields } : {}),
          },
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = DEFAULT_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
      // Nest's own 4xx messages are safe to show; 5xx details are not.
      const message =
        status >= 500 ? 'Something went wrong on our side. Try again.' : exception.message;
      return { status, body: { error: { code, message } } };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Try again.' },
      },
    };
  }
}

/** Error details for the server log, with any URL credentials removed. */
function describeError(exception: unknown): { type: string; message: string; stack?: string } {
  if (exception instanceof Error) {
    return {
      type: exception.name,
      message: stripUrlCredentials(exception.message),
      stack: exception.stack ? stripUrlCredentials(exception.stack) : undefined,
    };
  }
  return { type: typeof exception, message: stripUrlCredentials(String(exception)) };
}
