/** Base class for every error thrown by the SDK. */
export class AtlasGuardError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AtlasGuardError';
  }
}

/** The API answered with `{ success: false, error }` (or a non-2xx status). */
export class AtlasGuardApiError extends AtlasGuardError {
  constructor(
    /** HTTP status code. */
    readonly status: number,
    /** Stable machine-readable code, e.g. `MODEL_PROVIDER_UNAVAILABLE`. */
    readonly code: string,
    message: string,
    readonly details?: unknown,
    /** Request id to quote when reporting problems. */
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'AtlasGuardApiError';
  }
}

/** The request exceeded the configured timeout. */
export class AtlasGuardTimeoutError extends AtlasGuardError {
  constructor(readonly timeoutMs: number) {
    super(`AtlasGuard request timed out after ${timeoutMs} ms`);
    this.name = 'AtlasGuardTimeoutError';
  }
}

/** The API could not be reached (DNS, connection refused, TLS…). */
export class AtlasGuardNetworkError extends AtlasGuardError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AtlasGuardNetworkError';
  }
}
