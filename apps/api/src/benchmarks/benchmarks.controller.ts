import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthContext } from '../common/auth-context';
import { Auth, RawResponse } from '../common/decorators';
import { ImportBenchmarkDto, ListBenchmarksQueryDto, ListCasesQueryDto, ReviewCaseDto } from './benchmarks.dto';
import { BenchmarksService } from './benchmarks.service';

@ApiTags('Benchmarks')
@ApiCookieAuth()
@ApiBearerAuth()
@Controller('benchmarks')
export class BenchmarksController {
  constructor(private readonly benchmarks: BenchmarksService) {}

  @Get()
  @ApiOperation({ summary: 'List benchmark suites you can use (official, public and your own).' })
  list(@Auth() auth: AuthContext, @Query() query: ListBenchmarksQueryDto) {
    return this.benchmarks.list(auth, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a private benchmark suite from a dataset (AtlasGuard format v1).' })
  @ApiBody({ description: 'Benchmark dataset JSON (see packages/benchmarks/schemas).', schema: { type: 'object' } })
  create(@Auth() auth: AuthContext, @Body() dataset: Record<string, unknown>) {
    return this.benchmarks.import(auth, { dataset });
  }

  @Post('import')
  @ApiOperation({ summary: 'Validate and import a dataset. Use dryRun to validate without saving.' })
  import(@Auth() auth: AuthContext, @Body() dto: ImportBenchmarkDto) {
    return this.benchmarks.import(auth, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Suite details, statistics and semantic groups.' })
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.benchmarks.get(auth, id);
  }

  @Get(':id/cases')
  @ApiOperation({ summary: 'Benchmark cases with their reference facts. Filter by language, category or review status.' })
  cases(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query() query: ListCasesQueryDto) {
    return this.benchmarks.listCases(auth, id, query);
  }

  @Get(':id/export')
  @RawResponse()
  @ApiOperation({ summary: 'Download the suite as an importable dataset JSON file.' })
  async export(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { suite, dataset } = await this.benchmarks.export(auth, id);
    res
      .status(200)
      .setHeader('Content-Type', 'application/json; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${suite.slug}-v${suite.version}.json"`)
      .send(`${JSON.stringify(dataset, null, 2)}\n`);
  }

  @Patch(':id/cases/:caseId/review')
  @ApiOperation({
    summary: 'Record a content review. Verifying requires attestation that the reviewer is fluent in the case language.',
  })
  review(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: ReviewCaseDto,
  ) {
    return this.benchmarks.reviewCase(auth, id, caseId, dto);
  }
}
