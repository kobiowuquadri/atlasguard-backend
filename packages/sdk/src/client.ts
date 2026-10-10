import { AtlasGuardApiError, AtlasGuardError, AtlasGuardNetworkError, AtlasGuardTimeoutError } from './errors';
import { BenchmarksResource } from './resources/benchmarks';
import { EvaluationsResource } from './resources/evaluations';
import { ProjectsResource } from './resources/projects';
import { ReportsResource } from './resources/reports';
import { SystemResource } from './resources/system';
import type { PageMeta } from './types';

export const SDK_VERSION = '0.1.0';

export interface AtlasGuardOptions {
  /** API root, e.g. `https://atlasguard.example.com/api/v1` (the `/api/v1` suffix is added if missing). */
  baseUrl: string;
  /** AtlasGuard API key (`ag_…`). Keep it server-side. */
  apiKey: string;
  /** Per-request timeout in milliseconds (default 30 000). */
  timeoutMs?: number;
  /** Retries for idempotent requests on network errors, 429 and 5xx (default 2). */
  maxRetries?: number;
  /** Custom fetch implementation (defaults to the global fetch). */
  fetch?: typeof fetch;
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
  /** Return the response body as text instead of unwrapping the JSON envelope. */
  raw?: boolean;
}

interface Envelope<T> {
  success: boolean;
  data: T;
  meta?: PageMeta;
  error?: { code: string; message: string; details?: unknown; requestId?: string };
}

const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS']);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function normalizeBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) throw new AtlasGuardError('baseUrl must start with http:// or https://');
  if (!url.endsWith('/api/v1')) url = `${url}/api/v1`;
  return url;
}

/**
 * Client for the AtlasGuard API.
 *
 * ```ts
 * const atlas = new AtlasGuard({ baseUrl: process.env.ATLASGUARD_BASE_URL!, apiKey: process.env.ATLASGUARD_API_KEY! });
 * const run = await atlas.evaluations.run({ projectId, suiteId: 'nigerian-context-v1', languages: ['en-NG', 'yo'] });
 * ```
 */
export class AtlasGuard {
  readonly projects: ProjectsResource;
  readonly benchmarks: BenchmarksResource;
  readonly evaluations: EvaluationsResource;
  readonly reports: ReportsResource;
  readonly system: SystemResource;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AtlasGuardOptions) {
    if (!options.apiKey) throw new AtlasGuardError('apiKey is required');
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== 'function') throw new AtlasGuardError('No fetch implementation available; pass options.fetch (Node.js 18+ has one built in).');
    this.fetchImpl = f.bind(globalThis);

    this.projects = new ProjectsResource(this);
    this.benchmarks = new BenchmarksResource(this);
    this.evaluations = new EvaluationsResource(this);
    this.reports = new ReportsResource(this);
    this.system = new SystemResource(this);
  }

  /** Never expose the key when the client is logged or inspected. */
  toJSON() {
    return { baseUrl: this.baseUrl, apiKey: `${this.apiKey.slice(0, 6)}…`, timeoutMs: this.timeoutMs };
  }

  /** @internal Performs a request and unwraps `{ success, data, meta }`. */
  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<{ data: T; meta?: PageMeta }> {
    const url = this.buildUrl(path, options.query);
    const retries = IDEMPOTENT.has(method) ? this.maxRetries : 0;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once<T>(method, url, options);
      } catch (error) {
        const retryable =
          error instanceof AtlasGuardNetworkError ||
          error instanceof AtlasGuardTimeoutError ||
          (error instanceof AtlasGuardApiError && (error.status === 429 || error.status >= 500));
        if (!retryable || attempt >= retries || options.signal?.aborted) throw error;
        await sleep(Math.min(500 * 2 ** attempt, 5_000));
      }
    }
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  }

  private async once<T>(method: string, url: string, options: RequestOptions): Promise<{ data: T; meta?: PageMeta }> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    let res: Response;
    let text: string;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: options.raw ? '*/*' : 'application/json',
          'x-atlasguard-sdk': `typescript/${SDK_VERSION}`,
          ...(options.body !== undefined && { 'content-type': 'application/json' }),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      text = await res.text();
    } catch (error) {
      if (timedOut) throw new AtlasGuardTimeoutError(this.timeoutMs);
      if (options.signal?.aborted) throw error;
      throw new AtlasGuardNetworkError(`Could not reach AtlasGuard at ${this.baseUrl}`, { cause: error });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }

    if (res.ok && options.raw) return { data: text as T };
    let body: Envelope<T> | undefined;
    try {
      body = text ? (JSON.parse(text) as Envelope<T>) : undefined;
    } catch {
      body = undefined;
    }
    if (!res.ok || !body?.success) {
      const err = body?.error;
      throw new AtlasGuardApiError(
        res.status,
        err?.code ?? (res.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR'),
        err?.message ?? `AtlasGuard request failed with HTTP ${res.status}`,
        err?.details,
        err?.requestId ?? res.headers.get('x-request-id') ?? undefined,
      );
    }
    return { data: body.data, meta: body.meta };
  }
}
