import { describe, expect, it } from 'vitest';
import type { ConceptFact, EntityFact, NumericFact } from '@atlasguard/shared';
import { checkConceptFact, checkEntityFact, checkNumericFact, createFactContext, factToCheck } from '../src/checks/facts';

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
  description: 'The capital of Nigeria is Abuja',
  required: true,
  accepted: ['Abuja', 'Federal Capital Territory'],
  acceptedByLanguage: { yo: ['Àbújá'] },
  conflicting: ['Lagos'],
  conflictingByLanguage: { yo: ['Èkó'] },
};

const purpose: ConceptFact = {
  id: 'keep-money',
  type: 'concept',
  description: 'A savings account is used to keep or save money',
  required: true,
  evidence: { 'en-NG': ['save money', 'keep money', 'keep your money', 'save*'], yo: ['fi owó pamọ́'] },
  contradictions: { 'en-NG': ['only for borrowing'] },
};

describe('numeric facts', () => {
  it('supports the expected value even when prompt numbers are restated', () => {
    const r = checkNumericFact(total, createFactContext('₦5,000 plus the ₦50 fee means ₦5,050 is deducted.', 'en-NG'));
    expect(r.status).toBe('supported');
    expect(r.assertedValues).toEqual([5050]);
    expect(r.evidence).toContain('₦5,050');
  });

  it('flags a single different value as a deterministic contradiction', () => {
    const r = checkNumericFact(total, createFactContext('The bank will deduct ₦5,500 from your account.', 'en-NG'));
    expect(r.status).toBe('contradicted');
    expect(r.requiresHumanReview).toBe(false);
    expect(r.assertedValues).toEqual([5500]);
  });

  it('uses the unit to ignore unrelated numbers', () => {
    const r = checkNumericFact(total, createFactContext('₦5,500 will be deducted within 24 hours.', 'en-NG'));
    expect(r.status).toBe('contradicted');
    expect(r.assertedValues).toEqual([5500]);
  });

  it('marks several competing values as uncertain', () => {
    const r = checkNumericFact({ ...total, unit: undefined }, createFactContext('It could be 5,100 or 5,150.', 'en-NG'));
    expect(r.status).toBe('uncertain');
    expect(r.requiresHumanReview).toBe(true);
  });

  it('routes answers without digits to review because numbers may be written in words', () => {
    const r = checkNumericFact(total, createFactContext('Ẹgbẹ̀rún márùn-ún ó lé àádọ́ta náírà.', 'yo'));
    expect(r.status).toBe('not_found');
    expect(r.requiresHumanReview).toBe(true);
  });

  it('accepts reviewed word forms of the number', () => {
    const r = checkNumericFact(
      { ...total, acceptedPhrases: { yo: ['ẹgbẹ̀rún márùn-ún ó lé àádọ́ta'] } },
      createFactContext('Ẹgbẹ̀rún márùn-ún ó lé àádọ́ta náírà ni wọ́n máa yọ.', 'yo'),
    );
    expect(r.status).toBe('supported');
  });
});

describe('entity facts', () => {
  it('supports a language-specific surface form', () => {
    const r = checkEntityFact(capital, createFactContext('Olú-ìlú Nàìjíríà ni Àbújá.', 'yo'));
    expect(r.status).toBe('supported');
  });

  it('contradicts when only a conflicting entity is stated', () => {
    const r = checkEntityFact(capital, createFactContext('The capital of Nigeria is Lagos.', 'en-NG'));
    expect(r.status).toBe('contradicted');
    expect(r.assertedValues).toEqual(['conflict:lagos']);
  });

  it('needs review when both entities appear', () => {
    const r = checkEntityFact(capital, createFactContext('Abuja replaced Lagos as the capital in 1991.', 'en-NG'));
    expect(r.status).toBe('uncertain');
  });

  it('reports a missing entity as a deterministic omission', () => {
    const r = checkEntityFact(capital, createFactContext('Nigeria is in West Africa.', 'en-NG'));
    expect(r.status).toBe('not_found');
    expect(r.requiresHumanReview).toBe(false);
    expect(factToCheck(capital, r).status).toBe('fail');
  });
});

describe('concept facts', () => {
  it('supports lexical evidence', () => {
    const r = checkConceptFact(purpose, createFactContext('It helps you keep your money safe.', 'en-NG'));
    expect(r.status).toBe('supported');
  });

  it('treats negated evidence as uncertain', () => {
    const r = checkConceptFact(purpose, createFactContext('It is not meant to keep money; it is for spending.', 'en-NG'));
    expect(r.status).toBe('uncertain');
  });

  it('never fails automatically on a lexical contradiction', () => {
    const r = checkConceptFact(purpose, createFactContext('A savings account is only for borrowing.', 'en-NG'));
    expect(r.status).toBe('contradicted');
    expect(r.requiresHumanReview).toBe(true);
    expect(factToCheck(purpose, r).status).toBe('uncertain');
  });

  it('needs review when supporting and contradicting phrases both appear', () => {
    const r = checkConceptFact(purpose, createFactContext('People save money there; it is not only for borrowing.', 'en-NG'));
    expect(r.status).toBe('uncertain');
    expect(r.requiresHumanReview).toBe(true);
  });

  it('supports prefix evidence without matching the restated subject', () => {
    expect(checkConceptFact(purpose, createFactContext('It is where a family saves for school fees.', 'en-NG')).status).toBe('supported');
    expect(checkConceptFact(purpose, createFactContext('A savings account is an account.', 'en-NG')).status).toBe('not_found');
  });

  it('requires review when the language has no evidence phrases', () => {
    const r = checkConceptFact(purpose, createFactContext('Asusun ajiya yana taimaka maka adana kuɗi.', 'ha'));
    expect(r.status).toBe('uncertain');
    expect(r.explanation).toContain('No evidence phrases');
  });

  it('routes misses to review instead of failing', () => {
    const r = checkConceptFact(purpose, createFactContext('It is an account at a bank.', 'en-NG'));
    expect(r.status).toBe('not_found');
    expect(factToCheck(purpose, r).status).toBe('uncertain');
  });

  it('does not let an optional missing fact affect the verdict', () => {
    const optional = { ...capital, required: false };
    const r = checkEntityFact(optional, createFactContext('Nigeria is in West Africa.', 'en-NG'));
    expect(factToCheck(optional, r).status).toBe('not_applicable');
  });
});
