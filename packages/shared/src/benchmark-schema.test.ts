import { describe, expect, it } from 'vitest';
import { parseBenchmarkDataset } from './benchmark-schema';

const provenance = { sourceType: 'synthetic', reviewStatus: 'pending_review' } as const;

function dataset(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    suite: { slug: 'test-suite', name: 'Test suite', version: '1.0.0' },
    semanticGroups: [
      {
        key: 'capital',
        title: 'Capital of Nigeria',
        category: 'civic_information',
        expectedFacts: [{ id: 'capital', type: 'entity', description: 'The capital is Abuja', accepted: ['Abuja'] }],
        cases: [
          { key: 'capital.en', language: 'en-NG', title: 'Capital (en)', prompt: 'What is the capital?', difficulty: 'easy', provenance },
          { key: 'capital.yo', language: 'yo', title: 'Capital (yo)', prompt: 'Kí ni olú-ìlú?', difficulty: 'easy', provenance },
        ],
      },
    ],
    ...overrides,
  };
}

describe('parseBenchmarkDataset', () => {
  it('accepts a valid dataset and applies defaults', () => {
    const result = parseBenchmarkDataset(dataset());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fact = result.dataset.semanticGroups[0]!.expectedFacts[0]!;
    expect(fact.required).toBe(true);
    expect(result.dataset.suite.visibility).toBe('private');
    expect(result.dataset.semanticGroups[0]!.cases[0]!.evaluationRules).toEqual([]);
  });

  it('rejects duplicate case keys across the dataset', () => {
    const input = dataset({
      cases: [
        {
          key: 'capital.en',
          language: 'en-NG',
          title: 'Duplicate',
          prompt: 'x',
          difficulty: 'easy',
          category: 'education',
          provenance,
        },
      ],
    });
    const result = parseBenchmarkDataset(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('duplicate case key "capital.en"'))).toBe(true);
  });

  it('rejects two variants of the same language inside one semantic group', () => {
    const input = dataset();
    input.semanticGroups[0]!.cases[1] = { ...input.semanticGroups[0]!.cases[1]!, language: 'en-NG', key: 'capital.en2' };
    const result = parseBenchmarkDataset(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain('already has a en-NG variant');
  });

  it('refuses "verified" content without reviewer metadata', () => {
    const input = dataset();
    input.semanticGroups[0]!.cases[0] = {
      ...input.semanticGroups[0]!.cases[0]!,
      provenance: { sourceType: 'synthetic', reviewStatus: 'verified' } as never,
    };
    const result = parseBenchmarkDataset(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('reviewedBy and reviewedAt'))).toBe(true);
  });

  it('rejects factIds that reference unknown facts', () => {
    const input = dataset();
    (input.semanticGroups[0]!.cases[0] as Record<string, unknown>).factIds = ['does-not-exist'];
    const result = parseBenchmarkDataset(input);
    expect(result.ok).toBe(false);
  });

  it('rejects regex-like wildcards in the middle of phrases', () => {
    const input = dataset();
    input.semanticGroups[0]!.expectedFacts[0] = {
      id: 'capital',
      type: 'entity',
      description: 'The capital is Abuja',
      accepted: ['Ab*ja'],
    };
    expect(parseBenchmarkDataset(input).ok).toBe(false);
  });

  it('warns when a concept fact lacks phrases for a case language', () => {
    const input = dataset();
    input.semanticGroups[0]!.expectedFacts = [
      { id: 'idea', type: 'concept', description: 'Mentions the idea', evidence: { 'en-NG': ['idea'] } } as never,
    ];
    const result = parseBenchmarkDataset(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('no yo evidence phrases');
  });
});
