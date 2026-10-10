import type {
  CheckStatus,
  ConsistencyVerdict,
  EvaluationDimension,
  FactStatus,
  Verdict,
} from './constants';
import type { SupportedLanguage } from './languages';

/** Result of one evaluation check on one response. Stored as JSON on EvaluationResult.checks. */
export interface CheckResult {
  /** Stable identifier, e.g. `response_validity`, `fact:total-amount`, `instruction:json_format`. */
  id: string;
  dimension: EvaluationDimension;
  status: CheckStatus;
  /** Name and version of the method that produced the status, e.g. `numeric-extraction/v1`. */
  method: string;
  explanation: string;
  /** Excerpt of the response supporting the finding, when there is one. */
  evidence?: string;
  requiresHumanReview: boolean;
  details?: Record<string, unknown>;
}

export type FactType = 'numeric' | 'entity' | 'concept';

/** Result of checking one expected fact against one response. */
export interface FactCheckResult {
  factId: string;
  factType: FactType;
  required: boolean;
  status: FactStatus;
  method: string;
  evidence?: string;
  explanation?: string;
  /**
   * Values the response asserted for this fact: numbers for numeric facts, the matched
   * surface form for entity facts. Used for cross-language comparison.
   */
  assertedValues?: Array<string | number>;
  requiresHumanReview: boolean;
}

export type DetectedLanguage = SupportedLanguage | 'pcm' | 'unknown';

export interface LanguageDetectionResult {
  detected: DetectedLanguage;
  /** Heuristic confidence in [0, 1]; not a calibrated probability. */
  confidence: number;
  /** Share of lexical evidence per language, in [0, 1]. */
  shares: Partial<Record<DetectedLanguage, number>>;
  method: string;
  evidence: string[];
  wordCount: number;
  codeSwitching: boolean;
}

export interface CaseEvaluation {
  verdict: Exclude<Verdict, 'SKIPPED' | 'ERROR'>;
  checks: CheckResult[];
  factChecks: FactCheckResult[];
  languageDetection: LanguageDetectionResult | null;
  summary: string;
  requiresHumanReview: boolean;
  evaluatorVersion: string;
}

export const CONSISTENCY_FINDING_TYPES = [
  'numeric_conflict',
  'entity_conflict',
  'possible_contradiction',
  'fact_omission',
  'uncertain_fact',
  'missing_response',
  'consistent_fact',
  'consistent_error',
] as const;
export type ConsistencyFindingType = (typeof CONSISTENCY_FINDING_TYPES)[number];

export interface ConsistencyFinding {
  type: ConsistencyFindingType;
  /** `conflict` = confirmed contradiction between languages; `omission` = missing fact (not a contradiction). */
  severity: 'conflict' | 'omission' | 'review' | 'info';
  factId?: string;
  languages: SupportedLanguage[];
  message: string;
  values?: Partial<Record<SupportedLanguage, Array<string | number>>>;
  statuses?: Partial<Record<SupportedLanguage, FactStatus | 'no_response'>>;
}

export interface ConsistencySummary {
  sharedFactsChecked: number;
  confirmedContradictions: number;
  missingFacts: number;
  uncertainFindings: number;
  consistentFacts: number;
}

export interface ConsistencyAnalysis {
  semanticGroupKey: string;
  languagesCompared: SupportedLanguage[];
  languagesMissing: SupportedLanguage[];
  verdict: ConsistencyVerdict;
  findings: ConsistencyFinding[];
  summary: ConsistencySummary;
  method: string;
  evaluatorVersion: string;
}

/** Counts used everywhere AtlasGuard reports results. Pass rate excludes unresolved outcomes. */
export interface ResultBucket {
  total: number;
  passed: number;
  failed: number;
  needsReview: number;
  skipped: number;
  errors: number;
  pending: number;
  /** passed + failed: results with a determinate verdict. */
  determinate: number;
  /** passed / determinate, or null when nothing is determinate. */
  verifiedPassRate: number | null;
  /** Mean round-trip latency of results that produced a response, or null. */
  averageLatencyMs: number | null;
  medianLatencyMs: number | null;
}
