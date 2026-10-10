/**
 * Text folding for robust, explainable phrase matching across Nigerian orthographies.
 *
 * Model output in Yoruba, Hausa and Igbo frequently omits tone marks, subdots and hooked
 * letters (ẹ → e, ṣ → s, ị → i, ɗ → d, ƙ → k). Folding both the response and the reference
 * phrases makes matching tolerant of that, while `sourceIndex` lets us quote the original,
 * unfolded text as evidence.
 */

const LETTER_FOLDS: Readonly<Record<string, string>> = {
  'ɗ': 'd',
  'Ɗ': 'd',
  'ɓ': 'b',
  'Ɓ': 'b',
  'ƙ': 'k',
  'Ƙ': 'k',
  'ƴ': 'y',
  'Ƴ': 'y',
  'ŋ': 'n',
  'Ŋ': 'n',
};

const APOSTROPHE_LIKE = new Set(['‘', '’', 'ʼ', 'ʻ', '`', '´']);
const COMBINING_MARKS = /\p{M}/gu;
const WHITESPACE = /\s/u;

export interface FoldedText {
  /** Lowercase text with diacritics removed, special letters mapped and whitespace collapsed. */
  text: string;
  /** sourceIndex[i] is the index in `original` of the character that produced text[i]. */
  sourceIndex: number[];
  original: string;
}

export function fold(original: string): FoldedText {
  const out: string[] = [];
  const sourceIndex: number[] = [];
  let pendingSpace = false;
  let i = 0;
  while (i < original.length) {
    const ch = String.fromCodePoint(original.codePointAt(i)!);
    if (WHITESPACE.test(ch)) {
      pendingSpace = out.length > 0;
      i += ch.length;
      continue;
    }
    let folded = ch.normalize('NFD').replace(COMBINING_MARKS, '');
    folded = LETTER_FOLDS[folded] ?? folded;
    if (APOSTROPHE_LIKE.has(folded)) folded = "'";
    folded = folded.toLowerCase();
    if (folded.length > 0) {
      if (pendingSpace) {
        out.push(' ');
        sourceIndex.push(i);
        pendingSpace = false;
      }
      for (let k = 0; k < folded.length; k++) {
        out.push(folded[k]!);
        sourceIndex.push(i);
      }
    }
    i += ch.length;
  }
  return { text: out.join(''), sourceIndex, original };
}

/** Folds a string without keeping the index map. */
export function foldText(value: string): string {
  return fold(value).text;
}

/** Splits folded text into words (letters, digits and inner apostrophes). */
export function words(foldedText: string): string[] {
  return foldedText
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length > 0);
}

export interface PhraseMatch {
  /** The reference phrase as written in the dataset. */
  phrase: string;
  /** Matched range in the folded text. */
  start: number;
  end: number;
  /** The matched folded text (useful when the phrase is a prefix pattern). */
  matched: string;
}

const phraseCache = new Map<string, RegExp | null>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles a dataset phrase into a whole-word, diacritic-insensitive matcher.
 * A single trailing `*` turns the last word into a prefix (e.g. `sav*`).
 */
export function compilePhrase(phrase: string): RegExp | null {
  const cached = phraseCache.get(phrase);
  if (cached !== undefined) return cached;
  const isPrefix = phrase.endsWith('*');
  const core = foldText(isPrefix ? phrase.slice(0, -1) : phrase);
  let compiled: RegExp | null = null;
  if (core.length > 0) {
    const body = core.split(' ').map(escapeRegExp).join('\\s+');
    const tail = isPrefix ? "[\\p{L}\\p{N}']*" : '';
    compiled = new RegExp(`(?<![\\p{L}\\p{N}])${body}${tail}(?![\\p{L}\\p{N}])`, 'u');
  }
  phraseCache.set(phrase, compiled);
  return compiled;
}

/** Returns the earliest match of any phrase in the folded text, or null. */
export function findFirstPhrase(folded: FoldedText, phrases: readonly string[] | undefined): PhraseMatch | null {
  let best: PhraseMatch | null = null;
  for (const phrase of phrases ?? []) {
    const re = compilePhrase(phrase);
    if (!re) continue;
    const m = re.exec(folded.text);
    if (m && (best === null || m.index < best.start)) {
      best = { phrase, start: m.index, end: m.index + m[0].length, matched: m[0] };
    }
  }
  return best;
}

/** Every phrase that occurs at least once (first occurrence of each). */
export function findAllPhrases(folded: FoldedText, phrases: readonly string[] | undefined): PhraseMatch[] {
  const matches: PhraseMatch[] = [];
  for (const phrase of phrases ?? []) {
    const re = compilePhrase(phrase);
    if (!re) continue;
    const m = re.exec(folded.text);
    if (m) matches.push({ phrase, start: m.index, end: m.index + m[0].length, matched: m[0] });
  }
  return matches.sort((a, b) => a.start - b.start);
}

/** Quotes the original (unfolded) text around a folded range, for use as evidence. */
export function snippet(folded: FoldedText, start: number, end: number, radius = 60): string {
  const { original, sourceIndex } = folded;
  if (sourceIndex.length === 0) return '';
  const from = sourceIndex[Math.min(start, sourceIndex.length - 1)] ?? 0;
  const lastSource = sourceIndex[Math.min(Math.max(start, end - 1), sourceIndex.length - 1)] ?? from;
  let to = lastSource + String.fromCodePoint(original.codePointAt(lastSource) ?? 32).length;
  while (to < original.length && /\p{M}/u.test(original[to]!)) to++;
  const left = Math.max(0, from - radius);
  const right = Math.min(original.length, to + radius);
  const body = original.slice(left, right).replace(/\s+/g, ' ').trim();
  return `${left > 0 ? '…' : ''}${body}${right < original.length ? '…' : ''}`;
}

/** Quotes original text around an index range of the *original* string. */
export function originalSnippet(original: string, start: number, end: number, radius = 60): string {
  const left = Math.max(0, start - radius);
  const right = Math.min(original.length, end + radius);
  const body = original.slice(left, right).replace(/\s+/g, ' ').trim();
  return `${left > 0 ? '…' : ''}${body}${right < original.length ? '…' : ''}`;
}
