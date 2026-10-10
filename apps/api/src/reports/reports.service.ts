import { HttpStatus, Injectable } from '@nestjs/common';
import { EVALUATOR_VERSION } from '@atlasguard/evaluator';
import {
  CATEGORY_LABELS,
  LANGUAGES,
  NATLAS_ATTRIBUTION,
  isSupportedLanguage,
  type BenchmarkCategory,
  type CheckResult,
  type ConsistencyFinding,
  type ResultBucket,
} from '@atlasguard/shared';
import type { CaseSnapshot } from '../benchmarks/case-definition';
import { AppException } from '../common/app-exception';
import type { AuthContext } from '../common/auth-context';
import { canonicalJson, sha256 } from '../common/crypto';
import { PrismaService } from '../database/prisma.service';
import { EvaluationsService } from '../evaluations/evaluations.service';
import { RunAnalysisService, type RunSummary } from '../evaluations/run-analysis.service';
import { API_VERSION } from '../system/system.controller';
import { toCsv, toMarkdown } from './formatters';
import { LIMITATIONS, METHODOLOGY } from './methodology';

export const SIMULATION_NOTICE =
  'This run used AtlasGuard development fixtures. Responses are hand-written test data, NOT output from N-ATLaS, and must not be presented as model results.';

const languageName = (code: string) => (isSupportedLanguage(code) ? LANGUAGES[code].name : code);
const categoryLabel = (code: string) => CATEGORY_LABELS[code as BenchmarkCategory] ?? code;

