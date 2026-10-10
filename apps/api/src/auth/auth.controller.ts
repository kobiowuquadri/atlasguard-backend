import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, Public } from '../common/decorators';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { LoginDto, RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Create an account and start a dashboard session (HTTP-only cookie).' })
  async register(@Body() dto: RegisterDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const { user, session } = await this.auth.register(dto, req.headers['user-agent']);
    this.setCookie(res, session.token, session.expiresAt);
    return { user };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in and start a dashboard session (HTTP-only cookie).' })
  async login(@Body() dto: LoginDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const { user, session } = await this.auth.login(dto, req.headers['user-agent']);
    this.setCookie(res, session.token, session.expiresAt);
    return { user };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'End the current dashboard session.' })
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const token: unknown = req.cookies?.[this.config.SESSION_COOKIE_NAME];
    if (typeof token === 'string' && token) await this.sessions.revoke(token);
    res.clearCookie(this.config.SESSION_COOKIE_NAME, this.cookieOptions());
    return { loggedOut: true };
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'The authenticated user (session or API key).' })
  async me(@Auth() auth: AuthContext) {
    return { user: await this.auth.me(auth.user.id), authMethod: auth.method, apiKeyProjectId: auth.apiKeyProjectId ?? null };
  }

  private cookieOptions() {
    return { httpOnly: true, secure: this.config.COOKIE_SECURE, sameSite: 'lax' as const, path: '/' };
  }

  private setCookie(res: Response, token: string, expiresAt: Date) {
    res.cookie(this.config.SESSION_COOKIE_NAME, token, { ...this.cookieOptions(), expires: expiresAt });
  }
}
