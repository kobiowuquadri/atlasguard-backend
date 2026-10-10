import { describe, expect, it } from 'vitest';
import { detectLanguage } from '../src/language/detect';
import { checkLanguageCompliance } from '../src/checks/language';

const SAMPLES = {
  en: 'A savings account is a bank account that helps you keep your money safe, and some banks also pay interest on it.',
  yo: 'Àkáǹtì ìfowópamọ́ jẹ́ àkáǹtì tí ó ń ràn ọ́ lọ́wọ́ láti fi owó pamọ́ láìléwu, àwọn báǹkì kan sì máa ń san èlé lórí rẹ̀.',
  yoNoTones: 'Akanti ifowopamo je akanti ti o n ran o lowo lati fi owo pamo, awon banki kan si maa n san ele lori re.',
  ha: 'Asusun ajiya yana taimaka maka ka adana kuɗinka cikin aminci, kuma wasu bankuna suna biyan riba a kansa.',
  ig: 'Akaụntụ nchekwa bụ akaụntụ ụlọ akụ nke na-enyere gị aka ichekwa ego gị n’enweghị nsogbu, ụfọdụ ụlọ akụ na-akwụkwa ọmụrụnwa.',
  pcm: 'Abeg, wetin dey happen for dis bank? Dem don collect my money and dem no wan return am.',
};

describe('detectLanguage', () => {
  it.each([
    ['en', SAMPLES.en, 'en-NG'],
    ['yo', SAMPLES.yo, 'yo'],
    ['yo (no tone marks)', SAMPLES.yoNoTones, 'yo'],
    ['ha', SAMPLES.ha, 'ha'],
    ['ig', SAMPLES.ig, 'ig'],
    ['pcm', SAMPLES.pcm, 'pcm'],
  ])('identifies %s', (_label, text, expected) => {
    const result = detectLanguage(text);
    expect(result.detected).toBe(expected);
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('returns unknown with zero confidence when there is no evidence', () => {
    const result = detectLanguage('12345 67890');
    expect(result.detected).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('reports code-switching when two languages carry substantial evidence', () => {
    const result = detectLanguage(
      'Mo fẹ́ ṣí àkáǹtì ìfowópamọ́ ní báǹkì, but I am not sure which bank is the best one for students and workers.',
    );
    expect(result.codeSwitching).toBe(true);
  });
});

describe('checkLanguageCompliance', () => {
  it('passes a response in the expected language', () => {
    const { check } = checkLanguageCompliance({ response: SAMPLES.ha, expected: 'ha', allowCodeSwitching: true });
    expect(check.status).toBe('pass');
    expect(check.method).toBe('lexicon-orthography/v1');
  });

  it('fails a response clearly in another language', () => {
    const { check } = checkLanguageCompliance({ response: SAMPLES.en, expected: 'yo', allowCodeSwitching: true });
    expect(check.status).toBe('fail');
    expect(check.explanation).toContain('Nigerian English');
  });

  it('marks very short responses as uncertain rather than failing them', () => {
    const { check } = checkLanguageCompliance({ response: 'Bẹ́ẹ̀ni.', expected: 'yo', allowCodeSwitching: true });
    expect(check.status).toBe('uncertain');
    expect(check.requiresHumanReview).toBe(true);
  });

  it('routes Pidgin answers to Nigerian English prompts to review', () => {
    const { check } = checkLanguageCompliance({ response: SAMPLES.pcm, expected: 'en-NG', allowCodeSwitching: true });
    expect(check.status).toBe('uncertain');
  });

  it('does not automatically fail code-switched responses', () => {
    const { check } = checkLanguageCompliance({
      response:
        'Àkáǹtì ìfowópamọ́ jẹ́ ibi tí o ti lè fi owó pamọ́. It is the account where you keep the money that you are saving for the future.',
      expected: 'yo',
      allowCodeSwitching: true,
    });
    expect(check.status).not.toBe('fail');
  });

  it('is not applicable when the case accepts any language', () => {
    const { check, detection } = checkLanguageCompliance({ response: SAMPLES.en, expected: 'any', allowCodeSwitching: true });
    expect(check.status).toBe('not_applicable');
    expect(detection).toBeNull();
  });
});
