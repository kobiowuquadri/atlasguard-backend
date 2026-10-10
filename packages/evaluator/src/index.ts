export { EVALUATOR_VERSION, METHODS } from './version';
export { fold, foldText, words, findFirstPhrase, findAllPhrases, snippet, type FoldedText, type PhraseMatch } from './text/fold';
export { extractNumbers, numbersMatch, type ExtractedNumber } from './text/numbers';
export { detectLanguage } from './language/detect';
export { checkResponseValidity } from './checks/validity';
export { checkLanguageCompliance } from './checks/language';
export { checkFact, checkNumericFact, checkEntityFact, checkConceptFact, createFactContext, factToCheck } from './checks/facts';
export { checkInstruction } from './checks/instructions';
export { checkLatency } from './checks/latency';
export {
  evaluateCase,
  effectiveRules,
  verdictFromChecks,
  type CaseDefinition,
  type ResponseRecord,
} from './evaluate-case';
export { analyzeConsistency, type ConsistencyEntry, type ConsistencyGroup } from './consistency';
export { aggregate, bucket, type Aggregate, type AggregatableResult } from './aggregate';
export * from './providers/types';
export { ProviderError, PROVIDER_ERROR_CODES, type ProviderErrorCode } from './providers/errors';
export { NatlasProvider, normalizeBaseUrl, parseChatCompletion, type NatlasProviderOptions } from './providers/natlas-provider';
export { FixtureProvider, FIXTURE_MODEL_ID, type FixtureProviderOptions } from './providers/fixture-provider';
export { Semaphore } from './providers/semaphore';
