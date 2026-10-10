import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorCode } from '@atlasguard/shared';

/** An error with a stable machine-readable code, rendered as `{ success: false, error }`. */
export class AppException extends HttpException {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    status: HttpStatus,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }

  static notFound(what: string): AppException {
    return new AppException('NOT_FOUND', `${what} was not found.`, HttpStatus.NOT_FOUND);
  }

  static forbidden(message = 'You do not have permission to perform this action.'): AppException {
    return new AppException('FORBIDDEN', message, HttpStatus.FORBIDDEN);
  }

  static validation(message: string, details?: unknown): AppException {
    return new AppException('VALIDATION_ERROR', message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }

  static conflict(message: string): AppException {
    return new AppException('CONFLICT', message, HttpStatus.CONFLICT);
  }
}
