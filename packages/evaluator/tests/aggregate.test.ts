import { describe, expect, it } from 'vitest';
import { aggregate, bucket, type AggregatableResult } from '../src/aggregate';

const r = (language: string, category: string, verdict: AggregatableResult['verdict'], ms: number | null = 1000): AggregatableResult => ({
  language,
  category,
  verdict,
  responseTimeMs: ms,
});

describe('aggregation', () => {
  it('excludes review, skipped, errors and pending results from the pass-rate denominator', () => {
    const b = bucket([
      r('yo', 'education', 'PASSED'),
      r('yo', 'education', 'PASSED'),
      r('yo', 'education', 'FAILED'),
      r('yo', 'education', 'NEEDS_REVIEW'),
      r('yo', 'education', 'ERROR', null),
      r('yo', 'education', 'SKIPPED', null),
      r('yo', 'education', null, null),
    ]);
    expect(b).toMatchObject({ total: 7, passed: 2, failed: 1, needsReview: 1, errors: 1, skipped: 1, pending: 1, determinate: 3 });
    expect(b.verifiedPassRate).toBeCloseTo(0.6667, 4);
  });

  it('returns null pass rate and latency when nothing is measurable', () => {
    const b = bucket([r('ha', 'education', 'ERROR', null), r('ha', 'education', 'NEEDS_REVIEW', 900)]);
    expect(b.verifiedPassRate).toBeNull();
    expect(b.averageLatencyMs).toBe(900);
    expect(bucket([]).averageLatencyMs).toBeNull();
  });

  it('computes mean and median latency over responses only', () => {
    const b = bucket([r('ig', 'x', 'PASSED', 100), r('ig', 'x', 'FAILED', 300), r('ig', 'x', 'PASSED', 1400), r('ig', 'x', 'ERROR', null)]);
    expect(b.averageLatencyMs).toBe(600);
    expect(b.medianLatencyMs).toBe(300);
  });

  it('groups by language, category and both', () => {
    const a = aggregate([
      r('yo', 'education', 'PASSED'),
      r('yo', 'civic_information', 'FAILED'),
      r('ha', 'education', 'PASSED'),
    ]);
    expect(Object.keys(a.byLanguage).sort()).toEqual(['ha', 'yo']);
    expect(a.byCategory.education!.passed).toBe(2);
    expect(a.byLanguageCategory.yo!.civic_information!.failed).toBe(1);
    expect(a.overall.verifiedPassRate).toBeCloseTo(0.6667, 4);
  });
});
