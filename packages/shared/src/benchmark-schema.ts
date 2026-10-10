import { z } from 'zod';
import { BENCHMARK_CATEGORIES, DIFFICULTIES } from './constants';
import { SUPPORTED_LANGUAGES } from './languages';

/**
 * Benchmark dataset format (formatVersion 1).
 *
 * A dataset contains one suite. Questions that should mean the same thing in several
 * languages live in a semantic group: the group owns the language-independent expected
 * facts, and each language variant is a case. Standalone cases carry their own facts.
 *
 * Matching phrases are plain text (never regular expressions) so that imported datasets
 * cannot introduce catastrophic-backtracking patterns. A trailing `*` means "prefix".
 */

export const LanguageSchema = z.enum(SUPPORTED_LANGUAGES);
export const CategorySchema = z.enum(BENCHMARK_CATEGORIES);
export const DifficultySchema = z.enum(DIFFICULTIES);

const SlugSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase kebab-case');

export const KeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'may only contain letters, digits, ".", "_" and "-"');

const PhraseSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((p) => !p.slice(0, -1).includes('*'), 'only a single trailing "*" wildcard is allowed');

const PhraseListSchema = z.array(PhraseSchema).max(50);

/** Phrases keyed by language; languages may be omitted. */
export const LanguagePhrasesSchema = z.partialRecord(LanguageSchema, PhraseListSchema);

const factBase = {
  id: KeySchema,
  description: z.string().trim().min(3).max(500),
  required: z.boolean().default(true),
};

/** A number that must appear in the answer, e.g. a computed total. Language-independent. */
export const NumericFactSchema = z.object({
  ...factBase,
  type: z.literal('numeric'),
  value: z.number(),
  /** Absolute tolerance when comparing extracted numbers. */
  tolerance: z.number().nonnegative().default(0),
  unit: z.string().max(40).optional(),
  /** Numbers that appear in the prompt and must not be mistaken for the answer. */
  ignoreValues: z.array(z.number()).max(50).default([]),
  /** The number written out in words, per language (e.g. Yoruba numerals). */
  acceptedPhrases: LanguagePhrasesSchema.optional(),
});

/** A named entity that must be stated, e.g. "Abuja". */
export const EntityFactSchema = z.object({
  ...factBase,
  type: z.literal('entity'),
  /** Surface forms accepted in every language. */
  accepted: z.array(PhraseSchema).min(1).max(50),
  acceptedByLanguage: LanguagePhrasesSchema.optional(),
  /** Entities that would contradict the fact if asserted instead (e.g. "Lagos"). */
  conflicting: PhraseListSchema.default([]),
  conflictingByLanguage: LanguagePhrasesSchema.optional(),
});

/**
 * An open-ended concept. Matching is lexical evidence only, so concept results never
 * produce an automatic failure: misses and contradictions are routed to human review.
 */
export const ConceptFactSchema = z.object({
  ...factBase,
  type: z.literal('concept'),
  evidence: LanguagePhrasesSchema,
  contradictions: LanguagePhrasesSchema.optional(),
});

export const ExpectedFactSchema = z.discriminatedUnion('type', [
  NumericFactSchema,
  EntityFactSchema,
  ConceptFactSchema,
]);

export const EvaluationRuleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('response_language'),
    /** Defaults to the case language. `any` disables the language check. */
    language: z.union([LanguageSchema, z.literal('any')]).optional(),
    allowCodeSwitching: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('json_format'),
    requiredKeys: z.array(z.string().min(1).max(100)).max(50).default([]),
    allowCodeFence: z.boolean().default(true),
  }),
  z.object({ type: z.literal('max_words'), value: z.number().int().positive().max(10000) }),
  z.object({ type: z.literal('min_words'), value: z.number().int().positive().max(10000) }),
  z.object({
    type: z.literal('required_terms'),
    terms: z.array(PhraseSchema).min(1).max(50),
    mode: z.enum(['all', 'any']).default('all'),
  }),
  z.object({ type: z.literal('forbidden_terms'), terms: z.array(PhraseSchema).min(1).max(50) }),
  z.object({
    type: z.literal('forbidden_format'),
    format: z.enum(['markdown_table', 'code_block', 'bullet_list']),
  }),
  z.object({ type: z.literal('max_latency_ms'), value: z.number().int().positive().max(600000) }),
]);

