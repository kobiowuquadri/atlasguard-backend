import { Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../common/auth-context';
import { randomToken, sha256 } from '../common/crypto';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PrismaService } from '../database/prisma.service';

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Opaque server-side sessions. Only a SHA-256 of the token is stored. */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get ttlMs(): number {
    return this.config.SESSION_TTL_HOURS * 60 * 60 * 1000;
  }

  async create(userId: string, userAgent?: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await this.prisma.session.create({
      data: { userId, tokenHash: sha256(token), expiresAt, userAgent: userAgent?.slice(0, 300) },
    });
    return { token, expiresAt };
  }

  async validate(token: string): Promise<AuthContext | null> {
    if (token.length > 200) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { id: true, email: true, name: true, role: true } } },
    });
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }
    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    }
    return { user: session.user, method: 'session', sessionId: session.id };
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  }
}
