import { describe, expect, it } from 'vitest';
import { analyzeConsistency, evaluateCase, type CaseDefinition } from '@atlasguard/evaluator';
import { SUPPORTED_LANGUAGES, type BenchmarkDataset, type SupportedLanguage } from '@atlasguard/shared';
import { loadFixtures, loadOfficialDatasets } from '../src/index';

const datasets = loadOfficialDatasets();
const fixtures = loadFixtures();
const nigerian = datasets.find((d) => d.dataset.suite.slug === 'nigerian-context-v1')!.dataset;

function definitions(dataset: BenchmarkDataset): Map<string, CaseDefinition & { groupKey?: string }> {
  const defs = new Map<string, CaseDefinition & { groupKey?: string }>();
  for (const group of dataset.semanticGroups) {
    for (const c of group.cases) {
      const ids = c.factIds ? new Set(c.factIds) : null;
      defs.set(c.key, {
        key: c.key,
        language: c.language,
        facts: group.expectedFacts.filter((f) => !ids || ids.has(f.id)),
        rules: c.evaluationRules,
        requiredTerms: c.requiredTerms,
        forbiddenTerms: c.forbiddenTerms,
        groupKey: group.key,
      });
    }
  }
  for (const c of dataset.cases) {
    defs.set(c.key, {
      key: c.key,
      language: c.language,
      facts: c.expectedFacts,
      rules: c.evaluationRules,
      requiredTerms: c.requiredTerms,
      forbiddenTerms: c.forbiddenTerms,
    });
  }
  return defs;
}

const defs = definitions(nigerian);
const evaluateFixture = (key: string) =>
  evaluateCase(defs.get(key)!, { text: fixtures[key]!, latencyMs: 100, expectedModel: 'm', servedModel: 'm' });

describe('official datasets', () => {
  it('all validate against the dataset schema', () => {
    expect(datasets.length).toBeGreaterThan(0);
  });

  it('covers every supported language in every semantic group of the Nigerian context suite', () => {
    for (const group of nigerian.semanticGroups) {
      expect(group.cases.map((c) => c.language).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
    }
  });

  it('never marks content verified without reviewer metadata', () => {
    for (const { dataset } of datasets) {
      const cases = [...dataset.semanticGroups.flatMap((g) => g.cases), ...dataset.cases];
      for (const c of cases.filter((x) => x.provenance.reviewStatus === 'verified')) {
        expect(c.provenance.reviewedBy, c.key).toBeTruthy();
        expect(c.provenance.reviewedAt, c.key).toBeTruthy();
      }
    }
  });

  it('labels every AI-generated translation with its source language', () => {
    for (const group of nigerian.semanticGroups) {
      for (const c of group.cases.filter((x) => x.provenance.translationSource === 'ai_generated')) {
        expect(c.provenance.translatedFrom, c.key).toBe('en-NG');
      }
    }
  });
});

describe('simulated fixtures', () => {
  it('exist for exactly the cases in the suite', () => {
    expect(Object.keys(fixtures).sort()).toEqual([...defs.keys()].sort());
  });

  it.each([
    ['transfer-fee-total.en-NG', 'PASSED'],
    ['transfer-fee-total.yo', 'PASSED'],
    ['transfer-fee-total.ha', 'FAILED'],
    ['savings-interest.ig', 'FAILED'],
    ['go-slow-meaning.ha', 'PASSED'],
    ['go-slow-meaning.ig', 'FAILED'],
    ['rectangle-area.yo', 'FAILED'],
    ['capital-of-nigeria.yo', 'FAILED'],
    ['capital-of-nigeria.ig', 'PASSED'],
    ['states-in-nigeria.ig', 'PASSED'],
    ['independence-year.ha', 'FAILED'],
    ['yoruba-good-morning.ig', 'FAILED'],
    ['igbo-thank-you.ha', 'FAILED'],
    ['translate-dosage.ha', 'FAILED'],
    ['translate-market-price.ig', 'FAILED'],
    ['pos-json-definition.en-NG', 'PASSED'],
  ])('%s evaluates to %s', (key, verdict) => {
    expect(evaluateFixture(key).verdict).toBe(verdict);
  });

  it('identifies the language of every non-English fixture written in its own language', () => {
    const englishByDesign = new Set(['go-slow-meaning.ig']);
    for (const [key, def] of defs) {
      if (def.language === 'en-NG' || englishByDesign.has(key)) continue;
      const result = evaluateFixture(key);
      const language = result.checks.find((c) => c.id === 'language_compliance')!;
      expect(language.status, `${key}: ${language.explanation}`).not.toBe('fail');
    }
  });

  it('detects the cross-language numeric conflict in the transfer group', () => {
    const group = nigerian.semanticGroups.find((g) => g.key === 'transfer-fee-total')!;
    const entries = group.cases.map((c) => ({
      language: c.language as SupportedLanguage,
      hasResponse: true,
      factChecks: evaluateFixture(c.key).factChecks,
    }));
    const analysis = analyzeConsistency({ key: group.key, facts: group.expectedFacts }, entries);
    expect(analysis.verdict).toBe('INCONSISTENT');
    expect(analysis.findings.find((f) => f.type === 'numeric_conflict')?.values?.ha).toEqual([5500]);
  });
});
