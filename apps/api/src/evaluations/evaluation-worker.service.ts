import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Prisma, type EvaluationRun, type ModelConfiguration, type RunStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { evaluateCase, ProviderError, type ChatMessage, type ModelProvider } from '@atlasguard/evaluator';
import { definitionFromSnapshot, type CaseSnapshot } from '../benchmarks/case-definition';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import { ModelProviderRegistry } from '../providers/model-provider.registry';
import { RunAnalysisService } from './run-analysis.service';

export interface InferenceConfig {
  temperature: number;
  maxTokens: number;
  topP: number | null;
  repetitionPenalty: number | null;
  seed: number | null;
  systemPrompt: string | null;
}

interface RunState {
  consecutiveProviderFailures: number;
  abort: { status: Extract<RunStatus, 'FAILED' | 'CANCELLED'>; error?: { code: string; message: string } } | null;
}

/** Provider failures that mean "the endpoint is down", as opposed to a problem with one case. */
const AVAILABILITY_ERRORS = new Set(['PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'PROVIDER_NOT_CONFIGURED', 'PROVIDER_RATE_LIMITED']);
const MAX_CONSECUTIVE_PROVIDER_FAILURES = 3;
const MAX_RUN_ATTEMPTS = 5;
const HEARTBEAT_MS = 10_000;

const json = (value: unknown) => value as Prisma.InputJsonValue;

/**
 * Database-backed evaluation worker.
 *
 * Runs are claimed atomically with `FOR UPDATE SKIP LOCKED`, so several API instances can
 * share the queue. A heartbeat marks progress; runs whose heartbeat goes stale (crash,
 * redeploy) are reclaimed and resumed. Each case is claimed with a conditional update and
 * results are unique per (run, case), so a case is never evaluated or counted twice.
 */
@Injectable()
export class EvaluationWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EvaluationWorker.name);
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly shutdown = new AbortController();
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopping = false;
  private active: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ModelProviderRegistry,
    private readonly analysis: RunAnalysisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.WORKER_ENABLED) {
      this.logger.log(`Evaluation worker ${this.workerId} started (concurrency ${this.config.WORKER_CONCURRENCY}).`);
      this.schedule(0);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.shutdown.abort();
    await this.active?.catch(() => undefined);
  }

  /** Wakes the worker immediately (called when a run is queued). */
  nudge(): void {
    if (this.config.WORKER_ENABLED && !this.busy && !this.stopping) this.schedule(0);
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (this.busy || this.stopping) return;
    this.busy = true;
    try {
      while (!this.stopping && (await this.processNextRun())) {
        // keep draining the queue
      }
    } catch (error) {
      this.logger.error('Worker iteration failed', error instanceof Error ? error.stack : String(error));
    } finally {
      this.busy = false;
      if (!this.stopping) this.schedule(this.config.WORKER_POLL_INTERVAL_MS);
    }
  }

  /** Claims and processes one run. Returns false when nothing is queued. Exposed for tests. */
  async processNextRun(): Promise<boolean> {
    const runId = await this.claimRun();
    if (!runId) return false;
    this.active = this.executeRun(runId);
    try {
      await this.active;
    } finally {
      this.active = null;
    }
    return true;
  }

  private async claimRun(): Promise<string | null> {
    // Prisma stores DateTime as UTC wall-clock values in timestamp-without-time-zone
    // columns. SQL now() and raw Date parameters would be converted using the database
    // session's time zone, so timestamps are passed as ISO strings and converted to UTC
    // explicitly. This keeps the claim correct on servers whose time zone is not UTC.
    const now = new Date().toISOString();
    const staleBefore = new Date(Date.now() - this.config.WORKER_STALE_AFTER_MS).toISOString();
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "EvaluationRun"
      SET "status" = 'RUNNING',
          "lockedBy" = ${this.workerId},
          "heartbeatAt" = (${now}::timestamptz AT TIME ZONE 'UTC'),
          "startedAt" = COALESCE("startedAt", (${now}::timestamptz AT TIME ZONE 'UTC')),
          "attempts" = "attempts" + 1,
          "updatedAt" = (${now}::timestamptz AT TIME ZONE 'UTC')
      WHERE "id" = (
        SELECT "id" FROM "EvaluationRun"
        WHERE "status" = 'QUEUED'
           OR ("status" = 'RUNNING' AND ("heartbeatAt" IS NULL OR "heartbeatAt" < (${staleBefore}::timestamptz AT TIME ZONE 'UTC')))
        ORDER BY "queuedAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id"`;
    return rows[0]?.id ?? null;
  }

  private async executeRun(runId: string): Promise<void> {
    const run = await this.prisma.evaluationRun.findUniqueOrThrow({
      where: { id: runId },
      include: { modelConfiguration: true },
    });
    const log = (message: string) => this.logger.log(JSON.stringify({ runId, message }));
    log(`claimed (attempt ${run.attempts})`);

    if (run.cancelRequestedAt) return this.finish(run.id, { status: 'CANCELLED' });
    if (run.attempts > MAX_RUN_ATTEMPTS) {
      return this.finish(run.id, {
        status: 'FAILED',
        error: { code: 'RUN_RECOVERY_LIMIT', message: `Run was interrupted ${MAX_RUN_ATTEMPTS} times and has been stopped.` },
      });
    }

    // Recover cases interrupted mid-flight by a crash or redeploy.
    await this.prisma.evaluationResult.updateMany({
      where: { evaluationRunId: run.id, executionStatus: 'RUNNING' },
      data: { executionStatus: 'PENDING' },
    });
    await this.prisma.evaluationResult.updateMany({
      where: { evaluationRunId: run.id, executionStatus: 'PENDING', attempts: { gte: this.config.CASE_MAX_ATTEMPTS } },
      data: {
        executionStatus: 'DONE',
        verdict: 'ERROR',
        finalVerdict: 'ERROR',
        executedAt: new Date(),
        errorDetails: json({ code: 'MAX_ATTEMPTS_EXCEEDED', message: 'The case was interrupted too many times.' }),
      },
    });

    let provider: ModelProvider;
    try {
      provider = this.registry.forConfiguration(run.modelConfiguration);
    } catch (error) {
      return this.finish(run.id, {
        status: 'FAILED',
        error: { code: 'MODEL_PROVIDER_NOT_CONFIGURED', message: error instanceof Error ? error.message : 'Provider not available.' },
        skipPending: true,
      });
    }

    const health = await provider.healthCheck();
    if (health.status !== 'available') {
      return this.finish(run.id, {
        status: 'FAILED',
        error: { code: 'MODEL_PROVIDER_UNAVAILABLE', message: health.message },
        skipPending: true,
      });
    }
    const modelInfo = await provider.getModelInfo();
    await this.prisma.evaluationRun.update({
      where: { id: run.id },
      data: {
        modelRevision: run.modelRevision ?? modelInfo.revision ?? null,
        providerMetadata: json({ modelInfo, health, workerId: this.workerId, recordedAt: new Date().toISOString() }),
      },
    });

    const pending = await this.prisma.evaluationResult.findMany({
      where: { evaluationRunId: run.id, executionStatus: 'PENDING' },
      orderBy: [{ case: { position: 'asc' } }, { caseKey: 'asc' }],
      select: { id: true },
    });
    log(`processing ${pending.length} pending case(s) with ${provider.providerName}`);

    const state: RunState = { consecutiveProviderFailures: 0, abort: null };
    const heartbeat = setInterval(() => {
      void this.prisma.evaluationRun
        .update({ where: { id: run.id }, data: { heartbeatAt: new Date() } })
        .catch(() => undefined);
    }, HEARTBEAT_MS);

    let next = 0;
    const lane = async () => {
      while (!state.abort && !this.stopping) {
        const item = pending[next++];
        if (!item) return;
        const current = await this.prisma.evaluationRun.findUnique({
          where: { id: run.id },
          select: { cancelRequestedAt: true },
        });
        if (current?.cancelRequestedAt) {
          state.abort = { status: 'CANCELLED' };
          return;
        }
        await this.processResult(run, provider, item.id, state);
        await this.analysis.refreshSummary(run.id).catch(() => undefined);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(this.config.WORKER_CONCURRENCY, pending.length) }, lane));
    } finally {
      clearInterval(heartbeat);
    }

    if (this.stopping) {
      log('shutdown requested; run will resume on the next worker');
      return;
    }
    if (state.abort) {
      return this.finish(run.id, { status: state.abort.status, error: state.abort.error, skipPending: true });
    }
    await this.analysis.computeConsistency(run.id);
    await this.finish(run.id, { status: 'COMPLETED' });
    log('completed');
  }

  private async processResult(
    run: EvaluationRun & { modelConfiguration: ModelConfiguration },
    provider: ModelProvider,
    resultId: string,
    state: RunState,
  ): Promise<void> {
    const claimed = await this.prisma.evaluationResult.updateMany({
      where: { id: resultId, executionStatus: 'PENDING' },
      data: { executionStatus: 'RUNNING', attempts: { increment: 1 }, startedAt: new Date() },
    });
    if (claimed.count === 0) return;

    const result = await this.prisma.evaluationResult.findUniqueOrThrow({ where: { id: resultId } });
    const snapshot = result.caseSnapshot as unknown as CaseSnapshot;
    const params = run.inferenceConfig as unknown as InferenceConfig;
    const messages: ChatMessage[] = [
      ...(params.systemPrompt ? [{ role: 'system' as const, content: params.systemPrompt }] : []),
      { role: 'user', content: result.prompt },
    ];
    const requestId = randomUUID();

    try {
      const generation = await provider.generate({
        requestId,
        messages,
        parameters: {
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          ...(params.topP !== null && { topP: params.topP }),
          ...(params.repetitionPenalty !== null && { repetitionPenalty: params.repetitionPenalty }),
          ...(params.seed !== null && { seed: params.seed }),
        },
        signal: this.shutdown.signal,
        metadata: { runId: run.id, caseKey: result.caseKey },
      });
      state.consecutiveProviderFailures = 0;

      const evaluation = evaluateCase(definitionFromSnapshot(snapshot), {
        text: generation.text,
        latencyMs: generation.latencyMs,
        providerInferenceMs: generation.providerInferenceMs,
        servedModel: generation.servedModel,
        expectedModel: run.modelIdentifier,
        acceptedModelNames: provider === this.registry.natlas ? this.registry.natlas.acceptedModelNames : [],
        finishReason: generation.finishReason,
      });

      await this.prisma.evaluationResult.update({
        where: { id: resultId },
        data: {
          executionStatus: 'DONE',
          response: generation.text,
          responseTimeMs: generation.latencyMs,
          providerInferenceMs: generation.providerInferenceMs !== null ? Math.round(generation.providerInferenceMs) : null,
          requestId,
          providerRequestId: generation.providerRequestId,
          responseMetadata: json({
            provider: provider.providerName,
            servedModel: generation.servedModel,
            finishReason: generation.finishReason,
            usage: generation.usage,
            attempts: generation.attempts,
            startedAt: generation.startedAt,
            completedAt: generation.completedAt,
            simulated: generation.simulated,
            providerMetadata: generation.metadata,
          }),
          verdict: evaluation.verdict,
          finalVerdict: evaluation.verdict,
          checks: json(evaluation.checks),
          factChecks: json(evaluation.factChecks),
          languageDetection: evaluation.languageDetection ? json(evaluation.languageDetection) : Prisma.DbNull,
          summary: evaluation.summary,
          requiresReview: evaluation.verdict === 'NEEDS_REVIEW',
          errorDetails: Prisma.DbNull,
          executedAt: new Date(),
        },
      });
    } catch (error) {
      if (ProviderError.is(error) && error.code === 'PROVIDER_CANCELLED') {
        await this.prisma.evaluationResult.update({ where: { id: resultId }, data: { executionStatus: 'PENDING' } });
        return;
      }
      const providerError = ProviderError.is(error) ? error : null;
      if (!providerError) {
        this.logger.error(
          JSON.stringify({ runId: run.id, resultId, message: 'evaluation failed' }),
          error instanceof Error ? error.stack : String(error),
        );
      }
      await this.prisma.evaluationResult.update({
        where: { id: resultId },
        data: {
          executionStatus: 'DONE',
          verdict: 'ERROR',
          finalVerdict: 'ERROR',
          requestId,
          executedAt: new Date(),
          errorDetails: json(
            providerError?.toJSON() ?? { code: 'EVALUATION_FAILED', message: 'Unexpected error while evaluating this case.' },
          ),
        },
      });
      if (!providerError) return;

      if (providerError.code === 'PROVIDER_AUTH_FAILED') {
        state.abort = { status: 'FAILED', error: { code: 'MODEL_PROVIDER_AUTH_FAILED', message: providerError.message } };
      } else if (providerError.code === 'PROVIDER_MODEL_MISMATCH') {
        state.abort = { status: 'FAILED', error: { code: 'UNSUPPORTED_MODEL_CONFIGURATION', message: providerError.message } };
      } else if (AVAILABILITY_ERRORS.has(providerError.code)) {
        state.consecutiveProviderFailures++;
        if (state.consecutiveProviderFailures >= MAX_CONSECUTIVE_PROVIDER_FAILURES) {
          state.abort = {
            status: 'FAILED',
            error: {
              code: 'MODEL_PROVIDER_UNAVAILABLE',
              message: `Stopped after ${state.consecutiveProviderFailures} consecutive provider failures. Last error: ${providerError.message}`,
            },
          };
        }
      }
    }
  }

  private async finish(
    runId: string,
    outcome: { status: RunStatus; error?: { code: string; message: string }; skipPending?: boolean },
  ): Promise<void> {
    if (outcome.skipPending || outcome.status === 'CANCELLED') {
      await this.prisma.evaluationResult.updateMany({
        where: { evaluationRunId: runId, executionStatus: { in: ['PENDING', 'RUNNING'] } },
        data: {
          executionStatus: 'DONE',
          verdict: 'SKIPPED',
          finalVerdict: 'SKIPPED',
          executedAt: new Date(),
          errorDetails: json({
            code: outcome.status === 'CANCELLED' ? 'RUN_CANCELLED' : 'RUN_STOPPED',
            message: outcome.status === 'CANCELLED' ? 'The run was cancelled before this case ran.' : (outcome.error?.message ?? 'The run stopped before this case ran.'),
          }),
        },
      });
    }
    await this.prisma.evaluationRun.update({
      where: { id: runId },
      data: {
        status: outcome.status,
        completedAt: new Date(),
        lockedBy: null,
        ...(outcome.error && { errorDetails: json(outcome.error) }),
      },
    });
    await this.analysis.refreshSummary(runId);
    if (outcome.status !== 'COMPLETED') {
      this.logger.warn(JSON.stringify({ runId, status: outcome.status, error: outcome.error?.code }));
    }
  }
}
