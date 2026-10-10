import type {
  CheckResult,
  ConceptFact,
  EntityFact,
  ExpectedFact,
  FactCheckResult,
  NumericFact,
  SupportedLanguage,
} from '@atlasguard/shared';
import { findFirstPhrase, fold, foldText, originalSnippet, snippet, words, type FoldedText, type PhraseMatch } from '../text/fold';
import { extractNumbers, filterByUnit, numbersMatch, type ExtractedNumber } from '../text/numbers';
import { NEGATION_CUES } from '../language/lexicon';
import { METHODS } from '../version';

export interface FactContext {
  response: string;
  language: SupportedLanguage;
  folded: FoldedText;
  numbers: ExtractedNumber[];
}

export function createFactContext(response: string, language: SupportedLanguage): FactContext {
  return { response, language, folded: fold(response), numbers: extractNumbers(response) };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString('en-NG') : String(value);
}

/**
 * Numeric facts are language-independent. Policy:
 * - expected value present (digits, or a reviewed word form) → supported
 * - exactly one other candidate value stated → contradicted (deterministic)
 * - several candidate values → uncertain (review)
 * - no candidate digits → not_found, but flagged for review because the model may have
 *   written the number in words, which this method does not parse
 */
export function checkNumericFact(fact: NumericFact, ctx: FactContext): FactCheckResult {
  const base = { factId: fact.id, factType: 'numeric' as const, required: fact.required, method: METHODS.numeric };
  const expectedLabel = `${formatNumber(fact.value)}${fact.unit ? ` ${fact.unit}` : ''}`;

  const exact = ctx.numbers.find((n) => numbersMatch(n.value, fact.value, fact.tolerance));
  if (exact) {
    return {
      ...base,
      status: 'supported',
      assertedValues: [fact.value],
      evidence: originalSnippet(ctx.response, exact.start, exact.end),
      explanation: `Expected value ${expectedLabel} is stated ("${exact.raw}").`,
      requiresHumanReview: false,
    };
  }

  const wordForm = findFirstPhrase(ctx.folded, fact.acceptedPhrases?.[ctx.language]);
  if (wordForm) {
    return {
      ...base,
      status: 'supported',
      assertedValues: [fact.value],
      evidence: snippet(ctx.folded, wordForm.start, wordForm.end),
      explanation: `Expected value ${expectedLabel} is stated in words ("${wordForm.phrase}").`,
      requiresHumanReview: false,
    };
  }

  const candidates = filterByUnit(
    ctx.numbers.filter((n) => !fact.ignoreValues.some((v) => numbersMatch(n.value, v, fact.tolerance))),
    fact.unit,
  );
  const distinct = [...new Set(candidates.map((n) => n.value))];

  if (distinct.length === 1) {
    const stated = candidates[0]!;
    return {
      ...base,
      status: 'contradicted',
      assertedValues: [stated.value],
      evidence: originalSnippet(ctx.response, stated.start, stated.end),
      explanation: `Response states ${formatNumber(stated.value)} where the reference value is ${expectedLabel}.`,
      requiresHumanReview: false,
    };
  }

  if (distinct.length > 1) {
    return {
      ...base,
      status: 'uncertain',
      assertedValues: distinct,
      explanation: `Expected ${expectedLabel} not found; the response states several other values (${distinct
        .map(formatNumber)
        .join(', ')}), so the intended answer is ambiguous.`,
      requiresHumanReview: true,
    };
  }

  return {
    ...base,
    status: 'not_found',
    assertedValues: [],
    explanation:
      ctx.numbers.length === 0
        ? `No numeric answer found. The value ${expectedLabel} may be written in words, which automated extraction does not parse.`
        : `Only numbers restated from the prompt were found; the expected value ${expectedLabel} was not stated in digits.`,
    requiresHumanReview: true,
  };
}

/**
 * Entity facts compare reviewed surface forms. A missing entity is a deterministic
 * omission; mentioning both the expected and a conflicting entity needs review (the
 * response may be contrasting them, e.g. "Abuja replaced Lagos").
 */
export function checkEntityFact(fact: EntityFact, ctx: FactContext): FactCheckResult {
  const base = { factId: fact.id, factType: 'entity' as const, required: fact.required, method: METHODS.entity };
  const accepted = [...fact.accepted, ...(fact.acceptedByLanguage?.[ctx.language] ?? [])];
  const conflicting = [...fact.conflicting, ...(fact.conflictingByLanguage?.[ctx.language] ?? [])];
  const canonical = foldText(fact.accepted[0]!);
  const hit = findFirstPhrase(ctx.folded, accepted);
  const conflict = findFirstPhrase(ctx.folded, conflicting);

  if (hit && !conflict) {
    return {
      ...base,
      status: 'supported',
      assertedValues: [canonical],
      evidence: snippet(ctx.folded, hit.start, hit.end),
      explanation: `States the expected entity "${fact.accepted[0]}".`,
      requiresHumanReview: false,
    };
  }
  if (hit && conflict) {
    return {
      ...base,
      status: 'uncertain',
      assertedValues: [canonical, `conflict:${foldText(conflict.phrase)}`],
      evidence: snippet(ctx.folded, Math.min(hit.start, conflict.start), Math.max(hit.end, conflict.end)),
      explanation: `Mentions both the expected entity "${fact.accepted[0]}" and the conflicting "${conflict.phrase}"; a reviewer should confirm which is asserted.`,
      requiresHumanReview: true,
    };
  }
  if (conflict) {
    return {
      ...base,
      status: 'contradicted',
      assertedValues: [`conflict:${foldText(conflict.phrase)}`],
      evidence: snippet(ctx.folded, conflict.start, conflict.end),
      explanation: `States "${conflict.phrase}" instead of the expected "${fact.accepted[0]}".`,
      requiresHumanReview: false,
    };
  }
  return {
    ...base,
    status: 'not_found',
    assertedValues: [],
    explanation: `The expected entity "${fact.accepted[0]}" (or an accepted variant) is not mentioned.`,
    requiresHumanReview: false,
  };
}

