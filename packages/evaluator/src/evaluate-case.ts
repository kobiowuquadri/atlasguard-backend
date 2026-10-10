import type {
  CaseEvaluation,
  CheckResult,
  EvaluationRule,
  ExpectedFact,
  FactCheckResult,
  SupportedLanguage,
} from '@atlasguard/shared';
import { checkLanguageCompliance } from './checks/language';
import { checkFact, createFactContext, factToCheck } from './checks/facts';
import { checkInstruction, isInstructionRule } from './checks/instructions';
import { checkLatency } from './checks/latency';
import { checkResponseValidity } from './checks/validity';
import { EVALUATOR_VERSION } from './version';

/** Everything needed to evaluate one response. Mirrors the case snapshot stored per result. */
export interface CaseDefinition {
  key: string;
  language: SupportedLanguage;
  /** Facts that apply to this case (group facts already filtered by factIds). */
  facts: ExpectedFact[];
  rules: EvaluationRule[];
  requiredTerms?: string[];
  forbiddenTerms?: string[];
}

export interface ResponseRecord {
  text: string;
  latencyMs: number;
  providerInferenceMs?: number | null;
  servedModel?: string | null;
  expectedModel?: string | null;
  acceptedModelNames?: readonly string[];
  finishReason?: string | null;
}

/** Folds the convenience `requiredTerms` / `forbiddenTerms` fields into explicit rules. */
export function effectiveRules(def: Pick<CaseDefinition, 'rules' | 'requiredTerms' | 'forbiddenTerms'>): EvaluationRule[] {
  const rules = [...def.rules];
  if (def.requiredTerms?.length) rules.push({ type: 'required_terms', terms: def.requiredTerms, mode: 'all' });
  if (def.forbiddenTerms?.length) rules.push({ type: 'forbidden_terms', terms: def.forbiddenTerms });
  return rules;
}

/**
 * Verdict policy: any determinate failure → FAILED; otherwise any check needing review →
 * NEEDS_REVIEW; otherwise PASSED. Unknown outcomes are never converted into passes.
 */
export function verdictFromChecks(checks: CheckResult[]): CaseEvaluation['verdict'] {
  const applicable = checks.filter((c) => c.status !== 'not_applicable');
  if (applicable.some((c) => c.status === 'fail')) return 'FAILED';
  if (applicable.some((c) => c.status === 'uncertain')) return 'NEEDS_REVIEW';
  return 'PASSED';
}

function summarise(checks: CheckResult[], verdict: CaseEvaluation['verdict']): string {
  const applicable = checks.filter((c) => c.status !== 'not_applicable');
  const passed = applicable.filter((c) => c.status === 'pass').length;
  const failed = applicable.filter((c) => c.status === 'fail').map((c) => c.id);
  const review = applicable.filter((c) => c.status === 'uncertain').map((c) => c.id);
  const parts = [`${passed} of ${applicable.length} applicable checks passed`];
  if (failed.length) parts.push(`failed: ${failed.join(', ')}`);
  if (review.length) parts.push(`needs review: ${review.join(', ')}`);
  return `${verdict}: ${parts.join('; ')}.`;
}

/** Evaluates one successful provider response against its benchmark case. */
export function evaluateCase(def: CaseDefinition, response: ResponseRecord): CaseEvaluation {
  const checks: CheckResult[] = [];
  const factChecks: FactCheckResult[] = [];
  const rules = effectiveRules(def);

  const validity = checkResponseValidity({
    response: response.text,
    servedModel: response.servedModel,
    expectedModel: response.expectedModel,
    acceptedModelNames: response.acceptedModelNames,
    finishReason: response.finishReason,
  });
  checks.push(validity);

  const latencyRule = rules.find((r) => r.type === 'max_latency_ms');
  const latency = checkLatency(response.latencyMs, latencyRule?.value, response.providerInferenceMs);

  // An unusable response cannot be meaningfully checked for language, facts or format.
  if (validity.status === 'fail') {
    checks.push(latency);
    return {
      verdict: 'FAILED',
      checks,
      factChecks,
      languageDetection: null,
      summary: `FAILED: ${validity.explanation}`,
      requiresHumanReview: false,
      evaluatorVersion: EVALUATOR_VERSION,
    };
  }

  const languageRule = rules.find((r) => r.type === 'response_language');
  const language = checkLanguageCompliance({
    response: response.text,
    expected: languageRule?.language ?? def.language,
    allowCodeSwitching: languageRule?.allowCodeSwitching ?? true,
  });
  checks.push(language.check);

  const ctx = createFactContext(response.text, def.language);
  for (const fact of def.facts) {
    const factResult = checkFact(fact, ctx);
    factChecks.push(factResult);
    checks.push(factToCheck(fact, factResult));
  }

  for (const rule of rules) {
    if (isInstructionRule(rule)) checks.push(checkInstruction(rule, response.text, ctx.folded));
  }

  checks.push(latency);

  const verdict = verdictFromChecks(checks);
  return {
    verdict,
    checks,
    factChecks,
    languageDetection: language.detection,
    summary: summarise(checks, verdict),
    requiresHumanReview: checks.some((c) => c.requiresHumanReview),
    evaluatorVersion: EVALUATOR_VERSION,
  };
}
