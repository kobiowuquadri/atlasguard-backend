import { LANGUAGES, languageName, type CheckResult, type LanguageDetectionResult, type SupportedLanguage } from '@atlasguard/shared';
import { detectLanguage } from '../language/detect';

export interface LanguageComplianceInput {
  response: string;
  expected: SupportedLanguage | 'any';
  allowCodeSwitching: boolean;
}

const MIN_WORDS = 3;
const PASS_CONFIDENCE = 0.45;
const FAIL_CONFIDENCE = 0.55;
const CODE_SWITCH_SHARE = 0.25;

function name(lang: string): string {
  return lang === 'pcm' ? 'Nigerian Pidgin' : lang === 'unknown' ? 'an unidentified language' : languageName(lang);
}

/**
 * Language compliance. Short text, code-switching and closely related varieties make
 * identification unreliable, so those outcomes are `uncertain` (human review), never an
 * automatic failure.
 */
export function checkLanguageCompliance(
  input: LanguageComplianceInput,
): { check: CheckResult; detection: LanguageDetectionResult | null } {
  const base = { id: 'language_compliance', dimension: 'language_compliance' as const };

  if (input.expected === 'any') {
    return {
      detection: null,
      check: {
        ...base,
        method: 'not-applicable',
        status: 'not_applicable',
        explanation: 'This case does not require a specific response language.',
        requiresHumanReview: false,
      },
    };
  }

  const detection = detectLanguage(input.response);
  const expected = input.expected;
  const expectedShare = detection.shares[expected] ?? 0;
  const details = {
    expected,
    detected: detection.detected,
    confidence: detection.confidence,
    shares: detection.shares,
    wordCount: detection.wordCount,
    codeSwitching: detection.codeSwitching,
  };
  const result = (status: CheckResult['status'], explanation: string): CheckResult => ({
    ...base,
    method: detection.method,
    status,
    explanation,
    evidence: detection.evidence.join('; ') || undefined,
    requiresHumanReview: status === 'uncertain',
    details,
  });

  if (detection.wordCount < MIN_WORDS) {
    return {
      detection,
      check: result('uncertain', `Response is too short (${detection.wordCount} words) to identify its language reliably.`),
    };
  }

  if (detection.detected === expected) {
    if (detection.confidence >= PASS_CONFIDENCE) {
      const note = detection.codeSwitching ? ' Some code-switching was detected.' : '';
      return {
        detection,
        check: result('pass', `Response is in ${LANGUAGES[expected].name} (confidence ${detection.confidence}).${note}`),
      };
    }
    return {
      detection,
      check: result(
        'uncertain',
        `${LANGUAGES[expected].name} is the most likely language, but evidence is weak (confidence ${detection.confidence}).`,
      ),
    };
  }

  if (expected === 'en-NG' && detection.detected === 'pcm') {
    return {
      detection,
      check: result('uncertain', 'Response appears to use Nigerian Pidgin rather than Nigerian English; a reviewer should decide.'),
    };
  }

  if (expectedShare >= CODE_SWITCH_SHARE) {
    if (input.allowCodeSwitching) {
      return {
        detection,
        check: result(
          'uncertain',
          `Response mixes ${name(detection.detected)} with ${LANGUAGES[expected].name} (code-switching); a reviewer should decide whether it satisfies the requirement.`,
        ),
      };
    }
    return {
      detection,
      check: result(
        'fail',
        `Response is predominantly ${name(detection.detected)} and this case does not allow code-switching (expected ${LANGUAGES[expected].name}).`,
      ),
    };
  }

  if (detection.detected !== 'unknown' && detection.confidence >= FAIL_CONFIDENCE) {
    return {
      detection,
      check: result(
        'fail',
        `Response appears to be in ${name(detection.detected)} (confidence ${detection.confidence}); expected ${LANGUAGES[expected].name}.`,
      ),
    };
  }

  return {
    detection,
    check: result(
      'uncertain',
      `Could not confirm the response is in ${LANGUAGES[expected].name} (best guess: ${name(detection.detected)}, confidence ${detection.confidence}).`,
    ),
  };
}
