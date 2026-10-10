import { AtlasGuardError } from '../errors';
import type { ConsistencyGroup, EvaluationResult, EvaluationRun, Language, Page, PageParams, RunInput, RunStatus, Verdict } from '../types';
import { Resource } from './base';

export interface ResultFilters extends PageParams {
  language?: Language;
  verdict?: Verdict;
  category?: string;
  search?: string;
}

export interface WaitOptions {
  /** Polling interval (default 3 000 ms). */
  intervalMs?: number;
  /** Give up after this long (default 30 minutes). */
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (run: EvaluationRun) => void;
}

const TERMINAL: RunStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export class EvaluationsResource extends Resource {
  /** Queues an evaluation run. Cases execute asynchronously; use `waitForCompletion` to poll. */
  async run(input: RunInput, signal?: AbortSignal): Promise<EvaluationRun> {
    const suiteId = await this.client.benchmarks.resolveId(input.suiteId, signal);
    return this.postJson<EvaluationRun>('/evaluations/runs', { ...input, suiteId }, signal);
  }

  list(params: PageParams & { projectId?: string; status?: RunStatus; suiteId?: string } = {}, signal?: AbortSignal): Promise<Page<EvaluationRun>> {
    return this.getPage<EvaluationRun>('/evaluations/runs', { ...params }, signal);
  }

  /** Run details including progress counters and the aggregate summary. */
  get(id: string, signal?: AbortSignal): Promise<EvaluationRun> {
    return this.getJson<EvaluationRun>(`/evaluations/runs/${encodeURIComponent(id)}`, undefined, signal);
  }

  results(id: string, filters: ResultFilters = {}, signal?: AbortSignal): Promise<Page<EvaluationResult>> {
    return this.getPage<EvaluationResult>(`/evaluations/runs/${encodeURIComponent(id)}/results`, { ...filters }, signal);
  }

  /** Iterates every result of a run (all pages). */
  allResults(id: string, filters: Omit<ResultFilters, 'page'> = {}): AsyncGenerator<EvaluationResult> {
    return this.iterate<EvaluationResult>(`/evaluations/runs/${encodeURIComponent(id)}/results`, { ...filters });
  }

  result(runId: string, resultId: string, signal?: AbortSignal): Promise<EvaluationResult & { reviews: unknown[] }> {
    return this.getJson(`/evaluations/runs/${encodeURIComponent(runId)}/results/${encodeURIComponent(resultId)}`, undefined, signal);
  }

  /** Cross-language consistency findings, with each language's response side by side. */
  consistency(id: string, signal?: AbortSignal): Promise<ConsistencyGroup[]> {
    return this.getJson<ConsistencyGroup[]>(`/evaluations/runs/${encodeURIComponent(id)}/consistency`, undefined, signal);
  }

  cancel(id: string, signal?: AbortSignal): Promise<EvaluationRun> {
    return this.postJson<EvaluationRun>(`/evaluations/runs/${encodeURIComponent(id)}/cancel`, {}, signal);
  }

  /** Queues a new run with the same suite, languages, filters and parameters. */
  rerun(id: string, signal?: AbortSignal): Promise<EvaluationRun> {
    return this.postJson<EvaluationRun>(`/evaluations/runs/${encodeURIComponent(id)}/rerun`, {}, signal);
  }

  /** Records a human review decision for a result. */
  review(runId: string, resultId: string, input: { decision: 'PASSED' | 'FAILED'; notes?: string }, signal?: AbortSignal): Promise<EvaluationResult> {
    return this.postJson(`/evaluations/runs/${encodeURIComponent(runId)}/results/${encodeURIComponent(resultId)}/reviews`, input, signal);
  }

  /** Polls a run until it is COMPLETED, FAILED or CANCELLED and returns the final run. */
  async waitForCompletion(id: string, options: WaitOptions = {}): Promise<EvaluationRun> {
    const interval = options.intervalMs ?? 3_000;
    const deadline = Date.now() + (options.timeoutMs ?? 30 * 60_000);
    for (;;) {
      const run = await this.get(id, options.signal);
      options.onProgress?.(run);
      if (TERMINAL.includes(run.status)) return run;
      if (Date.now() + interval > deadline) {
        throw new AtlasGuardError(`Run ${id} did not finish within the wait timeout (status ${run.status})`);
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, interval);
        options.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(options.signal?.reason ?? new AtlasGuardError('aborted'));
          },
          { once: true },
        );
      });
    }
  }
}
