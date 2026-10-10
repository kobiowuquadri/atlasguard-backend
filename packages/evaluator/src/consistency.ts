import {
  LANGUAGES,
  type ConsistencyAnalysis,
  type ConsistencyFinding,
  type ConsistencySummary,
  type ExpectedFact,
  type FactCheckResult,
  type FactStatus,
  type SupportedLanguage,
} from '@atlasguard/shared';
import { EVALUATOR_VERSION, METHODS } from './version';

/** One language variant's outcome inside a semantic group. */
export interface ConsistencyEntry {
  language: SupportedLanguage;
  /** False when the variant errored, was skipped or has not run. */
  hasResponse: boolean;
  factChecks: FactCheckResult[];
}

export interface ConsistencyGroup {
  key: string;
  facts: ExpectedFact[];
}

const label = (lang: SupportedLanguage) => LANGUAGES[lang].name;
const ORDER = Object.keys(LANGUAGES);
const byLanguage = (a: SupportedLanguage, b: SupportedLanguage) => ORDER.indexOf(a) - ORDER.indexOf(b);
const list = (langs: SupportedLanguage[]) => langs.map(label).join(', ');

function valueLabel(value: string | number): string {
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString('en-NG') : String(value);
  return value.startsWith('conflict:') ? value.slice('conflict:'.length) : value;
}

/**
 * Compares fact-check outcomes for equivalent prompts across languages.
 *
 * - Numeric and entity facts are deterministic: two languages asserting different values
 *   is a *confirmed* conflict.
 * - Concept facts are lexical: a support/contradiction split is only a *possible*
 *   contradiction and goes to review.
 * - A fact present in one language but missing in another is an omission, which is
 *   reported separately and never counted as a contradiction.
 */
export function analyzeConsistency(
  group: ConsistencyGroup,
  entries: ConsistencyEntry[],
  expectedLanguages: SupportedLanguage[] = entries.map((e) => e.language),
): ConsistencyAnalysis {
  const findings: ConsistencyFinding[] = [];
  const summary: ConsistencySummary = {
    sharedFactsChecked: 0,
    confirmedContradictions: 0,
    missingFacts: 0,
    uncertainFindings: 0,
    consistentFacts: 0,
  };

  const answered = entries.filter((e) => e.hasResponse);
  const answeredLanguages = answered.map((e) => e.language);
  const missingLanguages = expectedLanguages.filter((l) => !answeredLanguages.includes(l));

  for (const lang of missingLanguages) {
    findings.push({
      type: 'missing_response',
      severity: 'review',
      languages: [lang],
      message: `No usable ${label(lang)} response (error, skipped or not run), so it was excluded from the comparison.`,
      statuses: { [lang]: 'no_response' },
    });
  }

  const result = (verdict: ConsistencyAnalysis['verdict']): ConsistencyAnalysis => ({
    semanticGroupKey: group.key,
    languagesCompared: answeredLanguages,
    languagesMissing: missingLanguages,
    verdict,
    findings,
    summary,
    method: METHODS.consistency,
    evaluatorVersion: EVALUATOR_VERSION,
  });

  if (answered.length < 2) return result('INSUFFICIENT_DATA');

  for (const fact of group.facts) {
    const perLanguage = new Map<SupportedLanguage, FactCheckResult>();
    for (const entry of answered) {
      const check = entry.factChecks.find((f) => f.factId === fact.id);
      if (check) perLanguage.set(entry.language, check);
    }
    if (perLanguage.size < 2) continue;
    summary.sharedFactsChecked++;

    const langs = [...perLanguage.keys()].sort(byLanguage);
    const byStatus = (status: FactStatus) => langs.filter((l) => perLanguage.get(l)!.status === status);
    const supported = byStatus('supported');
    const contradicted = byStatus('contradicted');
    const notFound = byStatus('not_found');
    const uncertain = byStatus('uncertain');
    const statuses = Object.fromEntries(langs.map((l) => [l, perLanguage.get(l)!.status])) as ConsistencyFinding['statuses'];
    let conflictFound = false;

    if (fact.type === 'numeric' || fact.type === 'entity') {
      // Each determinate status carries exactly one asserted value.
      const asserted = [...supported, ...contradicted].sort(byLanguage).map((l) => ({
        lang: l,
        value: perLanguage.get(l)!.assertedValues?.[0],
      }));
      const values = Object.fromEntries(
        asserted.filter((a) => a.value !== undefined).map((a) => [a.lang, [a.value!]]),
      ) as ConsistencyFinding['values'];
      const distinct = new Set(asserted.map((a) => String(a.value)));

      if (distinct.size > 1) {
        conflictFound = true;
        summary.confirmedContradictions++;
        findings.push({
          type: fact.type === 'numeric' ? 'numeric_conflict' : 'entity_conflict',
          severity: 'conflict',
          factId: fact.id,
          languages: asserted.map((a) => a.lang),
          message: `Conflicting ${fact.type === 'numeric' ? 'values' : 'entities'} for "${fact.description}": ${asserted
            .map((a) => `${label(a.lang)} states ${valueLabel(a.value!)}`)
            .join('; ')}.`,
          values,
          statuses,
        });
      } else if (asserted.length >= 2 && contradicted.length === asserted.length) {
        findings.push({
          type: 'consistent_error',
          severity: 'info',
          factId: fact.id,
          languages: contradicted,
          message: `${list(contradicted)} agree with each other on ${valueLabel(asserted[0]!.value!)}, but this contradicts the reference fact "${fact.description}".`,
          values,
          statuses,
        });
      }
    } else if (supported.length > 0 && contradicted.length > 0) {
      summary.uncertainFindings++;
      findings.push({
        type: 'possible_contradiction',
        severity: 'review',
        factId: fact.id,
        languages: [...supported, ...contradicted],
        message: `"${fact.description}" is supported in ${list(supported)} but possibly contradicted in ${list(contradicted)} (lexical evidence; needs review).`,
        statuses,
      });
    }

    if (notFound.length > 0) {
      summary.missingFacts += notFound.length;
      const presentElsewhere = supported.length + contradicted.length > 0;
      findings.push({
        type: 'fact_omission',
        severity: 'omission',
        factId: fact.id,
        languages: notFound,
        message: presentElsewhere
          ? `"${fact.description}" was not found in ${list(notFound)} although it was addressed in ${list([...supported, ...contradicted])}. An omission is not a contradiction.`
          : `"${fact.description}" was not found in any compared language (${list(notFound)}).`,
        statuses,
      });
    }

    if (uncertain.length > 0) {
      summary.uncertainFindings++;
      findings.push({
        type: 'uncertain_fact',
        severity: 'review',
        factId: fact.id,
        languages: uncertain,
        message: `Automated checks could not decide "${fact.description}" for ${list(uncertain)}; human review required.`,
        statuses,
      });
    }

    if (!conflictFound && supported.length === langs.length) {
      summary.consistentFacts++;
      findings.push({
        type: 'consistent_fact',
        severity: 'info',
        factId: fact.id,
        languages: supported,
        message: `"${fact.description}" is supported consistently in ${list(supported)}.`,
        statuses,
      });
    }
  }

  if (summary.sharedFactsChecked === 0) return result('INSUFFICIENT_DATA');
  if (summary.confirmedContradictions > 0) return result('INCONSISTENT');
  if (summary.missingFacts > 0 || summary.uncertainFindings > 0 || missingLanguages.length > 0) {
    return result('NEEDS_REVIEW');
  }
  return result('CONSISTENT');
}
