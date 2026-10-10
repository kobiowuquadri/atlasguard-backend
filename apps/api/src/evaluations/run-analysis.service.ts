import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { aggregate, analyzeConsistency, type ConsistencyEntry } from '@atlasguard/evaluator';
import type { ConsistencyVerdict, ExpectedFact, FactCheckResult, SupportedLanguage } from '@atlasguard/shared';
import { PrismaService } from '../database/prisma.service';

export interface RunSummary {
  overall: ReturnType<typeof aggregate>['overall'];
  byLanguage: ReturnType<typeof aggregate>['byLanguage'];
  byCategory: ReturnType<typeof aggregate>['byCategory'];
  byLanguageCategory: ReturnType<typeof aggregate>['byLanguageCategory'];
  consistency: { groups: number; byVerdict: Partial<Record<ConsistencyVerdict, number>>; confirmedContradictions: number };
  humanReviewed: number;
  computedAt: string;
}

/** Computes cross-language consistency and aggregate metrics for a run from stored results. */
@Injectable()
export class RunAnalysisService {
  constructor(private readonly prisma: PrismaService) {}

  /** Re-derives the run's counters and summary from its results (idempotent; never double counts). */
  async refreshSummary(runId: string): Promise<RunSummary> {
    const results = await this.prisma.evaluationResult.findMany({
      where: { evaluationRunId: runId },
      select: { language: true, category: true, finalVerdict: true, responseTimeMs: true, response: true, executionStatus: true, _count: { select: { reviews: true } } },
    });
    const agg = aggregate(
      results.map((r) => ({
        language: r.language,
        category: r.category,
        verdict: r.executionStatus === 'DONE' ? r.finalVerdict : null,
        responseTimeMs: r.response !== null ? r.responseTimeMs : null,
      })),
    );
    const consistency = await this.prisma.consistencyResult.findMany({
      where: { evaluationRunId: runId },
      select: { verdict: true, summary: true },
    });
    const byVerdict: Partial<Record<ConsistencyVerdict, number>> = {};
    let confirmedContradictions = 0;
    for (const c of consistency) {
      byVerdict[c.verdict] = (byVerdict[c.verdict] ?? 0) + 1;
      confirmedContradictions += (c.summary as { confirmedContradictions?: number }).confirmedContradictions ?? 0;
    }
    const summary: RunSummary = {
      ...agg,
      consistency: { groups: consistency.length, byVerdict, confirmedContradictions },
      humanReviewed: results.filter((r) => r._count.reviews > 0).length,
      computedAt: new Date().toISOString(),
    };
    await this.prisma.evaluationRun.update({
      where: { id: runId },
      data: {
        summary: summary as unknown as Prisma.InputJsonValue,
        completedCases: results.filter((r) => r.executionStatus === 'DONE').length,
        failedCases: agg.overall.failed,
      },
    });
    return summary;
  }

  /** Runs the consistency engine for every semantic group with variants in this run. */
  async computeConsistency(runId: string): Promise<number> {
    const run = await this.prisma.evaluationRun.findUniqueOrThrow({ where: { id: runId }, select: { languages: true } });
    const results = await this.prisma.evaluationResult.findMany({
      where: { evaluationRunId: runId, semanticGroupId: { not: null } },
      select: { semanticGroupId: true, language: true, executionStatus: true, finalVerdict: true, response: true, factChecks: true },
    });
    const byGroup = new Map<string, typeof results>();
    for (const r of results) {
      const list = byGroup.get(r.semanticGroupId!) ?? [];
      list.push(r);
      byGroup.set(r.semanticGroupId!, list);
    }
    const groups = await this.prisma.semanticGroup.findMany({ where: { id: { in: [...byGroup.keys()] } } });

    let analysed = 0;
    for (const group of groups) {
      const groupResults = byGroup.get(group.id)!;
      if (groupResults.length < 2) continue;
      const entries: ConsistencyEntry[] = groupResults.map((r) => ({
        language: r.language as SupportedLanguage,
        hasResponse:
          r.executionStatus === 'DONE' && r.response !== null && r.finalVerdict !== 'ERROR' && r.finalVerdict !== 'SKIPPED',
        factChecks: (r.factChecks as unknown as FactCheckResult[] | null) ?? [],
      }));
      const expectedLanguages = groupResults.map((r) => r.language as SupportedLanguage);
      const analysis = analyzeConsistency(
        { key: group.key, facts: group.expectedFacts as unknown as ExpectedFact[] },
        entries,
        expectedLanguages.filter((l) => run.languages.includes(l)),
      );
      const data = {
        semanticGroupKey: group.key,
        title: group.title,
        category: group.category,
        languagesCompared: analysis.languagesCompared,
        languagesMissing: analysis.languagesMissing,
        findings: analysis.findings as unknown as Prisma.InputJsonValue,
        summary: analysis.summary as unknown as Prisma.InputJsonValue,
        verdict: analysis.verdict,
        method: analysis.method,
        evaluatorVersion: analysis.evaluatorVersion,
      };
      await this.prisma.consistencyResult.upsert({
        where: { evaluationRunId_semanticGroupId: { evaluationRunId: runId, semanticGroupId: group.id } },
        create: { evaluationRunId: runId, semanticGroupId: group.id, ...data },
        update: data,
      });
      analysed++;
    }
    return analysed;
  }
}
