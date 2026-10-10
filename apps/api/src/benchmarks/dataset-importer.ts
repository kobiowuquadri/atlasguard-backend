/**
 * Dataset import/export shared by the API and the seed script. Deliberately free of NestJS
 * decorators so it can run under plain `tsx`.
 */
import type { BenchmarkCase, ContentReviewStatus, Difficulty, Prisma, PrismaClient, SemanticGroup } from '@prisma/client';
import type { BenchmarkDataset, Provenance } from '@atlasguard/shared';
import { canonicalJson, sha256 } from '../common/crypto';

type Tx = Prisma.TransactionClient | PrismaClient;

export interface ImportOptions {
  ownerId: string | null;
  official: boolean;
  /** Overrides the dataset's visibility (non-admin imports are always private). */
  visibility: 'PUBLIC' | 'PRIVATE';
}

const REVIEW_STATUS: Record<Provenance['reviewStatus'], ContentReviewStatus> = {
  draft: 'DRAFT',
  pending_review: 'PENDING_REVIEW',
  verified: 'VERIFIED',
};

const toJson = (value: unknown) => value as Prisma.InputJsonValue;
const difficulty = (d: string) => d.toUpperCase() as Difficulty;

export function datasetContentHash(dataset: BenchmarkDataset): string {
  return sha256(canonicalJson(dataset));
}

export function namespaceFor(options: Pick<ImportOptions, 'official' | 'ownerId'>): string {
  return options.official ? 'official' : `user:${options.ownerId}`;
}

/** Inserts a validated dataset as a new suite. Call inside a transaction. */
export async function importDataset(tx: Tx, dataset: BenchmarkDataset, options: ImportOptions) {
  const suite = await tx.benchmarkSuite.create({
    data: {
      namespace: namespaceFor(options),
      slug: dataset.suite.slug,
      name: dataset.suite.name,
      description: dataset.suite.description ?? null,
      version: dataset.suite.version,
      visibility: options.visibility,
      isOfficial: options.official,
      ownerId: options.ownerId,
      contentHash: datasetContentHash(dataset),
      formatVersion: dataset.formatVersion,
    },
  });

  let position = 0;
  for (const group of dataset.semanticGroups) {
    const created = await tx.semanticGroup.create({
      data: {
        suiteId: suite.id,
        key: group.key,
        title: group.title,
        description: group.description ?? null,
        category: group.category,
        expectedFacts: toJson(group.expectedFacts),
      },
    });
    const allFactIds = group.expectedFacts.map((f) => f.id);
    await tx.benchmarkCase.createMany({
      data: group.cases.map((c) => ({
        suiteId: suite.id,
        semanticGroupId: created.id,
        key: c.key,
        title: c.title,
        description: c.description ?? null,
        language: c.language,
        category: group.category,
        difficulty: difficulty(c.difficulty),
        prompt: c.prompt,
        factIds: c.factIds ?? allFactIds,
        expectedFacts: toJson([]),
        requiredTerms: c.requiredTerms ?? [],
        forbiddenTerms: c.forbiddenTerms ?? [],
        evaluationRules: toJson(c.evaluationRules),
        provenance: toJson(c.provenance),
        reviewStatus: REVIEW_STATUS[c.provenance.reviewStatus],
        reviewedAt: c.provenance.reviewedAt ? new Date(c.provenance.reviewedAt) : null,
        tags: c.tags,
        position: position++,
      })),
    });
  }

  if (dataset.cases.length > 0) {
    await tx.benchmarkCase.createMany({
      data: dataset.cases.map((c) => ({
        suiteId: suite.id,
        semanticGroupId: null,
        key: c.key,
        title: c.title,
        description: c.description ?? null,
        language: c.language,
        category: c.category,
        difficulty: difficulty(c.difficulty),
        prompt: c.prompt,
        factIds: [],
        expectedFacts: toJson(c.expectedFacts),
        requiredTerms: c.requiredTerms ?? [],
        forbiddenTerms: c.forbiddenTerms ?? [],
        evaluationRules: toJson(c.evaluationRules),
        provenance: toJson(c.provenance),
        reviewStatus: REVIEW_STATUS[c.provenance.reviewStatus],
        reviewedAt: c.provenance.reviewedAt ? new Date(c.provenance.reviewedAt) : null,
        tags: c.tags,
        position: position++,
      })),
    });
  }
  return suite;
}

function exportProvenance(c: BenchmarkCase): Record<string, unknown> {
  const provenance = { ...(c.provenance as Record<string, unknown>) };
  if (c.reviewStatus === 'VERIFIED') {
    provenance.reviewStatus = 'verified';
  } else if (c.reviewStatus === 'REJECTED') {
    provenance.reviewStatus = 'draft';
    provenance.notes = [provenance.notes, 'Rejected by a reviewer in AtlasGuard.'].filter(Boolean).join(' ');
  } else {
    provenance.reviewStatus = c.reviewStatus === 'DRAFT' ? 'draft' : 'pending_review';
  }
  return provenance;
}

function exportCase(c: BenchmarkCase) {
  return {
    key: c.key,
    language: c.language,
    title: c.title,
    ...(c.description && { description: c.description }),
    prompt: c.prompt,
    difficulty: c.difficulty.toLowerCase(),
    tags: c.tags,
    ...(c.requiredTerms.length > 0 && { requiredTerms: c.requiredTerms }),
    ...(c.forbiddenTerms.length > 0 && { forbiddenTerms: c.forbiddenTerms }),
    evaluationRules: c.evaluationRules,
    provenance: exportProvenance(c),
  };
}

/** Rebuilds an importable dataset (formatVersion 1) from stored rows. */
export function exportDataset(
  suite: { slug: string; name: string; description: string | null; version: string; visibility: string },
  groups: SemanticGroup[],
  cases: BenchmarkCase[],
) {
  const active = cases.filter((c) => !c.archivedAt).sort((a, b) => a.position - b.position);
  return {
    formatVersion: 1,
    suite: {
      slug: suite.slug,
      name: suite.name,
      ...(suite.description && { description: suite.description }),
      version: suite.version,
      visibility: suite.visibility.toLowerCase(),
    },
    semanticGroups: groups.map((g) => {
      const facts = g.expectedFacts as Array<{ id: string }>;
      return {
        key: g.key,
        title: g.title,
        ...(g.description && { description: g.description }),
        category: g.category,
        expectedFacts: facts,
        cases: active
          .filter((c) => c.semanticGroupId === g.id)
          .map((c) => ({
            ...exportCase(c),
            ...(c.factIds.length !== facts.length && { factIds: c.factIds }),
          })),
      };
    }),
    cases: active
      .filter((c) => !c.semanticGroupId)
      .map((c) => ({ ...exportCase(c), category: c.category, expectedFacts: c.expectedFacts })),
  };
}
