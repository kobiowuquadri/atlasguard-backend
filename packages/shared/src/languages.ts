/**
 * Languages AtlasGuard evaluates. The list is deliberately closed: a language is only
 * added here once benchmark cases and language checks for it exist and have been tested.
 */
export const SUPPORTED_LANGUAGES = ['en-NG', 'yo', 'ha', 'ig'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export interface LanguageInfo {
  code: SupportedLanguage;
  /** English name shown in the UI. */
  name: string;
  /** Endonym. */
  nativeName: string;
  /** ISO 639-3 code, useful when talking to language-identification tooling. */
  iso6393: string;
}

export const LANGUAGES: Readonly<Record<SupportedLanguage, LanguageInfo>> = {
  'en-NG': { code: 'en-NG', name: 'Nigerian English', nativeName: 'Nigerian English', iso6393: 'eng' },
  yo: { code: 'yo', name: 'Yoruba', nativeName: 'Èdè Yorùbá', iso6393: 'yor' },
  ha: { code: 'ha', name: 'Hausa', nativeName: 'Harshen Hausa', iso6393: 'hau' },
  ig: { code: 'ig', name: 'Igbo', nativeName: 'Asụsụ Igbo', iso6393: 'ibo' },
};

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function languageName(code: string): string {
  return isSupportedLanguage(code) ? LANGUAGES[code].name : code;
}
