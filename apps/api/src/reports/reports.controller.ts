import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { Response } from 'express';
import type { AuthContext } from '../common/auth-context';
import { Auth, RawResponse } from '../common/decorators';
import { ReportsService } from './reports.service';

export class ExportQueryDto {
  @IsOptional()
  @IsIn(['json', 'csv', 'markdown'])
  format?: 'json' | 'csv' | 'markdown';
}

export class CompareQueryDto {
  @IsUUID()
  baseRunId: string;

  @IsUUID()
  targetRunId: string;
}

@ApiTags('Reports')
@ApiCookieAuth()
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('compare')
  @ApiOperation({ summary: 'Compare two runs of the same benchmark suite.' })
  compare(@Auth() auth: AuthContext, @Query() query: CompareQueryDto) {
    return this.reports.compare(auth, query.baseRunId, query.targetRunId);
  }

  @Get(':runId')
  @ApiOperation({ summary: 'Structured evaluation report built from stored records.' })
  get(@Auth() auth: AuthContext, @Param('runId', ParseUUIDPipe) runId: string) {
    return this.reports.build(auth, runId);
  }

  @Get(':runId/export')
  @RawResponse()
  @ApiQuery({ name: 'format', enum: ['json', 'csv', 'markdown'], required: false })
  @ApiOperation({ summary: 'Download the report as JSON, CSV or Markdown.' })
  async export(
    @Auth() auth: AuthContext,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query() query: ExportQueryDto,
    @Res() res: Response,
  ) {
    const file = await this.reports.export(auth, runId, query.format ?? 'json');
    res
      .status(200)
      .setHeader('Content-Type', file.contentType)
      .setHeader('Content-Disposition', `attachment; filename="${file.filename}"`)
      .send(file.body);
  }

  @Get(':runId/evidence')
  @ApiOperation({ summary: 'N-ATLaS integration evidence bundle (completed, non-simulated runs only).' })
  evidence(@Auth() auth: AuthContext, @Param('runId', ParseUUIDPipe) runId: string) {
    return this.reports.evidence(auth, runId);
  }
}
