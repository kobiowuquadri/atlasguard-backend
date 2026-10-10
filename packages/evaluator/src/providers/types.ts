import type { ProviderType } from '@atlasguard/shared';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerationParameters {
  temperature: number;
  maxTokens: number;
  topP?: number;
  repetitionPenalty?: number;
  seed?: number;
}

export interface GenerationRequest {
  /** AtlasGuard-generated id, sent to the provider as X-Request-Id. */
  requestId: string;
  messages: ChatMessage[];
  parameters: GenerationParameters;
  signal?: AbortSignal;
  metadata?: { runId?: string; caseKey?: string };
}

export interface TokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface GenerationResponse {
  requestId: string;
  /** Id the provider assigned to the completion, if any. */
  providerRequestId: string | null;
  text: string;
  /** Model name the endpoint reported for this completion. */
  servedModel: string;
  finishReason: string | null;
  usage: TokenUsage | null;
  /** Round trip measured by AtlasGuard: request start → complete response body. */
  latencyMs: number;
  /** Generation time reported by the provider itself, when available. */
  providerInferenceMs: number | null;
  startedAt: string;
  completedAt: string;
  attempts: number;
  /** True only for development fixtures. Never true for N-ATLaS. */
  simulated: boolean;
  /** Extra provenance reported by the endpoint (e.g. model revision, quantization). */
  metadata: Record<string, unknown>;
}

export type ProviderHealthStatus = 'available' | 'unavailable' | 'not_configured';

export interface ProviderHealth {
  status: ProviderHealthStatus;
  checkedAt: string;
  latencyMs: number | null;
  message: string;
  simulated: boolean;
  details?: Record<string, unknown>;
}

export interface ModelInfo {
  providerType: ProviderType;
  providerName: string;
  /** The model AtlasGuard is configured to evaluate. */
  modelIdentifier: string;
  /** The model name the endpoint says it serves, when it could be queried. */
  servedModel: string | null;
  revision: string | null;
  dtype: string | null;
  quantization: string | null;
  device: string | null;
  runtime: string | null;
  contextLength: number | null;
  simulated: boolean;
  /** Whether the details came from the live endpoint or only from configuration. */
  reportedBy: 'provider' | 'configuration';
}

export interface ModelProvider {
  readonly providerName: string;
  readonly providerType: ProviderType;
  readonly simulated: boolean;
  readonly modelIdentifier: string;
  isConfigured(): boolean;
  healthCheck(): Promise<ProviderHealth>;
  generate(request: GenerationRequest): Promise<GenerationResponse>;
  getModelInfo(): Promise<ModelInfo>;
}