export const ProvenanceSchema = z
  .object({
    sourceType: z.enum(['human', 'official', 'synthetic']),
    sourceReference: z.string().max(500).optional(),
    author: z.string().max(200).optional(),
    translationSource: z
      .enum(['original', 'human_translation', 'machine_translation', 'ai_generated'])
      .optional(),
    translatedFrom: LanguageSchema.optional(),
    reviewStatus: z.enum(['draft', 'pending_review', 'verified']),
    reviewedBy: z.string().max(200).optional(),
    reviewedAt: z.iso.datetime({ offset: true }).optional(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((p, ctx) => {
    if (p.reviewStatus === 'verified' && (!p.reviewedBy || !p.reviewedAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['reviewStatus'],
        message: '"verified" content must record reviewedBy and reviewedAt',
      });
    }
  });

const caseFields = {
  key: KeySchema,
  language: LanguageSchema,
  title: z.string().trim().min(3).max(200),
  description: z.string().max(1000).optional(),
  prompt: z.string().trim().min(1).max(4000),
  difficulty: DifficultySchema,
  tags: z.array(z.string().min(1).max(50)).max(20).default([]),
  requiredTerms: z.array(PhraseSchema).max(50).optional(),
  forbiddenTerms: z.array(PhraseSchema).max(50).optional(),
  evaluationRules: z.array(EvaluationRuleSchema).max(20).default([]),
  provenance: ProvenanceSchema,
};

/** A language variant inside a semantic group. */
export const GroupCaseSchema = z.object({
  ...caseFields,
  /** Subset of the group's facts that apply to this variant (default: all of them). */
  factIds: z.array(KeySchema).max(20).optional(),
});

export const StandaloneCaseSchema = z.object({
  ...caseFields,
  category: CategorySchema,
  expectedFacts: z.array(ExpectedFactSchema).max(20).default([]),
});

export const SemanticGroupSchema = z.object({
  key: KeySchema,
  title: z.string().trim().min(3).max(200),
  description: z.string().max(1000).optional(),
  category: CategorySchema,
  expectedFacts: z.array(ExpectedFactSchema).max(20).default([]),
  cases: z.array(GroupCaseSchema).min(1).max(20),
});

export const SuiteMetaSchema = z.object({
  slug: SlugSchema,
  name: z.string().trim().min(3).max(120),
  description: z.string().max(2000).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'must be a semantic version such as 1.0.0'),
  visibility: z.enum(['public', 'private']).default('private'),
});

export const BenchmarkDatasetSchema = z
  .object({
    $schema: z.string().optional(),
    formatVersion: z.literal(1),
    suite: SuiteMetaSchema,
    semanticGroups: z.array(SemanticGroupSchema).max(500).default([]),
    cases: z.array(StandaloneCaseSchema).max(2000).default([]),
  })
  .superRefine((dataset, ctx) => {
    const caseKeys = new Set<string>();
    const groupKeys = new Set<string>();
    const noteCaseKey = (key: string, path: (string | number)[]) => {
      if (caseKeys.has(key)) {
        ctx.addIssue({ code: 'custom', path, message: `duplicate case key "${key}"` });
      }
      caseKeys.add(key);
    };
    const checkFactIds = (facts: { id: string }[], path: (string | number)[]) => {
      const seen = new Set<string>();
      facts.forEach((fact, i) => {
        if (seen.has(fact.id)) {
          ctx.addIssue({ code: 'custom', path: [...path, i, 'id'], message: `duplicate fact id "${fact.id}"` });
        }
        seen.add(fact.id);
      });
      return seen;
    };

    dataset.semanticGroups.forEach((group, gi) => {
      if (groupKeys.has(group.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['semanticGroups', gi, 'key'],
          message: `duplicate semantic group key "${group.key}"`,
        });
      }
      groupKeys.add(group.key);
      const factIds = checkFactIds(group.expectedFacts, ['semanticGroups', gi, 'expectedFacts']);
      const languages = new Set<string>();
      group.cases.forEach((c, ci) => {
        const path = ['semanticGroups', gi, 'cases', ci];
        noteCaseKey(c.key, [...path, 'key']);
        if (languages.has(c.language)) {
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'language'],
            message: `semantic group "${group.key}" already has a ${c.language} variant`,
          });
        }
        languages.add(c.language);
        c.factIds?.forEach((id, fi) => {
          if (!factIds.has(id)) {
            ctx.addIssue({
              code: 'custom',
              path: [...path, 'factIds', fi],
              message: `unknown fact id "${id}" in semantic group "${group.key}"`,
            });
          }
        });
      });
    });

    dataset.cases.forEach((c, ci) => {
      noteCaseKey(c.key, ['cases', ci, 'key']);
      checkFactIds(c.expectedFacts, ['cases', ci, 'expectedFacts']);
    });

    if (caseKeys.size === 0) {
      ctx.addIssue({ code: 'custom', path: [], message: 'a dataset must contain at least one case' });
    }
  });

