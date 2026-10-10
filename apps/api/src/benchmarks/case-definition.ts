import type { BenchmarkCase, SemanticGroup } from '@prisma/client';
import type { CaseDefinition } from '@atlasguard/evaluator';
import type { EvaluationRule, ExpectedFact, SupportedLanguage } from '@atlasguard/shared';

type CaseWithGroup = BenchmarkCase & { semanticGroup: SemanticGroup | null };

/** The facts that apply to a case: its group's facts filtered by factIds, or its own. */
export function resolveCaseFacts(c: CaseWithGroup): ExpectedFact[] {
  if (c.semanticGroup) {
    const ids = new Set(c.factIds);
    return (c.semanticGroup.expectedFacts as unknown as ExpectedFact[]).filter((f) => ids.has(f.id));
  }
  return c.expectedFacts as unknown as ExpectedFact[];
}

/**
 * Immutable snapshot stored on every EvaluationResult, so a run can always be re-checked
 * against exactly what was evaluated even if the benchmark case changes later.
 */
export interface CaseSnapshot {
  caseKey: string;
  title: string;
  revision: number;
  language: SupportedLanguage;
  category: string;
  difficulty: string;
  reviewStatus: string;
  semanticGroupKey: string | null;
  semanticGroupTitle: string | null;
  facts: ExpectedFact[];
  rules: EvaluationRule[];
  requiredTerms: string[];
  forbiddenTerms: string[];
  provenance: unknown;
}

export function snapshotCase(c: CaseWithGroup): CaseSnapshot {
  return {
    caseKey: c.key,
    title: c.title,
    revision: c.revision,
    language: c.language as SupportedLanguage,
    category: c.category,
    difficulty: c.difficulty,
    reviewStatus: c.reviewStatus,
    semanticGroupKey: c.semanticGroup?.key ?? null,
    semanticGroupTitle: c.semanticGroup?.title ?? null,
    facts: resolveCaseFacts(c),
    rules: c.evaluationRules as unknown as EvaluationRule[],
    requiredTerms: c.requiredTerms,
    forbiddenTerms: c.forbiddenTerms,
    provenance: c.provenance,
  };
}

export function definitionFromSnapshot(snapshot: CaseSnapshot): CaseDefinition {
  return {
    key: snapshot.caseKey,
    language: snapshot.language,
    facts: snapshot.facts,
    rules: snapshot.rules,
    requiredTerms: snapshot.requiredTerms,
    forbiddenTerms: snapshot.forbiddenTerms,
  };
}
