import { Body, Controller, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { toPublicUser } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { Auth, SessionOnly } from '../common/decorators';
import { PrismaService } from '../database/prisma.service';

export class UpdateProfileDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;
}

@ApiTags('Users')
@ApiCookieAuth()
@SessionOnly()
@Controller('users/me')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Patch()
  @ApiOperation({ summary: 'Update your profile.' })
  async update(@Auth() auth: AuthContext, @Body() dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({ where: { id: auth.user.id }, data: { name: dto.name } });
    return { user: toPublicUser(user) };
  }

  @Post('onboarding-complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark first-run onboarding as completed.' })
  async completeOnboarding(@Auth() auth: AuthContext) {
    const user = await this.prisma.user.update({ where: { id: auth.user.id }, data: { onboardedAt: new Date() } });
    return { user: toPublicUser(user) };
  }
}
