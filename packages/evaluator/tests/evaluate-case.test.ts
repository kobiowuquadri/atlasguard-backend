import { describe, expect, it } from 'vitest';
import type { NumericFact } from '@atlasguard/shared';
import { evaluateCase, type CaseDefinition } from '../src/evaluate-case';

const fact: NumericFact = {
  id: 'total',
  type: 'numeric',
  description: 'Total deducted is ₦5,050',
  required: true,
  value: 5050,
  tolerance: 0,
  unit: 'NGN',
  ignoreValues: [5000, 50],
};

const baseCase: CaseDefinition = { key: 'transfer.en-NG', language: 'en-NG', facts: [fact], rules: [] };
const model = { expectedModel: 'NCAIR1/N-ATLaS', servedModel: 'NCAIR1/N-ATLaS' };

describe('evaluateCase', () => {
  it('passes when every applicable check passes', () => {
    const r = evaluateCase(baseCase, {
      text: 'If you send ₦5,000 and the bank charges a ₦50 fee, the total amount that will be deducted from your account is ₦5,050.',
      latencyMs: 1200,
      ...model,
    });
    expect(r.verdict).toBe('PASSED');
    expect(r.checks.map((c) => c.id)).toEqual(['response_validity', 'language_compliance', 'fact:total', 'latency']);
    expect(r.evaluatorVersion).toBe('1.0.0');
  });

  it('fails an empty response without running other checks', () => {
    const r = evaluateCase(baseCase, { text: '  <|eot_id|> ', latencyMs: 10, ...model });
    expect(r.verdict).toBe('FAILED');
    expect(r.checks[0]!.status).toBe('fail');
    expect(r.factChecks).toHaveLength(0);
  });

  it('fails when the served model differs from the configured model', () => {
    const r = evaluateCase(baseCase, { text: 'The total is ₦5,050.', latencyMs: 10, expectedModel: 'NCAIR1/N-ATLaS', servedModel: 'some-other-model' });
    expect(r.verdict).toBe('FAILED');
    expect(r.checks[0]!.explanation).toContain('some-other-model');
  });

  it('returns NEEDS_REVIEW when the only problems are uncertain', () => {
    const r = evaluateCase(baseCase, {
      text: 'The amount deducted from your account will be five thousand and fifty naira in total.',
      latencyMs: 500,
      ...model,
    });
    expect(r.verdict).toBe('NEEDS_REVIEW');
    expect(r.requiresHumanReview).toBe(true);
  });

  it('lets a determinate failure take precedence over review items', () => {
    const r = evaluateCase(
      { ...baseCase, rules: [{ type: 'max_words', value: 5 }] },
      { text: 'The amount deducted from your account will be five thousand and fifty naira.', latencyMs: 500, ...model },
    );
    expect(r.verdict).toBe('FAILED');
  });

  it('applies instruction rules, required and forbidden terms', () => {
    const def: CaseDefinition = {
      key: 'json.en-NG',
      language: 'en-NG',
      facts: [],
      rules: [
        { type: 'json_format', requiredKeys: ['term', 'meaning'], allowCodeFence: true },
        { type: 'response_language', language: 'any', allowCodeSwitching: true },
      ],
      requiredTerms: ['POS'],
      forbiddenTerms: ['ATM card'],
    };
    const ok = evaluateCase(def, { text: '{"term": "POS", "meaning": "point of sale"}', latencyMs: 100, ...model });
    expect(ok.verdict).toBe('PASSED');

    const bad = evaluateCase(def, { text: 'POS means point of sale, like an ATM card terminal.', latencyMs: 100, ...model });
    expect(bad.verdict).toBe('FAILED');
    const failed = bad.checks.filter((c) => c.status === 'fail').map((c) => c.id);
    expect(failed).toEqual(['instruction:json_format', 'instruction:forbidden_terms']);
  });

  it('enforces a latency threshold only when the case defines one', () => {
    const text = 'The total amount that will be deducted from your account is ₦5,050 in this case.';
    expect(evaluateCase(baseCase, { text, latencyMs: 90_000, ...model }).verdict).toBe('PASSED');
    const slow = evaluateCase({ ...baseCase, rules: [{ type: 'max_latency_ms', value: 30_000 }] }, { text, latencyMs: 90_000, ...model });
    expect(slow.verdict).toBe('FAILED');
    expect(slow.checks.find((c) => c.id === 'latency')!.status).toBe('fail');
  });

  it('fails a response written in the wrong language', () => {
    const r = evaluateCase(
      { ...baseCase, key: 'transfer.yo', language: 'yo' },
      { text: 'The total amount that will be deducted from your account is ₦5,050, which includes the fee.', latencyMs: 10, ...model },
    );
    expect(r.verdict).toBe('FAILED');
    expect(r.checks.find((c) => c.id === 'language_compliance')!.status).toBe('fail');
  });
});
