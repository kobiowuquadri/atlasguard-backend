import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { aggregate, bucket } from '@atlasguard/evaluator';
import { CATEGORY_LABELS, LANGUAGES, SUPPORTED_LANGUAGES, type BenchmarkCategory } from '@atlasguard/shared';
import { AppException } from '../common/app-exception';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../database/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ModelProviderRegistry } from '../providers/model-provider.registry';

const ACTIVITY_DAYS = 14;
const MAX_ROWS = 50_000;

export interface InsightFilters {
  projectId?: string;
  runId?: string;
  includeSimulated: boolean;
}

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly registry: ModelProviderRegistry,
  ) {}

  private async runWhere(auth: AuthContext, filters: InsightFilters): Promise<Prisma.EvaluationRunWhereInput> {
    if (filters.projectId) await this.projects.requireProject(auth, filters.projectId);
    const projectIds = filters.projectId ? [filters.projectId] : await this.projects.accessibleProjectIds(auth);
    return {
      projectId: { in: projectIds },
      ...(filters.runId && { id: filters.runId }),
      ...(!filters.includeSimulated && { isSimulated: false }),
    };
  }

  private async completedResults(runWhere: Prisma.EvaluationRunWhereInput) {
    const rows = await this.prisma.evaluationResult.findMany({
      where: { run: runWhere, executionStatus: 'DONE' },
      select: { language: true, category: true, finalVerdict: true, responseTimeMs: true, response: true },
      take: MAX_ROWS,
    });
    return rows.map((r) => ({
      language: r.language,
      category: r.category,
      verdict: r.finalVerdict,
      responseTimeMs: r.response !== null ? r.responseTimeMs : null,
    }));
  }

  /** Dashboard overview. Every number is derived from stored evaluation records. */
  async overview(auth: AuthContext, filters: InsightFilters) {
    const runWhere = await this.runWhere(auth, filters);
    const allProjectsWhere = await this.runWhere(auth, { ...filters, includeSimulated: true });
    const since = new Date(Date.now() - ACTIVITY_DAYS * 24 * 60 * 60 * 1000);

    const [runCount, runsByStatus, recentRuns, activityRuns, results, simulatedRuns, projectCount] = await Promise.all([
      this.prisma.evaluationRun.count({ where: runWhere }),
      this.prisma.evaluationRun.groupBy({ by: ['status'], where: runWhere, _count: { _all: true } }),
      this.prisma.evaluationRun.findMany({
        where: runWhere,
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: {
          project: { select: { id: true, name: true } },
          suite: { select: { id: true, name: true, version: true } },
        },
      }),
      this.prisma.evaluationRun.findMany({ where: { ...runWhere, createdAt: { gte: since } }, select: { createdAt: true, status: true } }),
      this.completedResults(runWhere),
      this.prisma.evaluationRun.count({ where: { ...allProjectsWhere, isSimulated: true } }),
      this.prisma.project.count({ where: { ownerId: auth.user.id, archivedAt: null } }),
    ]);

    const agg = aggregate(results);
    const days = Array.from({ length: ACTIVITY_DAYS }, (_, i) => {
      const d = new Date(since.getTime() + (i + 1) * 24 * 60 * 60 * 1000);
      return d.toISOString().slice(0, 10);
    });
    const activity = days.map((date) => ({
      date,
      runs: activityRuns.filter((r) => r.createdAt.toISOString().slice(0, 10) === date).length,
      completed: activityRuns.filter((r) => r.status === 'COMPLETED' && r.createdAt.toISOString().slice(0, 10) === date).length,
    }));

    const natlasHealth = await this.registry.health(this.registry.natlas);
    return {
      includeSimulated: filters.includeSimulated,
      simulatedRunCount: simulatedRuns,
      projectCount,
      totals: {
        runs: runCount,
        runsByStatus: Object.fromEntries(runsByStatus.map((r) => [r.status, r._count._all])),
        casesEvaluated: agg.overall.total,
        verifiedPassRate: agg.overall.verifiedPassRate,
        determinate: agg.overall.determinate,
        averageLatencyMs: agg.overall.averageLatencyMs,
        needsReview: agg.overall.needsReview,
        errors: agg.overall.errors,
      },
      verdictDistribution: {
        PASSED: agg.overall.passed,
        FAILED: agg.overall.failed,
        NEEDS_REVIEW: agg.overall.needsReview,
        ERROR: agg.overall.errors,
        SKIPPED: agg.overall.skipped,
      },
      languageComparison: SUPPORTED_LANGUAGES.map((code) => ({
        language: code,
        name: LANGUAGES[code].name,
        evaluated: Boolean(agg.byLanguage[code]),
        ...(agg.byLanguage[code] ?? bucket([])),
      })),
      activity,
      recentRuns,
      model: {
        natlasConfigured: this.registry.natlas.isConfigured(),
        status: natlasHealth.status,
        message: natlasHealth.message,
        fixturesEnabled: Boolean(this.registry.fixture),
      },
    };
  }

  /** Per-language comparison. Languages without completed results are reported as not evaluated. */
  async languages(auth: AuthContext, filters: InsightFilters) {
    if (filters.runId) {
      const run = await this.prisma.evaluationRun.findFirst({ where: { id: filters.runId, project: { ownerId: auth.user.id } } });
      if (!run) throw AppException.notFound('Evaluation run');
    }
    const runWhere = await this.runWhere(auth, filters);
    const agg = aggregate(await this.completedResults(runWhere));
    const consistency = await this.prisma.consistencyResult.findMany({
      where: { run: runWhere },
      select: { verdict: true, languagesCompared: true, languagesMissing: true, summary: true, findings: true },
    });

    return {
      includeSimulated: filters.includeSimulated,
      languages: SUPPORTED_LANGUAGES.map((code) => {
        const stats = agg.byLanguage[code];
        const involved = consistency.filter((c) => c.languagesCompared.includes(code));
        const conflicts = involved.filter((c) =>
          (c.findings as Array<{ severity: string; languages: string[] }>).some(
            (f) => f.severity === 'conflict' && f.languages.includes(code),
          ),
        ).length;
        return {
          language: code,
          name: LANGUAGES[code].name,
          nativeName: LANGUAGES[code].nativeName,
          evaluated: Boolean(stats),
          stats: stats ?? null,
          categories: Object.entries(agg.byLanguageCategory[code] ?? {}).map(([category, b]) => ({
            category,
            label: CATEGORY_LABELS[category as BenchmarkCategory] ?? category,
            ...b,
          })),
          consistency: { groupsCompared: involved.length, groupsWithConflicts: conflicts },
        };
      }),
    };
  }
}
