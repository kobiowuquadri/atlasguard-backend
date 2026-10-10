import type { UserRole } from '@prisma/client';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuthContext {
  user: AuthUser;
  method: 'session' | 'api_key';
  sessionId?: string;
  apiKeyId?: string;
  /** Project the API key is restricted to, if any. */
  apiKeyProjectId?: string | null;
}

export type AppRequest = Request & { id: string; auth?: AuthContext };
