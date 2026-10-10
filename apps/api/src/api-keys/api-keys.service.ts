import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../common/app-exception';
import type { AuthContext } from '../common/auth-context';
import { hmacSha256, randomToken } from '../common/crypto';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import { ProjectsService } from '../projects/projects.service';

const KEY_PREFIX = 'ag_';
const DISPLAY_PREFIX_LENGTH = 11;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  keyPrefix: true,
  projectId: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
  project: { select: { id: true, name: true } },
} as const;

/**
 * API keys for SDK / server-to-server access. Keys are 192-bit random secrets; only an
 * HMAC-SHA256 (peppered) is stored, and the plaintext is returned exactly once.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private hash(key: string): string {
    return hmacSha256(this.config.API_KEY_PEPPER, key);
  }

  async create(auth: AuthContext, input: { name: string; projectId?: string }) {
    if (input.projectId) await this.projects.requireProject(auth, input.projectId);
    const key = `${KEY_PREFIX}${randomToken(24)}`;
    const record = await this.prisma.apiKey.create({
      data: {
        userId: auth.user.id,
        projectId: input.projectId ?? null,
        name: input.name,
        keyPrefix: key.slice(0, DISPLAY_PREFIX_LENGTH),
        keyHash: this.hash(key),
      },
      select: PUBLIC_FIELDS,
    });
    return { apiKey: record, key };
  }

  list(auth: AuthContext) {
    return this.prisma.apiKey.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      select: PUBLIC_FIELDS,
    });
  }

  async revoke(auth: AuthContext, id: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, userId: auth.user.id } });
    if (!key) throw AppException.notFound('API key');
    if (!key.revokedAt) await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    return { id, revoked: true };
  }

  async validate(key: string): Promise<AuthContext | null> {
    if (!key.startsWith(KEY_PREFIX) || key.length > 100) return null;
    const record = await this.prisma.apiKey.findUnique({
      where: { keyHash: this.hash(key) },
      include: {
        user: { select: { id: true, email: true, name: true, role: true } },
        project: { select: { archivedAt: true } },
      },
    });
    if (!record || record.revokedAt || record.project?.archivedAt) return null;
    if (!record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    return { user: record.user, method: 'api_key', apiKeyId: record.id, apiKeyProjectId: record.projectId };
  }
}
