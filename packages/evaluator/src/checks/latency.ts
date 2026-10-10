import type { CheckResult } from '@atlasguard/shared';
import { METHODS } from '../version';

/**
 * Latency is total round-trip time measured by AtlasGuard (request start to complete
 * response). It is not pure model inference time; provider-reported inference time is
 * shown separately when the endpoint supplies it.
 */
export function checkLatency(latencyMs: number, maxLatencyMs?: number, providerInferenceMs?: number | null): CheckResult {
  const details = { latencyMs, maxLatencyMs: maxLatencyMs ?? null, providerInferenceMs: providerInferenceMs ?? null };
  const base = { id: 'latency', dimension: 'latency' as const, method: METHODS.latency, requiresHumanReview: false, details };
  if (maxLatencyMs === undefined) {
    return {
      ...base,
      status: 'not_applicable',
      explanation: `Round-trip latency ${latencyMs} ms (recorded; no threshold set for this case).`,
    };
  }
  return latencyMs <= maxLatencyMs
    ? { ...base, status: 'pass', explanation: `Round-trip latency ${latencyMs} ms is within the ${maxLatencyMs} ms limit.` }
    : { ...base, status: 'fail', explanation: `Round-trip latency ${latencyMs} ms exceeds the ${maxLatencyMs} ms limit.` };
}
