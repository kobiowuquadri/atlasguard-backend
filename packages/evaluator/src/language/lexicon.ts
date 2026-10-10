/**
 * Lexical evidence for language identification.
 *
 * Words are stored in folded form (lowercase, no diacritics, ɗ→d, ƙ→k) because model
 * output often drops tone marks. Lists favour high-frequency function words; content
 * loanwords that appear across Nigerian languages ("bank", "naira", "account") are left
 * out on purpose so they do not count as evidence for English.
 *
 * `strong` words are distinctive for the language; `weak` words also occur in at least
 * one other language and therefore count for less.
 *
 * These lists are an explainable heuristic, not a trained classifier. They should be
 * reviewed and extended by fluent speakers (see docs/evaluation-methodology.md).
 */

export type LexiconLanguage = 'en' | 'yo' | 'ha' | 'ig' | 'pcm';

export interface Lexicon {
  strong: ReadonlySet<string>;
  weak: ReadonlySet<string>;
}

const set = (...items: string[]) => new Set(items);

export const LEXICONS: Readonly<Record<LexiconLanguage, Lexicon>> = {
  en: {
    strong: set(
      'the', 'is', 'are', 'was', 'were', 'and', 'of', 'that', 'this', 'these', 'those', 'with', 'for',
      'from', 'which', 'what', 'when', 'where', 'who', 'will', 'would', 'should', 'could', 'have', 'has',
      'had', 'been', 'being', 'your', 'their', 'there', 'they', 'it', 'its', "it's", 'into', 'about',
      'because', 'also', 'than', 'then', 'them', 'such', 'only', 'very', 'can', 'may', 'must', 'not',
      'but', 'or', 'an', 'by', 'as', 'at', 'on', 'in', 'to', 'be', 'if', 'you', 'we', 'our', 'does',
      'did', 'more', 'most', 'some', 'any', 'each', 'other', 'how', 'why', 'all', 'just', 'after',
      'before', 'between', 'through', 'during', 'without', 'within', 'however', 'therefore', 'means',
      "don't", "doesn't", "isn't", "aren't", "can't", "won't", 'usually', 'often', 'example',
      'important', 'called', 'used', 'help', 'keep', 'safe', 'person', 'people', 'country', 'answer',
      'every', 'until', 'per', 'once', 'twice', 'times', 'take', 'hour', 'hours', 'day', 'days', 'week', 'weeks',
      'year', 'years', 'should', 'please', 'here',
    ),
    weak: set('do', 'so', 'one', 'like', 'my', 'me', 'he', 'she', 'his', 'her', 'go', 'make', 'come', 'no', 'get'),
  },
  yo: {
    strong: set(
      'ati', 'awon', 'ti', 'ni', 'fun', 'lati', 'pe', 'naa', 'yii', 'eyi', 'won', 'ninu', 'sugbon',
      'gbogbo', 'pelu', 'nitori', 'tabi', 'nipa', 'eniyan', 'lori', 'ohun', 'gege', 'iye', 'owo', 'ile',
      'ojo', 'maa', 'yoo', 'se', 'lo', 'omo', 'ilu', 'orile', 'ede', 'ijoba', 'ifowopamo', 'isiro',
      'nigba', 'bayii', 'sii', 'wonyi', 'kini', 'kilode', 'bawo', 'nibo', 'tani', 'ohunkohun', 'oun',
      'pataki', 'apeere', 'tumo', 'itumo', 'idahun', 'ibeere', 'nkan', 'sibe', 'ayafi', 'nikan', 'kankan',
      'eyiti', 'mi', 'wa', 'yin', 'yio', 'je', 'si',
    ),
    weak: set('mo', 'o', 'ko', 'kan', 'bi', 'ki', 'le', 'wo', 'ba', 'da', 'ku', 'ma', 'banki', 'ta'),
  },
  ha: {
    strong: set(
      'da', 'wannan', 'kuma', 'amma', 'saboda', 'domin', 'cikin', 'zuwa', 'akwai', 'yana', 'tana', 'suna',
      'kudi', 'mutane', 'mutum', 'gida', 'lokacin', 'lokaci', 'wanda', 'wadda', 'wadanda', 'abin',
      'abubuwa', 'zai', 'za', 'sosai', 'yadda', 'idan', 'kamar', 'tare', 'game', 'har', 'bayan', 'kafin',
      'duk', 'babu', 'ake', 'yake', 'take', 'dole', 'zama', 'hanya', 'daga', 'don', 'shine', 'shi', 'ita',
      'su', 'mu', 'ne', 'ce', 'ba', 'najeriya', 'ajiya', 'asusun', 'biyan', 'wato', 'misali', 'ma\'ana',
      'yanzu', 'kasar', 'kasa', 'jihohi', 'jiha', 'gwamnati', 'mece', 'menene', 'mene', 'yaya', 'ina',
      'shin', 'nawa', 'ko\'ina', 'haka', 'wajen', 'kowane', 'sai', 'kan', 'wani', 'wata', 'wasu',
      'ta', 'biya', 'ranar', 'kasuwa', 'kasuwar', 'kowace', 'tsawon', 'kwana', 'awa', 'sha', 'cewa', 'yi',
    ),
    weak: set('ni', 'ka', 'ko', 'ma', 'ga', 'ya', 'na', 'wa', 'je', 'ku', 'banki', 'maka'),
  },
  ig: {
    strong: set(
      'nke', 'bu', 'ndi', 'ihe', 'nwere', 'anyi', 'gi', 'unu', 'onye', 'otu', 'ebe', 'mgbe', 'ego',
      'ulo', 'oge', 'nile', "n'ime", "n'ihi", 'site', 'iji', 'obula', 'ezigbo', 'nwa', 'kwa', 'ike',
      'ahu', 'dika', 'ugbu', 'ndu', 'aka', 'ozi', 'nna', 'nne', 'isi', 'mana', 'oburu', 'kwesiri', 'nwee',
      'nyere', 'enyemaka', 'akauntu', 'di', 'ha', 'gini', 'kedu', 'olee', 'ole', 'onwe',
      'nso', 'mere', 'ndia', 'nkea', 'ugwo', 'akwukwo', 'obodo', 'ala', 'nchekwa',
      'chekwaa', 'ichekwa', 'puru', 'nwekwara', 'kariri', 'inye', 'ezi',
    ),
    weak: set('na', 'ya', 'ma', 'o', 'si', 'm', 'ba', 'bi', 'ka', 'ga', 'maka'),
  },
  pcm: {
    strong: set(
      'dey', 'wey', 'una', 'wetin', 'abeg', 'sabi', 'pikin', 'comot', 'oya', 'sef', 'abi', 'dis', 'dat',
      'wan', 'dem', 'don', 'im', 'sha', 'nau', 'shey', 'wahala', 'chop', 'gist', 'sey', 'pesin', 'kain',
    ),
    weak: set('na', 'go', 'make', 'no', 'fit', 'di', 'e', 'o'),
  },
};

