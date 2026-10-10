import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { User } from '@prisma/client';
import { AppException } from '../common/app-exception';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import type { LoginDto, RegisterDto } from './auth.dto';
import { SessionService } from './session.service';

/** OWASP-recommended argon2id parameters (19 MiB, 2 iterations, 1 lane). */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: User['role'];
  onboardedAt: Date | null;
  createdAt: Date;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    onboardedAt: user.onboardedAt,
    createdAt: user.createdAt,
  };
}

@Injectable()
export class AuthService {
  /** Hash verified when an email is unknown, so response time does not reveal accounts. */
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async register(dto: RegisterDto, userAgent?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw AppException.conflict('An account with this email already exists.');
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash: await hash(dto.password, ARGON2_OPTIONS),
        role: this.config.ADMIN_EMAILS.includes(dto.email) ? 'ADMIN' : 'DEVELOPER',
      },
    });
    const session = await this.sessions.create(user.id, userAgent);
    return { user: toPublicUser(user), session };
  }

  async login(dto: LoginDto, userAgent?: string) {
    let user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      this.dummyHash ??= hash('atlasguard-timing-equaliser', ARGON2_OPTIONS);
      await verify(await this.dummyHash, dto.password).catch(() => false);
      throw this.invalidCredentials();
    }
    const valid = await verify(user.passwordHash, dto.password).catch(() => false);
    if (!valid) throw this.invalidCredentials();

    if (user.role !== 'ADMIN' && this.config.ADMIN_EMAILS.includes(user.email)) {
      user = await this.prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    }
    const session = await this.sessions.create(user.id, userAgent);
    return { user: toPublicUser(user), session };
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppException('UNAUTHENTICATED', 'Your account no longer exists.', HttpStatus.UNAUTHORIZED);
    return toPublicUser(user);
  }

  private invalidCredentials(): AppException {
    return new AppException('INVALID_CREDENTIALS', 'Incorrect email or password.', HttpStatus.UNAUTHORIZED);
  }
}
