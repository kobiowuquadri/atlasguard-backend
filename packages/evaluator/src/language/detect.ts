import type { DetectedLanguage, LanguageDetectionResult } from '@atlasguard/shared';
import { fold, words } from '../text/fold';
import { METHODS } from '../version';
import { LEXICONS, ORTHOGRAPHIC_MARKERS, type LexiconLanguage } from './lexicon';

const STRONG_WEIGHT = 1;
const WEAK_WEIGHT = 0.35;
const MARKER_WEIGHT = 0.5;
/** Minimum share of recognised words before coverage stops reducing confidence. */
const FULL_COVERAGE = 0.2;
/** Word count at which text length stops reducing confidence. */
const FULL_LENGTH = 8;

const LANGS: LexiconLanguage[] = ['en', 'yo', 'ha', 'ig', 'pcm'];

function toDetected(lang: LexiconLanguage): DetectedLanguage {
  return lang === 'en' ? 'en-NG' : lang;
}

function countMarkers(text: string): { scores: Record<LexiconLanguage, number>; labels: string[] } {
  const scores: Record<LexiconLanguage, number> = { en: 0, yo: 0, ha: 0, ig: 0, pcm: 0 };
  const labels = new Set<string>();
  const decomposed = text.normalize('NFD').toLowerCase();
  let i = 0;
  while (i < decomposed.length) {
    const base = String.fromCodePoint(decomposed.codePointAt(i)!);
    i += base.length;
    let marks = '';
    while (i < decomposed.length && /\p{M}/u.test(decomposed[i]!)) {
      marks += decomposed[i];
      i++;
    }
    for (const marker of ORTHOGRAPHIC_MARKERS) {
      if (marker.test(base, marks)) {
        scores[marker.language] += marker.weight;
        labels.add(`${marker.language}:${marker.label}`);
      }
    }
  }
  return { scores, labels: [...labels] };
}

/**
 * Identifies the dominant language of a response using function-word lexicons and
 * orthographic markers. Every decision is explainable: `evidence` lists the words and
 * characters that contributed, and `shares` shows the full distribution.
 */
export function detectLanguage(text: string): LanguageDetectionResult {
  const tokens = words(fold(text).text).filter((w) => !/^\d/.test(w));
  const scores: Record<LexiconLanguage, number> = { en: 0, yo: 0, ha: 0, ig: 0, pcm: 0 };
  const hits: Record<LexiconLanguage, Map<string, number>> = {
    en: new Map(),
    yo: new Map(),
    ha: new Map(),
    ig: new Map(),
    pcm: new Map(),
  };
  let recognised = 0;

  for (const token of tokens) {
    let known = false;
    for (const lang of LANGS) {
      const lexicon = LEXICONS[lang];
      const weight = lexicon.strong.has(token) ? STRONG_WEIGHT : lexicon.weak.has(token) ? WEAK_WEIGHT : 0;
      if (weight > 0) {
        scores[lang] += weight;
        hits[lang].set(token, (hits[lang].get(token) ?? 0) + 1);
        known = true;
      }
    }
    if (known) recognised++;
  }

  const markers = countMarkers(text);
  for (const lang of LANGS) {
    scores[lang] += MARKER_WEIGHT * Math.min(markers.scores[lang], Math.max(tokens.length, 1));
  }

  const total = LANGS.reduce((sum, lang) => sum + scores[lang], 0);
  const shares: Partial<Record<DetectedLanguage, number>> = {};
  if (total > 0) {
    for (const lang of LANGS) {
      if (scores[lang] > 0) shares[toDetected(lang)] = round(scores[lang] / total);
    }
  }

  const ranked = [...LANGS].sort((a, b) => scores[b] - scores[a]);
  const best = ranked[0]!;
  const second = ranked[1]!;
  const wordCount = tokens.length;

  if (total === 0) {
    return {
      detected: 'unknown',
      confidence: 0,
      shares,
      method: METHODS.language,
      evidence: [],
      wordCount,
      codeSwitching: false,
    };
  }

  const bestShare = scores[best] / total;
  const secondShare = scores[second] / total;
  const coverage = wordCount > 0 ? recognised / wordCount : 0;
  const confidence = round(
    bestShare * Math.min(1, coverage / FULL_COVERAGE) * Math.min(1, wordCount / FULL_LENGTH),
  );
  const codeSwitching = secondShare >= 0.25 && scores[second] >= 2;

  const topWords = [...hits[best].entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([w, n]) => `${w}×${n}`);
  const evidence = [
    ...(topWords.length ? [`${toDetected(best)} words: ${topWords.join(', ')}`] : []),
    ...markers.labels.map((l) => `marker ${l}`),
  ];

  return {
    detected: toDetected(best),
    confidence,
    shares,
    method: METHODS.language,
    evidence,
    wordCount,
    codeSwitching,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
