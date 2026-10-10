/**
 * Bumped whenever a check's behaviour changes, so stored results can always be traced to
 * the exact evaluation logic that produced them.
 */
export const EVALUATOR_VERSION = '1.0.0';

export const METHODS = {
  responseValidity: 'response-validity/v1',
  language: 'lexicon-orthography/v1',
  numeric: 'numeric-extraction/v1',
  entity: 'entity-match/v1',
  concept: 'concept-lexical/v1',
  instructions: 'instruction-rules/v1',
  latency: 'latency-threshold/v1',
  consistency: 'fact-alignment/v1',
} as const;