export type ReportDocument = Awaited<ReturnType<ReportsService['build']>>;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evaluations: EvaluationsService,
    private readonly analysis: RunAnalysisService,
  ) {}

  private async loadRun(auth: AuthContext, runId: string) {
    await this.evaluations.requireRun(auth, runId);
    const run = await this.prisma.evaluationRun.findUniqueOrThrow({
      where: { id: runId },
      include: {
        project: { select: { id: true, name: true } },
        suite: { select: { id: true, slug: true, name: true, version: true, contentHash: true, namespace: true } },
        modelConfiguration: { select: { name: true } },
      },
    });
    const summary = (run.summary as RunSummary | null) ?? (await this.analysis.refreshSummary(runId));
    return { run, summary };
  }

  async build(auth: AuthContext, runId: string) {
    const { run, summary } = await this.loadRun(auth, runId);
    const [results, consistency] = await Promise.all([
      this.prisma.evaluationResult.findMany({
        where: { evaluationRunId: runId },
        orderBy: [{ case: { position: 'asc' } }, { caseKey: 'asc' }],
        include: { _count: { select: { reviews: true } } },
      }),
      this.prisma.consistencyResult.findMany({ where: { evaluationRunId: runId }, orderBy: { semanticGroupKey: 'asc' } }),
    ]);
    const o = summary.overall;
    const durationMs = run.startedAt && run.completedAt ? run.completedAt.getTime() - run.startedAt.getTime() : null;

    return {
      generatedAt: new Date().toISOString(),
      generator: { name: 'AtlasGuard', apiVersion: API_VERSION, evaluatorVersion: run.evaluatorVersion, currentEvaluatorVersion: EVALUATOR_VERSION },
      simulated: run.isSimulated,
      simulationNotice: run.isSimulated ? SIMULATION_NOTICE : null,
      overview: {
        project: run.project,
        run: {
          id: run.id,
          status: run.status,
          createdAt: run.createdAt.toISOString(),
          startedAt: run.startedAt?.toISOString() ?? null,
          completedAt: run.completedAt?.toISOString() ?? null,
          durationMs,
          errorDetails: run.errorDetails,
        },
        benchmark: {
          id: run.suite.id,
          slug: run.suite.slug,
          name: run.suite.name,
          version: run.benchmarkVersion,
          contentHash: run.benchmarkContentHash,
        },
        model: {
          configurationName: run.modelConfiguration.name,
          providerType: run.providerType,
          modelIdentifier: run.modelIdentifier,
          modelRevision: run.modelRevision,
          isSimulated: run.isSimulated,
          providerMetadata: run.providerMetadata,
        },
        inference: run.inferenceConfig,
        languages: run.languages,
        selection: run.selection,
      },
      summary: {
        total: o.total,
        completed: o.total - o.pending,
        passed: o.passed,
        failed: o.failed,
        needsReview: o.needsReview,
        skipped: o.skipped,
        errors: o.errors,
        pending: o.pending,
        verifiedPassRate: o.verifiedPassRate,
        averageLatencyMs: o.averageLatencyMs,
        medianLatencyMs: o.medianLatencyMs,
        humanReviewed: summary.humanReviewed,
      },
      languagePerformance: Object.entries(summary.byLanguage)
        .sort(([a], [b]) => Object.keys(LANGUAGES).indexOf(a) - Object.keys(LANGUAGES).indexOf(b))
        .map(([language, bucket]) => ({ language, name: languageName(language), ...bucket })),
      categoryPerformance: Object.entries(summary.byCategory).map(([category, bucket]: [string, ResultBucket]) => ({
        category,
        label: categoryLabel(category),
        ...bucket,
      })),
      consistency: {
        groupsCompared: consistency.length,
        byVerdict: summary.consistency.byVerdict,
        confirmedContradictions: summary.consistency.confirmedContradictions,
        groups: consistency.map((c) => ({
          key: c.semanticGroupKey,
          title: c.title,
          category: c.category,
          verdict: c.verdict,
          languagesCompared: c.languagesCompared,
          languagesMissing: c.languagesMissing,
          summary: c.summary,
          findings: (c.findings as unknown as ConsistencyFinding[]).filter((f) => f.severity !== 'info' || f.type === 'consistent_error'),
        })),
      },
      findings: results.map((r) => {
        const snapshot = r.caseSnapshot as unknown as CaseSnapshot;
        const checks = (r.checks as unknown as CheckResult[] | null) ?? [];
        return {
          resultId: r.id,
          caseKey: r.caseKey,
          language: r.language,
          category: r.category,
          semanticGroup: snapshot.semanticGroupKey,
          verdict: r.verdict,
          finalVerdict: r.finalVerdict,
          humanReviewed: r._count.reviews > 0,
          prompt: r.prompt,
          response: r.response,
          latencyMs: r.responseTimeMs,
          providerInferenceMs: r.providerInferenceMs,
          referenceFacts: snapshot.facts.map((f) => f.description),
          checks: checks.map((c) => ({ id: c.id, status: c.status, method: c.method, explanation: c.explanation, evidence: c.evidence ?? null })),
          error: r.errorDetails as { code?: string; message?: string } | null,
        };
      }),
      methodology: METHODOLOGY,
      limitations: LIMITATIONS,
      attribution: NATLAS_ATTRIBUTION,
    };
  }

  async export(auth: AuthContext, runId: string, format: 'json' | 'csv' | 'markdown') {
    const report = await this.build(auth, runId);
    const base = `atlasguard-run-${runId.slice(0, 8)}${report.simulated ? '-SIMULATED' : ''}`;
    if (format === 'json') {
      return { filename: `${base}.json`, contentType: 'application/json; charset=utf-8', body: `${JSON.stringify(report, null, 2)}\n` };
    }
    if (format === 'markdown') {
      return { filename: `${base}.md`, contentType: 'text/markdown; charset=utf-8', body: toMarkdown(report) };
    }
    const rows = report.findings.map((f) => ({
      run_id: runId,
      simulated: report.simulated,
      model: report.overview.model.modelIdentifier,
      case_key: f.caseKey,
      language: f.language,
      category: f.category,
      semantic_group: f.semanticGroup,
      automated_verdict: f.verdict,
      final_verdict: f.finalVerdict,
      human_reviewed: f.humanReviewed,
      latency_ms: f.latencyMs,
      provider_inference_ms: f.providerInferenceMs,
      failed_checks: f.checks.filter((c) => c.status === 'fail').map((c) => c.id).join(' '),
      review_checks: f.checks.filter((c) => c.status === 'uncertain').map((c) => c.id).join(' '),
      error_code: f.error?.code ?? '',
      prompt: f.prompt,
      response: f.response,
    }));
    const columns = Object.keys(rows[0] ?? { run_id: '' });
    return { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', body: `﻿${toCsv(rows, columns)}` };
  }

  /** Compares two runs of the same benchmark suite: rate deltas and per-case verdict changes. */
  async compare(auth: AuthContext, baseRunId: string, targetRunId: string) {
    const [base, target] = await Promise.all([this.loadRun(auth, baseRunId), this.loadRun(auth, targetRunId)]);
    if (base.run.suite.namespace !== target.run.suite.namespace || base.run.suite.slug !== target.run.suite.slug) {
      throw new AppException('INCOMPATIBLE_RUNS', 'Runs can only be compared when they use the same benchmark suite.', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const warnings: string[] = [];
    if (base.run.benchmarkContentHash !== target.run.benchmarkContentHash) {
      warnings.push(`Benchmark content differs (v${base.run.benchmarkVersion} vs v${target.run.benchmarkVersion}); only cases present in both runs are compared.`);
    }
    if (base.run.isSimulated !== target.run.isSimulated) warnings.push('One run is SIMULATED (fixtures) and the other is not.');
    if (base.run.modelIdentifier !== target.run.modelIdentifier || base.run.modelRevision !== target.run.modelRevision) {
      warnings.push('The runs used different models or model revisions.');
    }
    if (canonicalJson(base.run.inferenceConfig) !== canonicalJson(target.run.inferenceConfig)) {
      warnings.push('Generation parameters differ between the runs.');
    }
    if (base.run.evaluatorVersion !== target.run.evaluatorVersion) warnings.push('The runs were scored by different evaluator versions.');

    const delta = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.round((b - a) * 10000) / 10000);
    const compareBuckets = (a: Record<string, ResultBucket>, b: Record<string, ResultBucket>, label: (k: string) => string) =>
      [...new Set([...Object.keys(a), ...Object.keys(b)])].map((key) => ({
        key,
        label: label(key),
        base: a[key] ?? null,
        target: b[key] ?? null,
        passRateDelta: delta(a[key]?.verifiedPassRate ?? null, b[key]?.verifiedPassRate ?? null),
        latencyDeltaMs: delta(a[key]?.averageLatencyMs ?? null, b[key]?.averageLatencyMs ?? null),
      }));

    const [baseResults, targetResults] = await Promise.all(
      [baseRunId, targetRunId].map((id) =>
        this.prisma.evaluationResult.findMany({
          where: { evaluationRunId: id },
          select: { caseKey: true, language: true, finalVerdict: true },
        }),
      ),
    );
    const targetByKey = new Map(targetResults!.map((r) => [r.caseKey, r]));
    const rank: Record<string, number> = { PASSED: 2, NEEDS_REVIEW: 1, FAILED: 0 };
    const changes = baseResults!
      .filter((r) => targetByKey.has(r.caseKey) && targetByKey.get(r.caseKey)!.finalVerdict !== r.finalVerdict)
      .map((r) => {
        const after = targetByKey.get(r.caseKey)!.finalVerdict;
        const before = r.finalVerdict;
        const direction =
          before && after && before in rank && after in rank ? (rank[after]! > rank[before]! ? 'improved' : 'regressed') : 'changed';
        return { caseKey: r.caseKey, language: r.language, base: before, target: after, direction };
      });

    return {
      base: { id: baseRunId, createdAt: base.run.createdAt, isSimulated: base.run.isSimulated, overall: base.summary.overall },
      target: { id: targetRunId, createdAt: target.run.createdAt, isSimulated: target.run.isSimulated, overall: target.summary.overall },
      suite: { slug: base.run.suite.slug, name: base.run.suite.name },
      warnings,
      overall: {
        passRateDelta: delta(base.summary.overall.verifiedPassRate, target.summary.overall.verifiedPassRate),
        latencyDeltaMs: delta(base.summary.overall.averageLatencyMs, target.summary.overall.averageLatencyMs),
      },
      byLanguage: compareBuckets(base.summary.byLanguage, target.summary.byLanguage, languageName),
      byCategory: compareBuckets(base.summary.byCategory, target.summary.byCategory, categoryLabel),
      caseChanges: changes,
      casesCompared: baseResults!.filter((r) => targetByKey.has(r.caseKey)).length,
    };
  }

  /**
   * N-ATLaS integration evidence: the exact prompts, responses, timings and model
   * provenance of a completed real run, with a SHA-256 digest over the bundle.
   * Refused for simulated runs so fixtures can never be mistaken for model output.
   */
  async evidence(auth: AuthContext, runId: string) {
    const { run } = await this.loadRun(auth, runId);
    if (run.isSimulated) {
      throw new AppException(
        'EVIDENCE_EXPORT_DISABLED',
        'This run used simulated development fixtures, so it cannot be exported as N-ATLaS integration evidence.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (run.status !== 'COMPLETED') {
      throw new AppException('CONFLICT', 'Evidence can only be exported for completed runs.', HttpStatus.CONFLICT);
    }
    const results = await this.prisma.evaluationResult.findMany({
      where: { evaluationRunId: runId },
      orderBy: [{ case: { position: 'asc' } }, { caseKey: 'asc' }],
    });
    const interactions = results.map((r) => {
      const meta = (r.responseMetadata ?? {}) as Record<string, unknown>;
      return {
        caseKey: r.caseKey,
        language: r.language,
        requestId: r.requestId,
        providerRequestId: r.providerRequestId,
        servedModel: meta.servedModel ?? null,
        startedAt: meta.startedAt ?? null,
        completedAt: meta.completedAt ?? null,
        finishReason: meta.finishReason ?? null,
        usage: meta.usage ?? null,
        latencyMs: r.responseTimeMs,
        providerInferenceMs: r.providerInferenceMs,
        prompt: r.prompt,
        response: r.response,
        verdict: r.finalVerdict,
        error: r.errorDetails,
      };
    });
    const responses = interactions.filter((i) => i.response !== null);
    const bundle = {
      kind: 'atlasguard.natlas-integration-evidence',
      formatVersion: 1,
      generatedAt: new Date().toISOString(),
      generator: { name: 'AtlasGuard', apiVersion: API_VERSION },
      run: {
        id: run.id,
        project: run.project.name,
        createdAt: run.createdAt.toISOString(),
        startedAt: run.startedAt?.toISOString() ?? null,
        completedAt: run.completedAt?.toISOString() ?? null,
        providerType: run.providerType,
        modelIdentifier: run.modelIdentifier,
        modelRevision: run.modelRevision,
        providerMetadata: run.providerMetadata,
        inferenceConfig: run.inferenceConfig,
        evaluatorVersion: run.evaluatorVersion,
        benchmark: { slug: run.suite.slug, version: run.benchmarkVersion, contentHash: run.benchmarkContentHash },
      },
      statistics: {
        cases: interactions.length,
        responses: responses.length,
        errors: interactions.length - responses.length,
        servedModels: [...new Set(responses.map((r) => r.servedModel))],
      },
      interactions,
      attribution: NATLAS_ATTRIBUTION,
    };
    return { ...bundle, integrity: { algorithm: 'sha256', canonicalisation: 'sorted-keys JSON', digest: sha256(canonicalJson(bundle)) } };
  }
}