const NEGATION_WINDOW = 3;

function isNegated(ctx: FactContext, match: PhraseMatch): boolean {
  const cues = NEGATION_CUES[ctx.language];
  const preceding = words(ctx.folded.text.slice(0, match.start)).slice(-NEGATION_WINDOW);
  if (cues && preceding.some((w) => cues.has(w) || w.endsWith("n't"))) return true;
  // Igbo marks negation with a -ghị suffix on the verb itself.
  if (ctx.language === 'ig' && /ghi(?![\p{L}])/u.test(match.matched)) return true;
  return false;
}

/**
 * Concept facts use reviewed lexical evidence. Lexical matching cannot establish meaning,
 * so only a clean, non-negated match counts as supported; contradictions, negations and
 * misses are always routed to human review rather than failed automatically.
 */
export function checkConceptFact(fact: ConceptFact, ctx: FactContext): FactCheckResult {
  const base = { factId: fact.id, factType: 'concept' as const, required: fact.required, method: METHODS.concept };
  const evidencePhrases = fact.evidence[ctx.language];

  if (!evidencePhrases?.length) {
    return {
      ...base,
      status: 'uncertain',
      explanation: `No evidence phrases are defined for this language, so the fact "${fact.description}" must be checked by a reviewer.`,
      requiresHumanReview: true,
    };
  }

  const hit = findFirstPhrase(ctx.folded, evidencePhrases);
  const contradiction = findFirstPhrase(ctx.folded, fact.contradictions?.[ctx.language]);

  if (hit && !contradiction) {
    if (isNegated(ctx, hit)) {
      return {
        ...base,
        status: 'uncertain',
        evidence: snippet(ctx.folded, hit.start, hit.end),
        explanation: `Evidence phrase "${hit.phrase}" appears near a negation; a reviewer should confirm the meaning.`,
        requiresHumanReview: true,
      };
    }
    return {
      ...base,
      status: 'supported',
      evidence: snippet(ctx.folded, hit.start, hit.end),
      explanation: `Lexical evidence for "${fact.description}" found ("${hit.phrase}").`,
      requiresHumanReview: false,
    };
  }
  if (hit && contradiction) {
    return {
      ...base,
      status: 'uncertain',
      evidence: snippet(ctx.folded, Math.min(hit.start, contradiction.start), Math.max(hit.end, contradiction.end)),
      explanation: `Both supporting ("${hit.phrase}") and contradicting ("${contradiction.phrase}") phrases appear.`,
      requiresHumanReview: true,
    };
  }
  if (contradiction) {
    return {
      ...base,
      status: 'contradicted',
      evidence: snippet(ctx.folded, contradiction.start, contradiction.end),
      explanation: `A phrase that may contradict "${fact.description}" was found ("${contradiction.phrase}"). Lexical matching cannot confirm this, so a reviewer must decide.`,
      requiresHumanReview: true,
    };
  }
  return {
    ...base,
    status: 'not_found',
    explanation: `No lexical evidence for "${fact.description}". The idea may be expressed differently, so a reviewer should confirm.`,
    requiresHumanReview: true,
  };
}

export function checkFact(fact: ExpectedFact, ctx: FactContext): FactCheckResult {
  switch (fact.type) {
    case 'numeric':
      return checkNumericFact(fact, ctx);
    case 'entity':
      return checkEntityFact(fact, ctx);
    case 'concept':
      return checkConceptFact(fact, ctx);
  }
}

/** Maps a fact check onto the generic check model that drives the case verdict. */
export function factToCheck(fact: ExpectedFact, result: FactCheckResult): CheckResult {
  let status: CheckResult['status'];
  switch (result.status) {
    case 'supported':
      status = 'pass';
      break;
    case 'contradicted':
      status = result.requiresHumanReview ? 'uncertain' : 'fail';
      break;
    case 'not_found':
      status = !fact.required ? 'not_applicable' : result.requiresHumanReview ? 'uncertain' : 'fail';
      break;
    case 'uncertain':
      status = 'uncertain';
      break;
  }
  const explanation =
    result.status === 'not_found' && !fact.required
      ? `Optional fact not mentioned. ${result.explanation ?? ''}`.trim()
      : (result.explanation ?? fact.description);
  return {
    id: `fact:${fact.id}`,
    dimension: 'factual_accuracy',
    status,
    method: result.method,
    explanation,
    evidence: result.evidence,
    requiresHumanReview: status === 'uncertain',
    details: {
      factStatus: result.status,
      factType: fact.type,
      required: fact.required,
      description: fact.description,
      assertedValues: result.assertedValues ?? [],
    },
  };
}
