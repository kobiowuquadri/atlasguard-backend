import { NATLAS_MODEL_ID } from '@atlasguard/shared';
import { ProviderError } from './errors';
import { Semaphore } from './semaphore';
import type {
  GenerationRequest,
  GenerationResponse,
  ModelInfo,
  ModelProvider,
  ProviderHealth,
  TokenUsage,
} from './types';

export interface NatlasProviderOptions {
  /** Root URL of an N-ATLaS inference endpoint exposing `/v1/chat/completions`. */
  baseUrl?: string | null;
  /** Bearer token for the endpoint. Never logged or returned. */
  apiKey?: string | null;
  /** Model that must be reported by the endpoint. Defaults to NCAIR1/N-ATLaS. */
  modelId?: string;
  /** Extra served-model names that refer to the same N-ATLaS weights (e.g. vLLM --served-model-name). */
  acceptedModelNames?: string[];
  timeoutMs?: number;
  healthTimeoutMs?: number;
  /** Retries for transient failures only (network, timeout, 429, 5xx). */
  maxRetries?: number;
  retryBaseDelayMs?: number;
  maxConcurrency?: number;
  healthPath?: string;
  providerName?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface RawResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  body: string;
}

interface ParsedCompletion {
  id: string | null;
  model: string;
  content: string;
  finishReason: string | null;
  usage: TokenUsage | null;
  extension: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

export function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('N-ATLaS base URL must use http or https');
  }
  if (url.username || url.password) {
    throw new Error('N-ATLaS base URL must not embed credentials; use NATLAS_API_KEY');
  }
  let normalized = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  if (normalized.endsWith('/v1')) normalized = normalized.slice(0, -3);
  return normalized;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.min(Math.max(date - Date.now(), 0), 30_000) : undefined;
}

function describeNetworkError(error: unknown): string {
  const cause = isRecord(error) && isRecord(error.cause) ? error.cause : null;
  const code = cause && typeof cause.code === 'string' ? cause.code : null;
  if (code) return code;
  return error instanceof Error ? error.message : 'network error';
}

/** Validates an OpenAI-style chat completion body and extracts what AtlasGuard records. */
export function parseChatCompletion(json: unknown): ParsedCompletion {
  const invalid = (reason: string) =>
    new ProviderError('PROVIDER_INVALID_RESPONSE', `N-ATLaS endpoint returned an unexpected response: ${reason}.`);
  if (!isRecord(json)) throw invalid('body is not a JSON object');
  const model = stringOrNull(json.model);
  if (!model) throw invalid('missing "model" field, so the producing model cannot be verified');
  if (!Array.isArray(json.choices) || json.choices.length === 0) throw invalid('no choices returned');
  const first = json.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) throw invalid('choices[0].message is missing');
  const content = first.message.content;
  if (typeof content !== 'string') throw invalid('choices[0].message.content is not text');
  const usage = isRecord(json.usage)
    ? {
        promptTokens: numberOrNull(json.usage.prompt_tokens),
        completionTokens: numberOrNull(json.usage.completion_tokens),
        totalTokens: numberOrNull(json.usage.total_tokens),
      }
    : null;
  return {
    id: stringOrNull(json.id),
    model,
    content,
    finishReason: stringOrNull(first.finish_reason),
    usage,
    extension: isRecord(json.atlasguard) ? json.atlasguard : {},
  };
}

/**
 * Adapter for a real N-ATLaS inference endpoint that speaks the OpenAI chat-completions
 * protocol (AtlasGuard's own `services/natlas-inference`, or vLLM/TGI serving the official
 * weights). It never substitutes another model: if the endpoint reports a different model
 * the request fails with PROVIDER_MODEL_MISMATCH.
 */
export class NatlasProvider implements ModelProvider {
  readonly providerType = 'NATLAS' as const;
  readonly simulated = false;
  readonly providerName: string;
  readonly modelIdentifier: string;

  private readonly apiRoot: string | null;
  private readonly apiKey: string | null;
  private readonly acceptedModels: Set<string>;
  private readonly timeoutMs: number;
  private readonly healthTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly healthPath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly semaphore: Semaphore;

  constructor(options: NatlasProviderOptions = {}) {
    this.apiRoot = options.baseUrl ? normalizeBaseUrl(options.baseUrl) : null;
    this.apiKey = options.apiKey || null;
    this.modelIdentifier = options.modelId ?? NATLAS_MODEL_ID;
    this.acceptedModels = new Set(
      [this.modelIdentifier, ...(options.acceptedModelNames ?? [])].map((m) => m.trim().toLowerCase()).filter(Boolean),
    );
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 10_000;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;
    this.healthPath = options.healthPath ?? '/health';
    this.providerName = options.providerName ?? 'N-ATLaS (self-hosted endpoint)';
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.semaphore = new Semaphore(Math.max(1, options.maxConcurrency ?? 2));
  }

