import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { AppRequest } from './auth-context';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/** Accepts a well-formed incoming X-Request-Id or generates one, and echoes it back. */
export function requestIdMiddleware(req: AppRequest, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}

const logger = new Logger('HTTP');

/**
 * Structured access log. Deliberately records only method, path (no query string),
 * status, duration and ids — never headers, cookies, bodies or API keys.
 */
export function requestLogMiddleware(req: AppRequest, res: Response, next: NextFunction): void {
  const started = performance.now();
  res.on('finish', () => {
    const entry = {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(performance.now() - started),
      userId: req.auth?.user.id,
      auth: req.auth?.method,
    };
    if (res.statusCode >= 500) logger.error(JSON.stringify(entry));
    else if (res.statusCode >= 400) logger.warn(JSON.stringify(entry));
    else logger.log(JSON.stringify(entry));
  });
  next();
}
