import { createHash } from 'node:crypto';
import { ProviderError } from './errors';
import type { GenerationRequest, GenerationResponse, ModelInfo, ModelProvider, ProviderHealth } from './types';

export const FIXTURE_MODEL_ID = 'atlasguard-fixture-v1';

export interface FixtureProviderOptions {
  /** Canned responses keyed by benchmark case key. */
  fixtures: Readonly<Record<string, string>>;
  /** Artificial delay so the dashboard can show progress; 0 in tests. */
  delayMs?: number;
}

/**
 * Deterministic, explicitly SIMULATED provider for local development and automated tests.
 * Responses are hand-written fixtures, not model output. Runs using it are flagged
 * `isSimulated`, labelled in the UI, and excluded from competition evidence exports.
 */
export class FixtureProvider implements ModelProvider {
  readonly providerType = 'FIXTURE' as const;
  readonly simulated = true;
  readonly providerName = 'Development fixtures (simulated — not N-ATLaS)';
  readonly modelIdentifier = FIXTURE_MODEL_ID;

  private readonly delayMs: number;

  constructor(private readonly options: FixtureProviderOptions) {
    this.delayMs = options.delayMs ?? 0;
  }

  isConfigured(): boolean {
    return true;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      status: 'available',
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      simulated: true,
      message: 'Development fixtures are available. Output is simulated and is not produced by N-ATLaS.',
    };
  }

  async getModelInfo(): Promise<ModelInfo> {
    return {
      providerType: 'FIXTURE',
      providerName: this.providerName,
      modelIdentifier: FIXTURE_MODEL_ID,
      servedModel: FIXTURE_MODEL_ID,
      revision: null,
      dtype: null,
      quantization: null,
      device: null,
      runtime: 'in-process fixtures',
      contextLength: null,
      simulated: true,
      reportedBy: 'configuration',
    };
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    if (request.signal?.aborted) throw new ProviderError('PROVIDER_CANCELLED', 'Request was cancelled.');
    const key = request.metadata?.caseKey;
    const started = performance.now();
    const startedAt = new Date().toISOString();
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const text =
      key && this.options.fixtures[key] !== undefined
        ? this.options.fixtures[key]!
        : `[SIMULATED FIXTURE] No fixture response is defined for case "${key ?? 'unknown'}".`;
    const digest = createHash('sha256').update(`${key ?? ''}:${text}`).digest('hex').slice(0, 16);
    return {
      requestId: request.requestId,
      providerRequestId: `fixture-${digest}`,
      text,
      servedModel: FIXTURE_MODEL_ID,
      finishReason: 'stop',
      usage: null,
      latencyMs: Math.round(performance.now() - started),
      providerInferenceMs: null,
      startedAt,
      completedAt: new Date().toISOString(),
      attempts: 1,
      simulated: true,
      metadata: { fixture: true },
    };
  }
}
