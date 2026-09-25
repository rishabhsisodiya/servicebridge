import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../core/http/app.exception';

/** Optimistic locking: the edit must be based on the version the user read. */
export function assertVersion(current: number, sent: number, noun: string): void {
  if (current !== sent) {
    throw new AppException(
      'VERSION_CONFLICT',
      `Someone else changed this ${noun} while you were editing. Reload to see their changes.`,
      HttpStatus.CONFLICT,
    );
  }
}

export const notFound = (code: string, noun: string) =>
  new AppException(code, `That ${noun} no longer exists.`, HttpStatus.NOT_FOUND);

/** Turns a unique-constraint error into a field error; rethrows anything else. */
export function rethrowUnique(error: unknown, code: string, field: string, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppException(code, message, HttpStatus.CONFLICT, [{ field, message }]);
  }
  throw error;
}
