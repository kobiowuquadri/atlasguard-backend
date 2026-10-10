import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthContext } from '../common/auth-context';
import { Auth } from '../common/decorators';
import { CreateRunDto, ListResultsQueryDto, ListRunsQueryDto, ReviewResultDto } from './evaluations.dto';
import { EvaluationsService } from './evaluations.service';

@ApiTags('Evaluations')
@ApiCookieAuth()
@ApiBearerAuth()
@Controller('evaluations/runs')
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Queue an evaluation run. Cases are executed asynchronously by the worker; poll GET /evaluations/runs/:id.',
  })
  create(@Auth() auth: AuthContext, @Body() dto: CreateRunDto) {
    return this.evaluations.createRun(auth, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List evaluation runs in your projects.' })
  list(@Auth() auth: AuthContext, @Query() query: ListRunsQueryDto) {
    return this.evaluations.listRuns(auth, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Run details, progress and aggregate results.' })
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.evaluations.getRun(auth, id);
  }

  @Get(':id/results')
  @ApiOperation({ summary: 'Per-case results: prompt, actual model response, checks, latency.' })
  results(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query() query: ListResultsQueryDto) {
    return this.evaluations.listResults(auth, id, query);
  }

  @Get(':id/results/:resultId')
  @ApiOperation({ summary: 'One result with its full check details and review history.' })
  result(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('resultId', ParseUUIDPipe) resultId: string,
  ) {
    return this.evaluations.getResult(auth, id, resultId);
  }

  @Post(':id/results/:resultId/reviews')
  @ApiOperation({ summary: 'Record a human review decision (PASSED/FAILED) for a result.' })
  review(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('resultId', ParseUUIDPipe) resultId: string,
    @Body() dto: ReviewResultDto,
  ) {
    return this.evaluations.reviewResult(auth, id, resultId, dto);
  }

  @Get(':id/consistency')
  @ApiOperation({ summary: 'Cross-language consistency findings with responses side by side.' })
  consistency(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.evaluations.consistency(auth, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a queued or running evaluation.' })
  cancel(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.evaluations.cancel(auth, id);
  }

  @Post(':id/rerun')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Queue a new run with exactly the same suite, languages, filters and parameters.' })
  rerun(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.evaluations.rerun(auth, id);
  }
}
