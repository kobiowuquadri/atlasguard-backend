import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { AuthContext } from '../common/auth-context';
import { Auth, SessionOnly } from '../common/decorators';
import { ApiKeysService } from './api-keys.service';

export class CreateApiKeyDto {
  /** A label to recognise the key, e.g. "CI pipeline". */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  /** Restrict the key to one project (recommended). */
  @IsOptional()
  @IsUUID()
  projectId?: string;
}

@ApiTags('API keys')
@ApiCookieAuth()
@SessionOnly()
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Post()
  @ApiOperation({ summary: 'Create an API key. The plaintext key is returned once and never again.' })
  create(@Auth() auth: AuthContext, @Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(auth, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List your API keys (prefixes only).' })
  list(@Auth() auth: AuthContext) {
    return this.apiKeys.list(auth);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key.' })
  revoke(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.apiKeys.revoke(auth, id);
  }
}
