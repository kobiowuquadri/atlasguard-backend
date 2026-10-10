import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { EvaluationRun, Prisma, Verdict } from '@prisma/client';
import { EVALUATOR_VERSION } from '@atlasguard/evaluator';
import { LANGUAGES, isSupportedLanguage } from '@atlasguard/shared';
import { snapshotCase } from '../benchmarks/case-definition';
import { BenchmarksService } from '../benchmarks/benchmarks.service';
import { AppException } from '../common/app-exception';
import type { AuthContext } from '../common/auth-context';
import { pageArgs, paginated } from '../common/pagination';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ModelConfigsService, type InferenceDefaults } from '../providers/model-configs.service';
import { ModelProviderRegistry } from '../providers/model-provider.registry';
import type { CreateRunDto, ListResultsQueryDto, ListRunsQueryDto, ReviewResultDto } from './evaluations.dto';
import { EvaluationWorker, type InferenceConfig } from './evaluation-worker.service';
import { RunAnalysisService } from './run-analysis.service';

const RUN_INCLUDE = {
  project: { select: { id: true, name: true } },
  suite: { select: { id: true, slug: true, name: true, version: true, isOfficial: true } },
  modelConfiguration: { select: { id: true, name: true, providerType: true, isSimulated: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.EvaluationRunInclude;

const LANGUAGE_ORDER = Object.keys(LANGUAGES);

@Injectable()
export class EvaluationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly benchmarks: BenchmarksService,
    private readonly modelConfigs: ModelConfigsService,
    private readonly registry: ModelProviderRegistry,
    private readonly worker: EvaluationWorker,
    private readonly analysis: RunAnalysisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Returns a run the caller can access (owner of its project; project-scoped keys restricted). */
  async requireRun(auth: AuthContext, runId: string): Promise<EvaluationRun> {
    const run = await this.prisma.evaluationRun.findFirst({
      where: {
        id: runId,
        project: { ownerId: auth.user.id },
        ...(auth.apiKeyProjectId && { projectId: auth.apiKeyProjectId }),
      },
    });
    if (!run) throw AppException.notFound('Evaluation run');
    return run;
  }

  async createRun(auth: AuthContext, dto: CreateRunDto) {
    await this.projects.requireProject(auth, dto.projectId);
    const suite = await this.benchmarks.requireVisibleSuite(auth, dto.suiteId);
    const modelConfig = await this.modelConfigs.resolve(dto.modelConfigurationId);

    const unsupported = dto.languages.filter((l) => !modelConfig.supportedLanguages.includes(l));
    if (unsupported.length > 0) {
      throw new AppException(
        'UNSUPPORTED_MODEL_CONFIGURATION',
        `This model configuration does not support: ${unsupported.join(', ')}.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const provider = this.registry.forConfiguration(modelConfig);
    const health = await this.registry.health(provider, true);
    if (health.status !== 'available') {
      throw new AppException(
        'MODEL_PROVIDER_UNAVAILABLE',
        `The ${modelConfig.isSimulated ? 'fixture provider' : 'N-ATLaS endpoint'} is not available: ${health.message}`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const cases = await this.prisma.benchmarkCase.findMany({
      where: {
        suiteId: suite.id,
        archivedAt: null,
        language: { in: dto.languages },
        ...(dto.categories?.length && { category: { in: dto.categories } }),
        ...(dto.caseIds?.length && { id: { in: dto.caseIds } }),
        ...(dto.onlyVerified && { reviewStatus: 'VERIFIED' }),
      },
      include: { semanticGroup: true },
      orderBy: { position: 'asc' },
    });
    if (cases.length === 0) {
      throw AppException.validation('No benchmark cases match the selected languages and filters.');
    }
    if (cases.length > this.config.MAX_CASES_PER_RUN) {
      throw AppException.validation(`A run can include at most ${this.config.MAX_CASES_PER_RUN} cases; ${cases.length} were selected.`);
    }

    const defaults = modelConfig.defaultParameters as unknown as InferenceDefaults;
    const p = dto.parameters ?? {};
    const inferenceConfig: InferenceConfig = {
      temperature: p.temperature ?? defaults.temperature,
      maxTokens: p.maxTokens ?? defaults.maxTokens,
      topP: p.topP ?? defaults.topP ?? null,
      repetitionPenalty: p.repetitionPenalty ?? defaults.repetitionPenalty ?? null,
      seed: p.seed ?? null,
      systemPrompt: p.systemPrompt !== undefined ? p.systemPrompt.trim() || null : defaults.systemPrompt,
    };

    const run = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.evaluationRun.create({
          data: {
            projectId: dto.projectId,
            createdById: auth.user.id,
            benchmarkSuiteId: suite.id,
            benchmarkVersion: suite.version,
            benchmarkContentHash: suite.contentHash,
            modelConfigurationId: modelConfig.id,
            providerType: modelConfig.providerType,
            modelIdentifier: modelConfig.modelIdentifier,
            modelRevision: modelConfig.modelRevision,
            isSimulated: modelConfig.isSimulated,
            inferenceConfig: inferenceConfig as unknown as Prisma.InputJsonValue,
            evaluatorVersion: EVALUATOR_VERSION,
            languages: [...dto.languages].sort((a, b) => LANGUAGE_ORDER.indexOf(a) - LANGUAGE_ORDER.indexOf(b)),
            selection: {
              categories: dto.categories ?? null,
              caseIds: dto.caseIds ?? null,
              onlyVerified: dto.onlyVerified ?? false,
            },
            totalCases: cases.length,
          },
        });
        await tx.evaluationResult.createMany({
          data: cases.map((c) => ({
            evaluationRunId: created.id,
            benchmarkCaseId: c.id,
            semanticGroupId: c.semanticGroupId,
            caseKey: c.key,
            language: c.language,
            category: c.category,
            prompt: c.prompt,
            caseSnapshot: snapshotCase(c) as unknown as Prisma.InputJsonValue,
          })),
        });
        return created;
      },
      { timeout: 30_000 },
    );
    this.worker.nudge();
    return this.getRun(auth, run.id);
  }

  async rerun(auth: AuthContext, runId: string) {
    const run = await this.requireRun(auth, runId);
    const selection = run.selection as { categories: string[] | null; caseIds: string[] | null; onlyVerified: boolean };
    const params = run.inferenceConfig as unknown as InferenceConfig;
    return this.createRun(auth, {
      projectId: run.projectId,
      suiteId: run.benchmarkSuiteId,
      languages: run.languages,
      categories: selection.categories ?? undefined,
      caseIds: selection.caseIds ?? undefined,
      onlyVerified: selection.onlyVerified,
      modelConfigurationId: run.modelConfigurationId,
      parameters: {
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        ...(params.topP !== null && { topP: params.topP }),
        ...(params.repetitionPenalty !== null && { repetitionPenalty: params.repetitionPenalty }),
        ...(params.seed !== null && { seed: params.seed }),
        systemPrompt: params.systemPrompt ?? '',
      },
    });
  }

  async listRuns(auth: AuthContext, query: ListRunsQueryDto) {
    const where: Prisma.EvaluationRunWhereInput = {
      project: { ownerId: auth.user.id },
      ...(auth.apiKeyProjectId && { projectId: auth.apiKeyProjectId }),
      ...(query.projectId && { projectId: query.projectId }),
      ...(query.status && { status: query.status as EvaluationRun['status'] }),
      ...(query.suiteId && { benchmarkSuiteId: query.suiteId }),
    };
    const [runs, total] = await this.prisma.$transaction([
      this.prisma.evaluationRun.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(query), include: RUN_INCLUDE }),
      this.prisma.evaluationRun.count({ where }),
    ]);
    return paginated(runs, total, query);
  }

  async getRun(auth: AuthContext, runId: string) {
    await this.requireRun(auth, runId);
    const [run, execution, verdicts] = await Promise.all([
      this.prisma.evaluationRun.findUniqueOrThrow({ where: { id: runId }, include: RUN_INCLUDE }),
      this.prisma.evaluationResult.groupBy({
        by: ['executionStatus'],
        where: { evaluationRunId: runId },
        _count: { _all: true },
      }),
      this.prisma.evaluationResult.groupBy({
        by: ['finalVerdict'],
        where: { evaluationRunId: runId, executionStatus: 'DONE' },
        _count: { _all: true },
      }),
    ]);
    const count = (rows: Array<{ _count: { _all: number } } & Record<string, unknown>>, key: string) =>
      Object.fromEntries(rows.map((r) => [String(r[key]), r._count._all]));
    const byExecution = count(execution, 'executionStatus');
    return {
      ...run,
      progress: {
        total: run.totalCases,
        pending: byExecution.PENDING ?? 0,
        running: byExecution.RUNNING ?? 0,
        done: byExecution.DONE ?? 0,
        byVerdict: count(verdicts, 'finalVerdict'),
      },
    };
  }

  async listResults(auth: AuthContext, runId: string, query: ListResultsQueryDto) {
    await this.requireRun(auth, runId);
    const where: Prisma.EvaluationResultWhereInput = {
      evaluationRunId: runId,
      ...(query.language && { language: query.language }),
      ...(query.category && { category: query.category }),
      ...(query.verdict && { finalVerdict: query.verdict as Verdict }),
      ...(query.search && {
        OR: [
          { caseKey: { contains: query.search, mode: 'insensitive' } },
          { prompt: { contains: query.search, mode: 'insensitive' } },
          { response: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [results, total] = await this.prisma.$transaction([
      this.prisma.evaluationResult.findMany({
        where,
        // Results share one createdAt (batch insert), so order by the benchmark's case order.
        orderBy: [{ case: { position: 'asc' } }, { caseKey: 'asc' }],
        ...pageArgs(query),
        include: { _count: { select: { reviews: true } } },
      }),
      this.prisma.evaluationResult.count({ where }),
    ]);
    return paginated(results, total, query);
  }

  async getResult(auth: AuthContext, runId: string, resultId: string) {
    await this.requireRun(auth, runId);
    const result = await this.prisma.evaluationResult.findFirst({
      where: { id: resultId, evaluationRunId: runId },
      include: { reviews: { orderBy: { reviewedAt: 'desc' }, include: { reviewer: { select: { id: true, name: true } } } } },
    });
    if (!result) throw AppException.notFound('Evaluation result');
    return result;
  }

  async cancel(auth: AuthContext, runId: string) {
    const run = await this.requireRun(auth, runId);
    const now = new Date();
    if (run.status === 'QUEUED') {
      const updated = await this.prisma.evaluationRun.updateMany({
        where: { id: runId, status: 'QUEUED' },
        data: { status: 'CANCELLED', cancelRequestedAt: now, completedAt: now },
      });
      if (updated.count === 1) {
        await this.prisma.evaluationResult.updateMany({
          where: { evaluationRunId: runId, executionStatus: 'PENDING' },
          data: {
            executionStatus: 'DONE',
            verdict: 'SKIPPED',
            finalVerdict: 'SKIPPED',
            executedAt: now,
            errorDetails: { code: 'RUN_CANCELLED', message: 'The run was cancelled before this case ran.' },
          },
        });
        await this.analysis.refreshSummary(runId);
        return this.getRun(auth, runId);
      }
    }
    const current = await this.prisma.evaluationRun.findUniqueOrThrow({ where: { id: runId } });
    if (current.status === 'RUNNING' || current.status === 'QUEUED') {
      await this.prisma.evaluationRun.update({ where: { id: runId }, data: { cancelRequestedAt: now } });
      return this.getRun(auth, runId);
    }
    throw new AppException('RUN_NOT_CANCELLABLE', `A ${current.status.toLowerCase()} run cannot be cancelled.`, HttpStatus.CONFLICT);
  }

  /** Records a human decision. Technical errors and skipped cases cannot be reviewed. */
  async reviewResult(auth: AuthContext, runId: string, resultId: string, dto: ReviewResultDto) {
    await this.requireRun(auth, runId);
    const result = await this.prisma.evaluationResult.findFirst({ where: { id: resultId, evaluationRunId: runId } });
    if (!result) throw AppException.notFound('Evaluation result');
    if (result.executionStatus !== 'DONE' || !result.verdict || ['ERROR', 'SKIPPED'].includes(result.verdict)) {
      throw new AppException(
        'CONFLICT',
        'Only evaluated model responses can be reviewed. Technical errors and skipped cases have no response to judge.',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction([
      this.prisma.humanReview.create({
        data: {
          evaluationResultId: resultId,
          reviewerId: auth.user.id,
          decision: dto.decision,
          previousVerdict: result.finalVerdict,
          notes: dto.notes ?? null,
        },
      }),
      this.prisma.evaluationResult.update({
        where: { id: resultId },
        data: { finalVerdict: dto.decision, requiresReview: false },
      }),
    ]);
    await this.analysis.refreshSummary(runId);
    return this.getResult(auth, runId, resultId);
  }

  /** Side-by-side cross-language analysis for every semantic group in the run. */
  async consistency(auth: AuthContext, runId: string) {
    await this.requireRun(auth, runId);
    const groups = await this.prisma.consistencyResult.findMany({
      where: { evaluationRunId: runId },
      orderBy: { semanticGroupKey: 'asc' },
      include: { group: { select: { description: true, expectedFacts: true } } },
    });
    const results = await this.prisma.evaluationResult.findMany({
      where: { evaluationRunId: runId, semanticGroupId: { in: groups.map((g) => g.semanticGroupId) } },
      select: {
        id: true,
        semanticGroupId: true,
        caseKey: true,
        language: true,
        prompt: true,
        response: true,
        verdict: true,
        finalVerdict: true,
        factChecks: true,
        errorDetails: true,
        responseTimeMs: true,
      },
    });
    const severity = { INCONSISTENT: 0, NEEDS_REVIEW: 1, INSUFFICIENT_DATA: 2, CONSISTENT: 3 } as const;
    return groups
      .map(({ group, ...g }) => ({
        ...g,
        description: group.description,
        expectedFacts: group.expectedFacts,
        entries: results
          .filter((r) => r.semanticGroupId === g.semanticGroupId)
          .sort((a, b) => LANGUAGE_ORDER.indexOf(a.language) - LANGUAGE_ORDER.indexOf(b.language))
          .map((r) => ({ ...r, languageName: isSupportedLanguage(r.language) ? LANGUAGES[r.language].name : r.language })),
      }))
      .sort((a, b) => severity[a.verdict] - severity[b.verdict] || a.semanticGroupKey.localeCompare(b.semanticGroupKey));
  }
}
