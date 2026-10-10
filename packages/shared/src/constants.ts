/** Overall verdict of one evaluated benchmark case. Technical errors are never merged with failures. */
export const VERDICTS = ['PASSED', 'FAILED', 'NEEDS_REVIEW', 'SKIPPED', 'ERROR'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Outcome of an individual evaluation check. */
export const CHECK_STATUSES = ['pass', 'fail', 'uncertain', 'not_applicable'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const EVALUATION_DIMENSIONS = [
  'response_validity',
  'language_compliance',
  'factual_accuracy',
  'instruction_compliance',
  'latency',
] as const;
export type EvaluationDimension = (typeof EVALUATION_DIMENSIONS)[number];

/** Outcome of checking one expected fact against one response. */
export const FACT_STATUSES = ['supported', 'contradicted', 'not_found', 'uncertain'] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export const RUN_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Review state of benchmark content (prompts, translations, reference facts). */
export const CONTENT_REVIEW_STATUSES = ['draft', 'pending_review', 'verified', 'rejected'] as const;
export type ContentReviewStatus = (typeof CONTENT_REVIEW_STATUSES)[number];

export const CONSISTENCY_VERDICTS = ['CONSISTENT', 'INCONSISTENT', 'NEEDS_REVIEW', 'INSUFFICIENT_DATA'] as const;
export type ConsistencyVerdict = (typeof CONSISTENCY_VERDICTS)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const BENCHMARK_CATEGORIES = [
  'financial_terminology',
  'nigerian_english',
  'education',
  'civic_information',
  'cultural_context',
  'translation_meaning',
] as const;
export type BenchmarkCategory = (typeof BENCHMARK_CATEGORIES)[number];

export const CATEGORY_LABELS: Readonly<Record<BenchmarkCategory, string>> = {
  financial_terminology: 'Nigerian Financial Terminology',
  nigerian_english: 'Nigerian English',
  education: 'Education',
  civic_information: 'Civic Information',
  cultural_context: 'Cultural & Linguistic Context',
  translation_meaning: 'Translation & Meaning Preservation',
};

export const PROVIDER_TYPES = ['NATLAS', 'FIXTURE'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

/** The only model AtlasGuard's real provider is allowed to report. */
export const NATLAS_MODEL_ID = 'NCAIR1/N-ATLaS';

export const NATLAS_ATTRIBUTION =
  'N-ATLaS is an initiative of the Federal Ministry of Communications, Innovation and Digital Economy, and powered by Awarri Technologies.';

/** Stable error codes returned by the AtlasGuard API in `{ success: false, error: { code } }`. */
export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'MODEL_PROVIDER_NOT_CONFIGURED',
  'MODEL_PROVIDER_UNAVAILABLE',
  'MODEL_PROVIDER_TIMEOUT',
  'MODEL_PROVIDER_AUTH_FAILED',
  'UNSUPPORTED_MODEL_CONFIGURATION',
  'EVIDENCE_EXPORT_DISABLED',
  'RUN_NOT_CANCELLABLE',
  'INCOMPATIBLE_RUNS',
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
