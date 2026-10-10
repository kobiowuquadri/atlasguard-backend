import { foldText } from './fold';

export interface ExtractedNumber {
  value: number;
  /** Exact text that produced the value. */
  raw: string;
  /** Index range in the original text. */
  start: number;
  end: number;
  isPercent: boolean;
  /** Preceded by ₦ / N / NGN / # or followed by "naira". */
  isCurrency: boolean;
}

const MULTIPLIERS: Readonly<Record<string, number>> = {
  k: 1_000,
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

/**
 * Digits with optional comma thousands separators and decimals (Nigerian convention:
 * "5,050.00"), followed by an optional multiplier ("5k", "2 million") or percent sign.
 * Numbers written in words are deliberately not interpreted; callers treat their absence
 * as "needs review" rather than as a failure.
 */
const NUMBER_PATTERN =
  /(?<!\d)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?!\d)(?:\s?(k|thousand|million|billion)(?!\p{L})|\s?(%))?/giu;

const CURRENCY_BEFORE = /(₦|\bNGN|\bN|#)\s?$/u;

export function extractNumbers(text: string): ExtractedNumber[] {
  const results: ExtractedNumber[] = [];
  for (const m of text.matchAll(NUMBER_PATTERN)) {
    const [raw, intPart, decimals, multiplierWord, percent] = m;
    const start = m.index ?? 0;
    let value = Number(`${intPart!.replace(/,/g, '')}${decimals ? `.${decimals}` : ''}`);
    if (!Number.isFinite(value)) continue;
    if (multiplierWord) value *= MULTIPLIERS[multiplierWord.toLowerCase()] ?? 1;
    const before = text.slice(Math.max(0, start - 4), start);
    const after = foldText(text.slice(start + raw.length, start + raw.length + 12));
    results.push({
      value,
      raw: raw.trim(),
      start,
      end: start + raw.length,
      isPercent: Boolean(percent),
      isCurrency: CURRENCY_BEFORE.test(before) || /^(naira|ngn)\b/u.test(after),
    });
  }
  return results;
}

export function numbersMatch(a: number, b: number, tolerance = 0): boolean {
  return Math.abs(a - b) <= tolerance + 1e-9;
}

/**
 * Narrows candidate numbers using the fact's unit, when the unit is one AtlasGuard
 * understands. Returns the input unchanged when the narrowing would leave nothing.
 */
export function filterByUnit(numbers: ExtractedNumber[], unit: string | undefined): ExtractedNumber[] {
  if (!unit) return numbers;
  let narrowed: ExtractedNumber[];
  switch (unit.toUpperCase()) {
    case 'NGN':
      narrowed = numbers.filter((n) => n.isCurrency);
      break;
    case '%':
      narrowed = numbers.filter((n) => n.isPercent);
      break;
    case 'YEAR':
      narrowed = numbers.filter((n) => Number.isInteger(n.value) && n.value >= 1000 && n.value <= 2200);
      break;
    default:
      return numbers;
  }
  return narrowed.length > 0 ? narrowed : numbers;
}
