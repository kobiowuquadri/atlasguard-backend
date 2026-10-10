import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import type { AuthContext } from '../common/auth-context';
import { Auth } from '../common/decorators';
import { InsightsService } from './insights.service';

export class InsightsQueryDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  runId?: string;

  /** Include runs that used simulated fixtures (excluded by default). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeSimulated?: boolean;
}

@ApiTags('Insights')
@ApiCookieAuth()
@ApiBearerAuth()
@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Dashboard metrics computed from your stored evaluation records.' })
  overview(@Auth() auth: AuthContext, @Query() query: InsightsQueryDto) {
    return this.insights.overview(auth, { ...query, includeSimulated: query.includeSimulated ?? false });
  }

  @Get('languages')
  @ApiOperation({ summary: 'Per-language performance; unmeasured languages are reported as not evaluated.' })
  languages(@Auth() auth: AuthContext, @Query() query: InsightsQueryDto) {
    return this.insights.languages(auth, { ...query, includeSimulated: query.includeSimulated ?? false });
  }
}