/**
 * Orthographic markers counted on the NFD form of the original text. A marker is a base
 * letter plus a specific combining mark, or a standalone letter.
 */
export const ORTHOGRAPHIC_MARKERS: ReadonlyArray<{
  language: LexiconLanguage;
  weight: number;
  label: string;
  test: (base: string, marks: string) => boolean;
}> = [
  { language: 'yo', weight: 1, label: 'ẹ (e with dot below)', test: (b, m) => b === 'e' && m.includes('̣') },
  { language: 'yo', weight: 1, label: 'ṣ (s with dot below)', test: (b, m) => b === 's' && m.includes('̣') },
  { language: 'yo', weight: 0.4, label: 'ọ (o with dot below)', test: (b, m) => b === 'o' && m.includes('̣') },
  { language: 'ig', weight: 0.4, label: 'ọ (o with dot below)', test: (b, m) => b === 'o' && m.includes('̣') },
  { language: 'ig', weight: 1, label: 'ị (i with dot below)', test: (b, m) => b === 'i' && m.includes('̣') },
  { language: 'ig', weight: 1, label: 'ụ (u with dot below)', test: (b, m) => b === 'u' && m.includes('̣') },
  { language: 'ig', weight: 1, label: 'ṅ (n with dot above)', test: (b, m) => b === 'n' && m.includes('̇') },
  { language: 'yo', weight: 0.3, label: 'tone mark', test: (b, m) => /[aeiou]/.test(b) && /[̀́]/.test(m) },
  { language: 'ha', weight: 1, label: 'ɗ', test: (b) => b === 'ɗ' },
  { language: 'ha', weight: 1, label: 'ƙ', test: (b) => b === 'ƙ' },
  { language: 'ha', weight: 1, label: 'ɓ', test: (b) => b === 'ɓ' },
  { language: 'ha', weight: 1, label: 'ƴ', test: (b) => b === 'ƴ' },
];

/** Words that, appearing shortly before a matched phrase, may negate it. */
export const NEGATION_CUES: Readonly<Record<string, ReadonlySet<string>>> = {
  'en-NG': set('not', 'no', 'never', 'cannot', "can't", "don't", "doesn't", "isn't", "aren't", "won't", 'without', 'neither', 'nor'),
  yo: set('ko', 'kii', 'kosi', 'rara', 'ma'),
  ha: set('ba', 'babu', 'kada', 'kar', 'bai', 'ban', 'bata', 'basu'),
  ig: set('mba', 'abughi', 'adighi', 'enweghi', 'ogaghi', 'agaghi'),
};