  get acceptedModelNames(): string[] {
    return [...this.acceptedModels];
  }

  isConfigured(): boolean {
    return this.apiRoot !== null;
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    let release: () => void;
    try {
      release = await this.semaphore.acquire(request.signal);
    } catch (error) {
      throw new ProviderError('PROVIDER_CANCELLED', 'Request was cancelled before it started.', { cause: error });
    }
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          return await this.generateOnce(request, attempt);
        } catch (error) {
          const providerError = ProviderError.is(error)
            ? error
            : new ProviderError('PROVIDER_UNAVAILABLE', 'Unexpected provider failure.', { retryable: false, cause: error });
          providerError.attempts = attempt;
          if (!providerError.retryable || attempt > this.maxRetries || request.signal?.aborted) throw providerError;
          await this.sleep(this.backoff(attempt, providerError.retryAfterMs));
        }
      }
    } finally {
      release();
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.apiRoot) {
      return {
        status: 'not_configured',
        checkedAt,
        latencyMs: null,
        simulated: false,
        message: 'No N-ATLaS endpoint is configured (NATLAS_BASE_URL is empty).',
      };
    }
    const started = performance.now();
    try {
      const res = await this.request(this.healthPath, { method: 'GET' }, this.healthTimeoutMs);
      const latencyMs = Math.round(performance.now() - started);
      let details: Record<string, unknown> | undefined;
      try {
        const parsed: unknown = JSON.parse(res.body);
        if (isRecord(parsed)) details = parsed;
      } catch {
        details = undefined;
      }
      if (!res.ok) {
        return {
          status: 'unavailable',
          checkedAt,
          latencyMs,
          simulated: false,
          message: `Health check returned HTTP ${res.status}.`,
        };
      }
      if (details && details.model_loaded === false) {
        return {
          status: 'unavailable',
          checkedAt,
          latencyMs,
          simulated: false,
          message: 'Endpoint is up but the N-ATLaS model is still loading.',
          details,
        };
      }
      return {
        status: 'available',
        checkedAt,
        latencyMs,
        simulated: false,
        message: 'N-ATLaS endpoint is reachable.',
        details,
      };
    } catch (error) {
      return {
        status: 'unavailable',
        checkedAt,
        latencyMs: null,
        simulated: false,
        message: error instanceof Error ? error.message : 'N-ATLaS endpoint is unreachable.',
      };
    }
  }

  async getModelInfo(): Promise<ModelInfo> {
    const info: ModelInfo = {
      providerType: 'NATLAS',
      providerName: this.providerName,
      modelIdentifier: this.modelIdentifier,
      servedModel: null,
      revision: null,
      dtype: null,
      quantization: null,
      device: null,
      runtime: null,
      contextLength: null,
      simulated: false,
      reportedBy: 'configuration',
    };
    if (!this.apiRoot) return info;

    try {
      const res = await this.request('/v1/models', { method: 'GET' }, this.healthTimeoutMs);
      const parsed: unknown = res.ok ? JSON.parse(res.body) : null;
      if (isRecord(parsed) && Array.isArray(parsed.data)) {
        const ids = parsed.data.map((m) => (isRecord(m) ? stringOrNull(m.id) : null)).filter((id): id is string => !!id);
        info.servedModel = ids.find((id) => this.acceptedModels.has(id.toLowerCase())) ?? ids[0] ?? null;
        info.reportedBy = 'provider';
      }
    } catch {
      // Model listing is optional; health and generation report problems separately.
    }

    try {
      const res = await this.request('/model-info', { method: 'GET' }, this.healthTimeoutMs);
      const parsed: unknown = res.ok ? JSON.parse(res.body) : null;
      if (isRecord(parsed)) {
        info.revision = stringOrNull(parsed.revision);
        info.dtype = stringOrNull(parsed.dtype);
        info.quantization = stringOrNull(parsed.quantization);
        info.device = stringOrNull(parsed.device);
        info.runtime = stringOrNull(parsed.runtime);
        info.contextLength = numberOrNull(parsed.context_length);
        info.servedModel ??= stringOrNull(parsed.model_id);
        info.reportedBy = 'provider';
      }
    } catch {
      // /model-info is an AtlasGuard extension; other servers (vLLM, TGI) do not expose it.
    }
    return info;
  }

  private async generateOnce(request: GenerationRequest, attempt: number): Promise<GenerationResponse> {
    const p = request.parameters;
    const body = {
      model: this.modelIdentifier,
      messages: request.messages,
      temperature: p.temperature,
      max_tokens: p.maxTokens,
      ...(p.topP !== undefined && { top_p: p.topP }),
      ...(p.repetitionPenalty !== undefined && { repetition_penalty: p.repetitionPenalty }),
      ...(p.seed !== undefined && { seed: p.seed }),
      stream: false,
    };
    const startedAt = new Date();
    const started = performance.now();
    const res = await this.request(
      '/v1/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', 'x-request-id': request.requestId },
      },
      this.timeoutMs,
      request.signal,
    );
    const latencyMs = Math.round(performance.now() - started);
    if (!res.ok) throw this.httpError(res);

    let json: unknown;
    try {
      json = JSON.parse(res.body);
    } catch (error) {
      throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'N-ATLaS endpoint returned a non-JSON body.', {
        status: res.status,
        cause: error,
      });
    }
    const completion = parseChatCompletion(json);
    if (!this.acceptedModels.has(completion.model.toLowerCase())) {
      throw new ProviderError(
        'PROVIDER_MODEL_MISMATCH',
        `Endpoint reported model "${completion.model}" but AtlasGuard is configured to evaluate "${this.modelIdentifier}". The response was discarded.`,
      );
    }

    return {
      requestId: request.requestId,
      providerRequestId: completion.id ?? res.headers.get('x-request-id'),
      text: completion.content,
      servedModel: completion.model,
      finishReason: completion.finishReason,
      usage: completion.usage,
      latencyMs,
      providerInferenceMs: numberOrNull(completion.extension.inference_ms),
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      attempts: attempt,
      simulated: false,
      metadata: completion.extension,
    };
  }

  private async request(
    path: string,
    init: { method: 'GET' | 'POST'; body?: string; headers?: Record<string, string> },
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<RawResponse> {
    if (!this.apiRoot) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'N-ATLaS endpoint is not configured (set NATLAS_BASE_URL).');
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const headers: Record<string, string> = { accept: 'application/json', ...init.headers };
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
      const res = await this.fetchImpl(`${this.apiRoot}${path}`, {
        method: init.method,
        headers,
        body: init.body,
        signal: controller.signal,
        redirect: 'error',
      });
      const body = await res.text();
      return { status: res.status, ok: res.ok, headers: res.headers, body };
    } catch (error) {
      if (timedOut) {
        throw new ProviderError('PROVIDER_TIMEOUT', `N-ATLaS endpoint did not respond within ${timeoutMs} ms.`, {
          retryable: true,
          cause: error,
        });
      }
      if (signal?.aborted) {
        throw new ProviderError('PROVIDER_CANCELLED', 'Request was cancelled.', { cause: error });
      }
      throw new ProviderError('PROVIDER_UNAVAILABLE', `Could not reach the N-ATLaS endpoint (${describeNetworkError(error)}).`, {
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private httpError(res: RawResponse): ProviderError {
    let detail = res.body.replace(/\s+/g, ' ').trim();
    if (this.apiKey) detail = detail.split(this.apiKey).join('[redacted]');
    detail = detail.slice(0, 300);
    const suffix = detail ? `: ${detail}` : '';
    const status = res.status;
    if (status === 401 || status === 403) {
      return new ProviderError('PROVIDER_AUTH_FAILED', `N-ATLaS endpoint rejected AtlasGuard's credentials (HTTP ${status}).`, { status });
    }
    if (status === 429) {
      return new ProviderError('PROVIDER_RATE_LIMITED', 'N-ATLaS endpoint is rate limiting requests (HTTP 429).', {
        status,
        retryable: true,
        retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
      });
    }
    if (status === 408) {
      return new ProviderError('PROVIDER_TIMEOUT', 'N-ATLaS endpoint timed out (HTTP 408).', { status, retryable: true });
    }
    if (status >= 500) {
      return new ProviderError('PROVIDER_UNAVAILABLE', `N-ATLaS endpoint error (HTTP ${status})${suffix}`, { status, retryable: true });
    }
    return new ProviderError('PROVIDER_BAD_REQUEST', `N-ATLaS endpoint rejected the request (HTTP ${status})${suffix}`, { status });
  }

  private backoff(attempt: number, retryAfterMs: number | null): number {
    const exponential = Math.min(this.retryBaseDelayMs * 2 ** (attempt - 1), 15_000);
    const jitter = Math.floor(Math.random() * 250);
    return Math.max(exponential + jitter, retryAfterMs ?? 0);
  }
}
