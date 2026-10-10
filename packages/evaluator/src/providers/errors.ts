export const PROVIDER_ERROR_CODES = [
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_AUTH_FAILED',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_BAD_REQUEST',
  'PROVIDER_INVALID_RESPONSE',
  'PROVIDER_MODEL_MISMATCH',
  'PROVIDER_CANCELLED',
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export interface ProviderErrorOptions {
  retryable?: boolean;
  status?: number;
  retryAfterMs?: number;
  cause?: unknown;
}

/** A classified provider failure. These are technical errors, never evaluation failures. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  attempts = 1;

  constructor(code: ProviderErrorCode, message: string, options: ProviderErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }

  static is(error: unknown): error is ProviderError {
    return error instanceof ProviderError;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      status: this.status,
      attempts: this.attempts,
    };
  }
}
