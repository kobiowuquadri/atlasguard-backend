import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import type { ApiErrorCode } from '@atlasguard/shared';
import { AppException } from './app-exception';

interface ErrorBody {
  success: false;
  error: { code: ApiErrorCode; message: string; details?: unknown; requestId?: string };
}

const STATUS_CODES: Partial<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

/**
 * Renders every error as `{ success: false, error: { code, message, requestId } }`.
 * Unexpected errors are logged with the request id and returned with a generic message,
 * so internals (SQL, stack traces, secrets) never reach clients.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id;
    const { status, body } = this.toBody(exception, requestId);

    if (status >= 500) {
      this.logger.error(
        JSON.stringify({ requestId, method: req.method, path: req.path, code: body.error.code }),
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    if (res.headersSent) return;
    res.status(status).json(body);
  }

  private toBody(exception: unknown, requestId?: string): { status: number; body: ErrorBody } {
    const make = (status: number, code: ApiErrorCode, message: string, details?: unknown) => ({
      status,
      body: { success: false as const, error: { code, message, ...(details !== undefined && { details }), requestId } },
    });

    if (exception instanceof AppException) {
      return make(exception.getStatus(), exception.code, exception.message, exception.details);
    }
    if (exception instanceof ThrottlerException) {
      return make(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Too many requests. Please slow down and try again shortly.');
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const code = STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR');
      if (typeof response === 'object' && response !== null && 'message' in response) {
        const message = (response as { message: unknown }).message;
        if (Array.isArray(message)) {
          return make(status, code, 'Request validation failed.', message);
        }
        if (typeof message === 'string') return make(status, code, message);
      }
      return make(status, code, exception.message);
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') return make(HttpStatus.CONFLICT, 'CONFLICT', 'A record with these values already exists.');
      if (exception.code === 'P2025') return make(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The requested record was not found.');
    }
    if (exception instanceof SyntaxError && 'body' in exception) {
      return make(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Request body is not valid JSON.');
    }
    if (typeof exception === 'object' && exception !== null && (exception as { type?: string }).type === 'entity.too.large') {
      return make(HttpStatus.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    }
    return make(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', 'An unexpected error occurred. Please try again.');
  }
}
