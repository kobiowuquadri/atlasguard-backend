import { HttpStatus, Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { AppException } from '../common/app-exception';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { IS_PUBLIC, ROLES, SESSION_ONLY } from '../common/decorators';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function extractApiKey(req: AppRequest): string | null {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim() || null;
  const apiKey = req.headers['x-api-key'];
  return typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : null;
}

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Global authentication + authorisation guard.
 * - Dashboard: opaque session token in an HTTP-only cookie.
 * - SDK / API: `Authorization: Bearer ag_…` or `X-API-Key`.
 * Cookie-authenticated state changes must come from an allowed origin (CSRF defence in
 * addition to SameSite=Lax).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly apiKeys: ApiKeysService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ?? false;

    const { auth, invalidApiKey } = await this.authenticate(req);
    if (auth) req.auth = auth;
    if (isPublic) return true;

    if (!auth) {
      throw new AppException(
        'UNAUTHENTICATED',
        invalidApiKey ? 'The API key is invalid or has been revoked.' : 'Authentication required.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (this.reflector.getAllAndOverride<boolean>(SESSION_ONLY, targets) && auth.method !== 'session') {
      throw AppException.forbidden('This action requires a dashboard session; API keys cannot perform it.');
    }
    if (auth.method === 'session' && !SAFE_METHODS.has(req.method)) this.assertTrustedOrigin(req);

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES, targets);
    if (roles?.length && !roles.includes(auth.user.role)) throw AppException.forbidden();
    return true;
  }

  private async authenticate(req: AppRequest): Promise<{ auth: AuthContext | null; invalidApiKey: boolean }> {
    const token: unknown = req.cookies?.[this.config.SESSION_COOKIE_NAME];
    if (typeof token === 'string' && token) {
      const session = await this.sessions.validate(token);
      if (session) return { auth: session, invalidApiKey: false };
    }
    const key = extractApiKey(req);
    if (key) {
      const apiKey = await this.apiKeys.validate(key);
      return { auth: apiKey, invalidApiKey: !apiKey };
    }
    return { auth: null, invalidApiKey: false };
  }

  private assertTrustedOrigin(req: AppRequest): void {
    const origin = originOf(req.headers.origin) ?? originOf(req.headers.referer);
    if (!origin) return; // non-browser clients do not send Origin
    const self = `${req.protocol}://${req.get('host')}`;
    if (origin === self || this.config.APP_ORIGINS.includes(origin)) return;
    throw AppException.forbidden('Cross-site request blocked.');
  }
}