export type LanguagePhrases = z.infer<typeof LanguagePhrasesSchema>;
export type NumericFact = z.infer<typeof NumericFactSchema>;
export type EntityFact = z.infer<typeof EntityFactSchema>;
export type ConceptFact = z.infer<typeof ConceptFactSchema>;
export type ExpectedFact = z.infer<typeof ExpectedFactSchema>;
export type EvaluationRule = z.infer<typeof EvaluationRuleSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type GroupCase = z.infer<typeof GroupCaseSchema>;
export type StandaloneCase = z.infer<typeof StandaloneCaseSchema>;
export type SemanticGroupInput = z.infer<typeof SemanticGroupSchema>;
export type SuiteMeta = z.infer<typeof SuiteMetaSchema>;
export type BenchmarkDataset = z.infer<typeof BenchmarkDatasetSchema>;
/** The dataset as authored (defaults not yet applied). */
export type BenchmarkDatasetInput = z.input<typeof BenchmarkDatasetSchema>;

export interface DatasetIssue {
  path: string;
  message: string;
}

export type DatasetParseResult =
  | { ok: true; dataset: BenchmarkDataset; warnings: DatasetIssue[] }
  | { ok: false; errors: DatasetIssue[] };

function formatPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '(root)' : path.map((p) => String(p)).join('.');
}

/** Validates an untrusted dataset and reports structural errors and non-fatal warnings. */
export function parseBenchmarkDataset(input: unknown): DatasetParseResult {
  const parsed = BenchmarkDatasetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })),
    };
  }
  return { ok: true, dataset: parsed.data, warnings: lintBenchmarkDataset(parsed.data) };
}

/**
 * Non-fatal quality warnings: things that make automated evaluation weaker but are not
 * structurally invalid (for example a concept fact with no phrases for a case language).
 */
export function lintBenchmarkDataset(dataset: BenchmarkDataset): DatasetIssue[] {
  const warnings: DatasetIssue[] = [];
  const lintFacts = (
    facts: ExpectedFact[],
    language: string,
    applies: (id: string) => boolean,
    path: string,
  ) => {
    for (const fact of facts) {
      if (!applies(fact.id)) continue;
      if (fact.type === 'concept' && !fact.evidence[language as keyof typeof fact.evidence]?.length) {
        warnings.push({
          path,
          message: `concept fact "${fact.id}" has no ${language} evidence phrases; it will always require human review`,
        });
      }
    }
  };

  dataset.semanticGroups.forEach((group, gi) => {
    if (group.cases.length < 2) {
      warnings.push({
        path: `semanticGroups.${gi}`,
        message: `semantic group "${group.key}" has a single language variant, so cross-language consistency cannot be analysed`,
      });
    }
    group.cases.forEach((c, ci) => {
      const ids = c.factIds ? new Set(c.factIds) : null;
      lintFacts(group.expectedFacts, c.language, (id) => !ids || ids.has(id), `semanticGroups.${gi}.cases.${ci}`);
    });
  });
  dataset.cases.forEach((c, ci) => lintFacts(c.expectedFacts, c.language, () => true, `cases.${ci}`));
  return warnings;
}
