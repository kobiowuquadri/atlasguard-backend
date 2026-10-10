import { describe, expect, it } from 'vitest';
import type { ConceptFact, EntityFact, ExpectedFact, NumericFact, SupportedLanguage } from '@atlasguard/shared';
import { analyzeConsistency, type ConsistencyEntry } from '../src/consistency';
import { checkFact, createFactContext } from '../src/checks/facts';

const total: NumericFact = {
  id: 'total',
  type: 'numeric',
  description: 'Total deducted is ₦5,050',
  required: true,
  value: 5050,
  tolerance: 0,
  unit: 'NGN',
  ignoreValues: [5000, 50],
};
const capital: EntityFact = {
  id: 'capital',
  type: 'entity',
  description: 'The capital is Abuja',
  required: true,
  accepted: ['Abuja'],
  conflicting: ['Lagos'],
  conflictingByLanguage: { yo: ['Èkó'] },
};
const purpose: ConceptFact = {
  id: 'purpose',
  type: 'concept',
  description: 'Keeps money safe',
  required: true,
  evidence: { 'en-NG': ['keep money'], yo: ['fi owó pamọ́'], ha: ['adana kuɗi'] },
  contradictions: { yo: ['kò ṣeé fi pamọ́'] },
};

function entry(language: SupportedLanguage, response: string | null, facts: ExpectedFact[]): ConsistencyEntry {
  if (response === null) return { language, hasResponse: false, factChecks: [] };
  const ctx = createFactContext(response, language);
  return { language, hasResponse: true, factChecks: facts.map((f) => checkFact(f, ctx)) };
}

describe('analyzeConsistency', () => {
  it('reports CONSISTENT when every language supports every shared fact', () => {
    const facts = [total];
    const a = analyzeConsistency({ key: 'transfer', facts }, [
      entry('en-NG', 'The total deducted is ₦5,050.', facts),
      entry('yo', 'Àpapọ̀ owó tí wọ́n máa yọ jẹ́ ₦5,050.', facts),
      entry('ha', 'Jimillar kuɗin da za a cire shine ₦5,050.', facts),
    ]);
    expect(a.verdict).toBe('CONSISTENT');
    expect(a.summary).toMatchObject({ sharedFactsChecked: 1, consistentFacts: 1, confirmedContradictions: 0 });
  });

  it('detects conflicting numerical values across languages', () => {
    const facts = [total];
    const a = analyzeConsistency({ key: 'transfer', facts }, [
      entry('en-NG', 'The total deducted is ₦5,050.', facts),
      entry('ha', 'Za a cire ₦5,500 daga asusunka.', facts),
    ]);
    expect(a.verdict).toBe('INCONSISTENT');
    const conflict = a.findings.find((f) => f.type === 'numeric_conflict')!;
    expect(conflict.severity).toBe('conflict');
    expect(conflict.values).toEqual({ 'en-NG': [5050], ha: [5500] });
    expect(a.summary.confirmedContradictions).toBe(1);
  });

  it('detects conflicting named entities across languages', () => {
    const facts = [capital];
    const a = analyzeConsistency({ key: 'capital', facts }, [
      entry('en-NG', 'The capital of Nigeria is Abuja.', facts),
      entry('yo', 'Olú-ìlú Nàìjíríà ni Èkó.', facts),
    ]);
    expect(a.verdict).toBe('INCONSISTENT');
    expect(a.findings.some((f) => f.type === 'entity_conflict')).toBe(true);
  });

  it('distinguishes an omission from a contradiction', () => {
    const facts = [capital];
    const a = analyzeConsistency({ key: 'capital', facts }, [
      entry('en-NG', 'The capital of Nigeria is Abuja.', facts),
      entry('ha', 'Najeriya ƙasa ce a yammacin Afirka.', facts),
    ]);
    expect(a.verdict).toBe('NEEDS_REVIEW');
    expect(a.summary.confirmedContradictions).toBe(0);
    expect(a.summary.missingFacts).toBe(1);
    const omission = a.findings.find((f) => f.type === 'fact_omission')!;
    expect(omission.severity).toBe('omission');
    expect(omission.languages).toEqual(['ha']);
  });

  it('reports missing language responses (provider errors, skipped cases)', () => {
    const facts = [total];
    const a = analyzeConsistency(
      { key: 'transfer', facts },
      [
        entry('en-NG', 'The total deducted is ₦5,050.', facts),
        entry('yo', 'Àpapọ̀ owó tí wọ́n máa yọ jẹ́ ₦5,050.', facts),
        entry('ig', null, facts),
      ],
      ['en-NG', 'yo', 'ig'],
    );
    expect(a.verdict).toBe('NEEDS_REVIEW');
    expect(a.languagesMissing).toEqual(['ig']);
    expect(a.languagesCompared).toEqual(['en-NG', 'yo']);
    expect(a.findings[0]!.type).toBe('missing_response');
  });

  it('returns INSUFFICIENT_DATA when fewer than two languages answered', () => {
    const facts = [total];
    const a = analyzeConsistency({ key: 'transfer', facts }, [
      entry('en-NG', 'The total deducted is ₦5,050.', facts),
      entry('ha', null, facts),
    ]);
    expect(a.verdict).toBe('INSUFFICIENT_DATA');
  });

  it('routes uncertain evaluations and lexical contradictions to review', () => {
    const facts = [purpose];
    const a = analyzeConsistency({ key: 'savings', facts }, [
      entry('en-NG', 'It helps you keep money safe.', facts),
      entry('yo', 'Owó tí ó wà nínú rẹ̀ kò ṣeé fi pamọ́.', facts),
      entry('ig', 'Ọ bụ akaụntụ ụlọ akụ.', facts),
    ]);
    expect(a.verdict).toBe('NEEDS_REVIEW');
    expect(a.summary.confirmedContradictions).toBe(0);
    expect(a.findings.map((f) => f.type)).toEqual(
      expect.arrayContaining(['possible_contradiction', 'uncertain_fact']),
    );
  });

  it('notes when all languages agree on a value that contradicts the reference', () => {
    const facts = [total];
    const a = analyzeConsistency({ key: 'transfer', facts }, [
      entry('en-NG', 'You will be charged ₦5,500 in total.', facts),
      entry('ha', 'Za a cire ₦5,500 daga asusunka.', facts),
    ]);
    expect(a.verdict).toBe('CONSISTENT');
    expect(a.findings.find((f) => f.type === 'consistent_error')?.severity).toBe('info');
  });

  it('only compares facts that apply to at least two languages', () => {
    const facts = [total, capital];
    const a = analyzeConsistency({ key: 'mixed', facts }, [
      { ...entry('en-NG', 'The total deducted is ₦5,050 and the capital is Abuja.', facts) },
      { ...entry('yo', 'Àpapọ̀ owó jẹ́ ₦5,050.', [total]) },
    ]);
    expect(a.summary.sharedFactsChecked).toBe(1);
    expect(a.verdict).toBe('CONSISTENT');
  });
});
