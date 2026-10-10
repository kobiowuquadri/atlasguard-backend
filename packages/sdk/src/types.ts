/** Public types of the AtlasGuard API, as returned inside `{ success: true, data }`. */

export type Language = 'en-NG' | 'yo' | 'ha' | 'ig';
export type Verdict = 'PASSED' | 'FAILED' | 'NEEDS_REVIEW' | 'SKIPPED' | 'ERROR';
export type RunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type ConsistencyVerdict = 'CONSISTENT' | 'INCONSISTENT' | 'NEEDS_REVIEW' | 'INSUFFICIENT_DATA';
export type FactStatus = 'supported' | 'contradicted' | 'not_found' | 'uncertain';
export type ExportFormat = 'json' | 'csv' | 'markdown';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Page<T> {
  items: T[];
  meta: PageMeta;
}

export interface PageParams {
  page?: number;
  pageSize?: number;
}

export interface ResultBucket {
  total: number;
  passed: number;
  failed: number;
  needsReview: number;
  skipped: number;
  errors: number;
  pending: number;
  determinate: number;
  /** PASSED / (PASSED + FAILED); null when nothing is decided. */
  verifiedPassRate: number | null;
  averageLatencyMs: number | null;
  medianLatencyMs: number | null;
}

export interface RunSummary {
  overall: ResultBucket;
  byLanguage: Record<string, ResultBucket>;
  byCategory: Record<string, ResultBucket>;
  byLanguageCategory: Record<string, Record<string, ResultBucket>>;
  consistency: { groups: number; byVerdict: Partial<Record<ConsistencyVerdict, number>>; confirmedContradictions: number };
  humanReviewed: number;
  computedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  runCount?: number;
}

export interface BenchmarkSuite {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  version: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  isOfficial: boolean;
  contentHash: string;
  stats: {
    caseCount: number;
    semanticGroupCount: number;
    languages: Record<string, number>;
    categories: Record<string, number>;
    reviewStatus: Record<string, number>;
    verifiedCount: number;
    unreviewedCount: number;
  };
}

export interface ExpectedFact {
  id: string;
  type: 'numeric' | 'entity' | 'concept';
  description: string;
  required: boolean;
  [key: string]: unknown;
}

export interface BenchmarkCase {
  id: string;
  key: string;
  title: string;
  language: Language;
  category: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  prompt: string;
  reviewStatus: 'DRAFT' | 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
  provenance: Record<string, unknown>;
  facts: ExpectedFact[];
  semanticGroup: { id: string; key: string; title: string } | null;
}

export interface InferenceParameters {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  repetitionPenalty?: number;
  seed?: number;
  /** Empty string sends no system prompt; omit to use the model's default. */
  systemPrompt?: string;
}

export interface RunInput {
  projectId: string;
  /** Suite id, or its slug (e.g. "nigerian-context-v1") which the SDK resolves to the latest visible version. */
  suiteId: string;
  languages: Language[];
  categories?: string[];
  caseIds?: string[];
  onlyVerified?: boolean;
  /** Defaults to the server's N-ATLaS configuration. */
  modelConfigurationId?: string;
  parameters?: InferenceParameters;
}

export interface EvaluationRun {
  id: string;
  projectId: string;
  benchmarkSuiteId: string;
  benchmarkVersion: string;
  benchmarkContentHash: string;
  providerType: 'NATLAS' | 'FIXTURE';
  modelIdentifier: string;
  modelRevision: string | null;
  /** True when the run used development fixtures (never N-ATLaS output). */
  isSimulated: boolean;
  inferenceConfig: Record<string, unknown>;
  evaluatorVersion: string;
  languages: Language[];
  status: RunStatus;
  totalCases: number;
  completedCases: number;
  failedCases: number;
  summary: RunSummary | null;
  errorDetails: { code: string; message: string } | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  progress?: { total: number; pending: number; running: number; done: number; byVerdict: Partial<Record<Verdict, number>> };
}

export interface CheckResult {
  id: string;
  dimension: string;
  status: 'pass' | 'fail' | 'uncertain' | 'not_applicable';
  method: string;
  explanation: string;
  evidence?: string;
  requiresHumanReview: boolean;
}

export interface FactCheckResult {
  factId: string;
  factType: 'numeric' | 'entity' | 'concept';
  status: FactStatus;
  method: string;
  evidence?: string;
  explanation?: string;
  assertedValues?: Array<string | number>;
  requiresHumanReview: boolean;
}

export interface EvaluationResult {
  id: string;
  caseKey: string;
  language: Language;
  category: string;
  prompt: string;
  /** Exact text returned by the model, or null if the case errored or did not run. */
  response: string | null;
  responseTimeMs: number | null;
  providerInferenceMs: number | null;
  verdict: Verdict | null;
  finalVerdict: Verdict | null;
  checks: CheckResult[] | null;
  factChecks: FactCheckResult[] | null;
  summary: string | null;
  errorDetails: { code: string; message: string } | null;
  executedAt: string | null;
}

export interface ConsistencyFinding {
  type: string;
  severity: 'conflict' | 'omission' | 'review' | 'info';
  factId?: string;
  languages: Language[];
  message: string;
  values?: Partial<Record<Language, Array<string | number>>>;
}

export interface ConsistencyGroup {
  semanticGroupKey: string;
  title: string;
  verdict: ConsistencyVerdict;
  languagesCompared: Language[];
  languagesMissing: Language[];
  summary: { sharedFactsChecked: number; confirmedContradictions: number; missingFacts: number; uncertainFindings: number; consistentFacts: number };
  findings: ConsistencyFinding[];
  entries: Array<{ language: Language; prompt: string; response: string | null; finalVerdict: Verdict | null; factChecks: FactCheckResult[] | null }>;
}

export interface ModelStatus {
  natlas: { configured: boolean; health: { status: 'available' | 'unavailable' | 'not_configured'; message: string; checkedAt: string }; model: Record<string, unknown> };
  fixtures: { enabled: boolean };
  attribution: string;
}
