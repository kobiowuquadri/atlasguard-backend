import type { CheckResult } from '@atlasguard/shared';
import { METHODS } from '../version';

export interface ValidityInput {
  response: string;
  servedModel?: string | null;
  expectedModel?: string | null;
  acceptedModelNames?: readonly string[];
  finishReason?: string | null;
}

const SPECIAL_TOKENS = /<\|[a-z_]+\|>/gi;

/** Response validity: non-empty usable text produced by the configured model. */
export function checkResponseValidity(input: ValidityInput): CheckResult {
  const cleaned = input.response.replace(SPECIAL_TOKENS, '').trim();
  const details: Record<string, unknown> = {
    characters: input.response.length,
    finishReason: input.finishReason ?? null,
    truncated: input.finishReason === 'length',
    servedModel: input.servedModel ?? null,
  };
  const base = { id: 'response_validity', dimension: 'response_validity' as const, method: METHODS.responseValidity };

  if (cleaned.length === 0) {
    return {
      ...base,
      status: 'fail',
      explanation: 'The provider returned an empty response (or only special tokens).',
      requiresHumanReview: false,
      details,
    };
  }

  if (input.expectedModel && input.servedModel) {
    const accepted = [input.expectedModel, ...(input.acceptedModelNames ?? [])].map((m) => m.toLowerCase());
    if (!accepted.includes(input.servedModel.toLowerCase())) {
      return {
        ...base,
        status: 'fail',
        explanation: `Response was reported as produced by "${input.servedModel}", not the configured model "${input.expectedModel}".`,
        requiresHumanReview: false,
        details,
      };
    }
  }

  return {
    ...base,
    status: 'pass',
    explanation:
      input.finishReason === 'length'
        ? 'Non-empty response from the configured model; generation stopped at the max-token limit, so it may be truncated.'
        : 'Non-empty response from the configured model.',
    requiresHumanReview: false,
    details,
  };
}
