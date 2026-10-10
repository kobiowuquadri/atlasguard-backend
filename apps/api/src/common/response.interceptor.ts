import { Injectable, StreamableFile, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { RAW_RESPONSE } from './decorators';
import { Paginated } from './pagination';

/** Wraps successful responses as `{ success: true, data, meta? }`. */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [context.getHandler(), context.getClass()]);
    if (raw) return next.handle();
    return next.handle().pipe(
      map((data: unknown) => {
        if (data instanceof StreamableFile) return data;
        if (data instanceof Paginated) return { success: true, data: data.items, meta: data.meta };
        return { success: true, data: data ?? null };
      }),
    );
  }
}
