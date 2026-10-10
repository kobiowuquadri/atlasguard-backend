import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import type { AppRequest, AuthContext } from './auth-context';

export const IS_PUBLIC = 'atlasguard:isPublic';
export const SESSION_ONLY = 'atlasguard:sessionOnly';
export const ROLES = 'atlasguard:roles';
export const RAW_RESPONSE = 'atlasguard:rawResponse';

/** Route does not require authentication (the caller is still identified when possible). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route requires a dashboard session; API keys are rejected. */
export const SessionOnly = () => SetMetadata(SESSION_ONLY, true);

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

/** Response is sent as-is (file downloads), without the `{ success, data }` envelope. */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<AppRequest>().auth;
  if (!auth) throw new Error('Auth() used on a route without authentication');
  return auth;
});
