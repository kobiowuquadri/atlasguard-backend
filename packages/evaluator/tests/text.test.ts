import { describe, expect, it } from 'vitest';
import { extractNumbers } from '../src/text/numbers';
import { findFirstPhrase, fold, foldText, snippet, words } from '../src/text/fold';

describe('fold', () => {
  it('removes tone marks and subdots used in Yoruba and Igbo', () => {
    expect(foldText('Ẹ̀kọ́ ṣe pàtàkì')).toBe('eko se pataki');
    expect(foldText('Asụsụ Igbo bụ ụtọ')).toBe('asusu igbo bu uto');
  });

  it('maps Hausa hooked letters and normalises apostrophes', () => {
    expect(foldText('Kuɗi da ƙasa ɓarna')).toBe('kudi da kasa barna');
    expect(foldText('n’ime')).toBe("n'ime");
  });

  it('collapses whitespace and lowercases', () => {
    expect(foldText('  Savings \n\t Account  ')).toBe('savings account');
  });

  it('splits words without punctuation', () => {
    expect(words(foldText('Ọ bụ ego, ọ dị mma!'))).toEqual(['o', 'bu', 'ego', 'o', 'di', 'mma']);
  });
});

describe('phrase matching', () => {
  it('matches whole words diacritic-insensitively', () => {
    const text = fold('Ó máa ń fi owó pamọ́ sí ilé ìfowópamọ́.');
    expect(findFirstPhrase(text, ['ìfowópamọ́'])?.phrase).toBe('ìfowópamọ́');
    expect(findFirstPhrase(text, ['ifowopamo'])).not.toBeNull();
  });

  it('does not match inside longer words unless a prefix wildcard is used', () => {
    const text = fold('Savings accounts keep money safe.');
    expect(findFirstPhrase(text, ['saving'])).toBeNull();
    expect(findFirstPhrase(text, ['saving*'])?.matched).toBe('savings');
  });

  it('quotes the original text, with diacritics, as evidence', () => {
    const text = fold('Olú-ìlú Nàìjíríà ni Àbújá.');
    const match = findFirstPhrase(text, ['Abuja'])!;
    expect(snippet(text, match.start, match.end)).toContain('Àbújá');
  });
});

describe('extractNumbers', () => {
  it('parses naira amounts with separators and decimals', () => {
    const [n] = extractNumbers('The total is ₦5,050.00 today.');
    expect(n).toMatchObject({ value: 5050, isCurrency: true });
  });

  it('recognises N and # prefixes and trailing "naira"', () => {
    expect(extractNumbers('N5,000')[0]).toMatchObject({ value: 5000, isCurrency: true });
    expect(extractNumbers('#300 only')[0]).toMatchObject({ value: 300, isCurrency: true });
    expect(extractNumbers('pay 750 naira')[0]).toMatchObject({ value: 750, isCurrency: true });
    expect(extractNumbers('IN 2024 we')[0]).toMatchObject({ value: 2024, isCurrency: false });
  });

  it('applies k / thousand / million multipliers and detects percentages', () => {
    expect(extractNumbers('about 5k')[0]!.value).toBe(5000);
    expect(extractNumbers('2 million people')[0]!.value).toBe(2_000_000);
    expect(extractNumbers('rate of 15%')[0]).toMatchObject({ value: 15, isPercent: true });
    expect(extractNumbers('5 km away')[0]!.value).toBe(5);
  });

  it('returns every number in order', () => {
    expect(extractNumbers('36 states and 774 local governments since 1960').map((n) => n.value)).toEqual([36, 774, 1960]);
  });
});
