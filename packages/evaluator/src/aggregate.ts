import type { ResultBucket, Verdict } from '@atlasguard/shared';

export interface AggregatableResult {
  language: string;
  category: string;
  /** Final verdict (human decision when reviewed, otherwise automated); null if not executed yet. */
  verdict: Verdict | null;
  /** Round-trip latency, only for results that produced a response. */
  responseTimeMs: number | null;
}

export interface Aggregate {
  overall: ResultBucket;
  byLanguage: Record<string, ResultBucket>;
  byCategory: Record<string, ResultBucket>;
  byLanguageCategory: Record<string, Record<string, ResultBucket>>;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

/**
 * Pass rate = PASSED / (PASSED + FAILED). NEEDS_REVIEW, SKIPPED, ERROR and pending results
 * are excluded from the denominator and reported as separate counts.
 */
export function bucket(results: readonly AggregatableResult[]): ResultBucket {
  const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  const passed = count('PASSED');
  const failed = count('FAILED');
  const latencies = results.map((r) => r.responseTimeMs).filter((v): v is number => typeof v === 'number');
  const determinate = passed + failed;
  return {
    total: results.length,
    passed,
    failed,
    needsReview: count('NEEDS_REVIEW'),
    skipped: count('SKIPPED'),
    errors: count('ERROR'),
    pending: results.filter((r) => r.verdict === null).length,
    determinate,
    verifiedPassRate: determinate > 0 ? Math.round((passed / determinate) * 10000) / 10000 : null,
    averageLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    medianLatencyMs: median(latencies),
  };
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export function aggregate(results: readonly AggregatableResult[]): Aggregate {
  const byLanguage: Record<string, ResultBucket> = {};
  const byCategory: Record<string, ResultBucket> = {};
  const byLanguageCategory: Record<string, Record<string, ResultBucket>> = {};

  for (const [language, items] of groupBy(results, (r) => r.language)) {
    byLanguage[language] = bucket(items);
    byLanguageCategory[language] = {};
    for (const [category, catItems] of groupBy(items, (r) => r.category)) {
      byLanguageCategory[language]![category] = bucket(catItems);
    }
  }
  for (const [category, items] of groupBy(results, (r) => r.category)) {
    byCategory[category] = bucket(items);
  }
  return { overall: bucket(results), byLanguage, byCategory, byLanguageCategory };
}
