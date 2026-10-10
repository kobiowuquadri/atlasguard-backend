import type { CheckResult, EvaluationRule } from '@atlasguard/shared';
import { findAllPhrases, findFirstPhrase, snippet, words, type FoldedText } from '../text/fold';
import { METHODS } from '../version';

type InstructionRule = Exclude<EvaluationRule, { type: 'response_language' } | { type: 'max_latency_ms' }>;

export function isInstructionRule(rule: EvaluationRule): rule is InstructionRule {
  return rule.type !== 'response_language' && rule.type !== 'max_latency_ms';
}

function result(
  rule: InstructionRule,
  status: CheckResult['status'],
  explanation: string,
  extra: Partial<CheckResult> = {},
): CheckResult {
  return {
    id: `instruction:${rule.type}`,
    dimension: 'instruction_compliance',
    method: METHODS.instructions,
    status,
    explanation,
    requiresHumanReview: status === 'uncertain',
    ...extra,
  };
}

function parseJsonResponse(response: string, allowCodeFence: boolean): { value: unknown; fenced: boolean } | null {
  const trimmed = response.trim();
  try {
    return { value: JSON.parse(trimmed), fenced: false };
  } catch {
    if (!allowCodeFence) return null;
    const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(trimmed);
    if (!fence) return null;
    try {
      return { value: JSON.parse(fence[1]!), fenced: true };
    } catch {
      return null;
    }
  }
}

/** Deterministic instruction-following checks. Every outcome is pass or fail. */
export function checkInstruction(rule: InstructionRule, response: string, folded: FoldedText): CheckResult {
  switch (rule.type) {
    case 'json_format': {
      const parsed = parseJsonResponse(response, rule.allowCodeFence);
      if (!parsed) return result(rule, 'fail', 'Response is not valid JSON.');
      if (rule.requiredKeys.length > 0) {
        const value = parsed.value;
        const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
        const missing = isObject ? rule.requiredKeys.filter((k) => !(k in (value as Record<string, unknown>))) : rule.requiredKeys;
        if (missing.length > 0) {
          return result(rule, 'fail', `JSON is missing required keys: ${missing.join(', ')}.`, { details: { missing } });
        }
      }
      return result(
        rule,
        'pass',
        parsed.fenced ? 'Valid JSON (wrapped in a code fence, which this case allows).' : 'Valid JSON.',
      );
    }
    case 'max_words': {
      const count = words(folded.text).length;
      return count <= rule.value
        ? result(rule, 'pass', `${count} words (limit ${rule.value}).`, { details: { count } })
        : result(rule, 'fail', `${count} words exceeds the limit of ${rule.value}.`, { details: { count } });
    }
    case 'min_words': {
      const count = words(folded.text).length;
      return count >= rule.value
        ? result(rule, 'pass', `${count} words (minimum ${rule.value}).`, { details: { count } })
        : result(rule, 'fail', `${count} words is below the minimum of ${rule.value}.`, { details: { count } });
    }
    case 'required_terms': {
      const found = findAllPhrases(folded, rule.terms);
      const foundPhrases = new Set(found.map((m) => m.phrase));
      const missing = rule.terms.filter((t) => !foundPhrases.has(t));
      const ok = rule.mode === 'all' ? missing.length === 0 : found.length > 0;
      const details = { found: [...foundPhrases], missing, mode: rule.mode };
      if (ok) {
        return result(rule, 'pass', `Includes required term(s): ${[...foundPhrases].join(', ')}.`, {
          details,
          evidence: found[0] ? snippet(folded, found[0].start, found[0].end) : undefined,
        });
      }
      return result(
        rule,
        'fail',
        rule.mode === 'all'
          ? `Missing required term(s): ${missing.join(', ')}.`
          : `None of the required terms appear (${rule.terms.join(', ')}).`,
        { details },
      );
    }
    case 'forbidden_terms': {
      const hit = findFirstPhrase(folded, rule.terms);
      return hit
        ? result(rule, 'fail', `Contains forbidden term "${hit.phrase}".`, { evidence: snippet(folded, hit.start, hit.end) })
        : result(rule, 'pass', 'Contains none of the forbidden terms.');
    }
    case 'forbidden_format': {
      const patterns: Record<typeof rule.format, RegExp> = {
        markdown_table: /^\s*\|.*\|\s*$\n^\s*\|?\s*:?-{3,}/m,
        code_block: /```/,
        bullet_list: /^\s*(?:[-*•]|\d+[.)])\s+\S/m,
      };
      const labels: Record<typeof rule.format, string> = {
        markdown_table: 'a Markdown table',
        code_block: 'a code block',
        bullet_list: 'a bulleted or numbered list',
      };
      return patterns[rule.format].test(response)
        ? result(rule, 'fail', `Uses ${labels[rule.format]}, which the instructions prohibit.`)
        : result(rule, 'pass', `Does not use ${labels[rule.format]}.`);
    }
  }
}
