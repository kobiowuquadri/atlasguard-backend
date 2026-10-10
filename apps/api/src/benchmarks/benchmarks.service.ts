import { Injectable } from '@nestjs/common';
import type { BenchmarkSuite, Prisma } from '@prisma/client';
import { parseBenchmarkDataset, type BenchmarkDataset } from '@atlasguard/shared';
import { AppException } from '../common/app-exception';
import type { AuthContext } from '../common/auth-context';
import { pageArgs, paginated } from '../common/pagination';
import { PrismaService } from '../database/prisma.service';
import type { ImportBenchmarkDto, ListBenchmarksQueryDto, ListCasesQueryDto, ReviewCaseDto } from './benchmarks.dto';
import { resolveCaseFacts } from './case-definition';
import { datasetContentHash, exportDataset, importDataset, namespaceFor } from './dataset-importer';

export interface SuiteStats {
  caseCount: number;
  semanticGroupCount: number;
  languages: Record<string, number>;
  categories: Record<string, number>;
  reviewStatus: Record<string, number>;
  verifiedCount: number;
  unreviewedCount: number;
}

const emptyStats = (): SuiteStats => ({
  caseCount: 0,
  semanticGroupCount: 0,
  languages: {},
  categories: {},
  reviewStatus: {},
  verifiedCount: 0,
  unreviewedCount: 0,
});

@Injectable()
export class BenchmarksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Suites the caller may read: public/official ones and their own. */
  private visibleWhere(auth: AuthContext): Prisma.BenchmarkSuiteWhereInput {
    return { archivedAt: null, OR: [{ visibility: 'PUBLIC' }, { ownerId: auth.user.id }] };
  }

  async requireVisibleSuite(auth: AuthContext, id: string): Promise<BenchmarkSuite> {
    const suite = await this.prisma.benchmarkSuite.findFirst({ where: { id, ...this.visibleWhere(auth) } });
    if (!suite) throw AppException.notFound('Benchmark suite');
    return suite;
  }

  private canManage(auth: AuthContext, suite: BenchmarkSuite): boolean {
    return suite.isOfficial ? auth.user.role === 'ADMIN' : suite.ownerId === auth.user.id;
  }

  async stats(suiteIds: string[]): Promise<Map<string, SuiteStats>> {
    const result = new Map(suiteIds.map((id) => [id, emptyStats()]));
    if (suiteIds.length === 0) return result;
    const [rows, groups] = await Promise.all([
      this.prisma.benchmarkCase.groupBy({
        by: ['suiteId', 'language', 'category', 'reviewStatus'],
        where: { suiteId: { in: suiteIds }, archivedAt: null },
        _count: { _all: true },
      }),
      this.prisma.semanticGroup.groupBy({ by: ['suiteId'], where: { suiteId: { in: suiteIds } }, _count: { _all: true } }),
    ]);
    for (const row of rows) {
      const s = result.get(row.suiteId)!;
      const n = row._count._all;
      s.caseCount += n;
      s.languages[row.language] = (s.languages[row.language] ?? 0) + n;
      s.categories[row.category] = (s.categories[row.category] ?? 0) + n;
      s.reviewStatus[row.reviewStatus] = (s.reviewStatus[row.reviewStatus] ?? 0) + n;
      if (row.reviewStatus === 'VERIFIED') s.verifiedCount += n;
      else s.unreviewedCount += n;
    }
    for (const g of groups) result.get(g.suiteId)!.semanticGroupCount = g._count._all;
    return result;
  }

  async list(auth: AuthContext, query: ListBenchmarksQueryDto) {
    const where: Prisma.BenchmarkSuiteWhereInput = {
      ...this.visibleWhere(auth),
      ...(query.search && {
        AND: [
          {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          },
        ],
      }),
      ...((query.language || query.category) && {
        cases: {
          some: {
            archivedAt: null,
            ...(query.language && { language: query.language }),
            ...(query.category && { category: query.category }),
          },
        },
      }),
    };
    const [suites, total] = await this.prisma.$transaction([
      this.prisma.benchmarkSuite.findMany({
        where,
        orderBy: [{ isOfficial: 'desc' }, { createdAt: 'desc' }],
        ...pageArgs(query),
        include: { owner: { select: { id: true, name: true } } },
      }),
      this.prisma.benchmarkSuite.count({ where }),
    ]);
    const stats = await this.stats(suites.map((s) => s.id));
    const items = suites.map((s) => ({ ...s, stats: stats.get(s.id)!, canManage: this.canManage(auth, s) }));
    return paginated(items, total, query);
  }

  async get(auth: AuthContext, id: string) {
    const suite = await this.requireVisibleSuite(auth, id);
    const [stats, groups, owner] = await Promise.all([
      this.stats([id]),
      this.prisma.semanticGroup.findMany({
        where: { suiteId: id },
        orderBy: { createdAt: 'asc' },
        include: { cases: { where: { archivedAt: null }, select: { id: true, language: true, reviewStatus: true } } },
      }),
      suite.ownerId ? this.prisma.user.findUnique({ where: { id: suite.ownerId }, select: { id: true, name: true } }) : null,
    ]);
    return {
      ...suite,
      owner,
      stats: stats.get(id)!,
      canManage: this.canManage(auth, suite),
      semanticGroups: groups.map(({ cases, expectedFacts, ...g }) => ({
        ...g,
        factCount: (expectedFacts as unknown[]).length,
        expectedFacts,
        languages: cases.map((c) => c.language),
        caseIds: cases.map((c) => c.id),
      })),
    };
  }

  async listCases(auth: AuthContext, suiteId: string, query: ListCasesQueryDto) {
    await this.requireVisibleSuite(auth, suiteId);
    const where: Prisma.BenchmarkCaseWhereInput = {
      suiteId,
      archivedAt: null,
      ...(query.language && { language: query.language }),
      ...(query.category && { category: query.category }),
      ...(query.reviewStatus && { reviewStatus: query.reviewStatus as Prisma.EnumContentReviewStatusFilter['equals'] }),
      ...(query.semanticGroupId && { semanticGroupId: query.semanticGroupId }),
      ...(query.search && {
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { prompt: { contains: query.search, mode: 'insensitive' } },
          { key: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [cases, total] = await this.prisma.$transaction([
      this.prisma.benchmarkCase.findMany({
        where,
        orderBy: { position: 'asc' },
        ...pageArgs(query),
        include: { semanticGroup: true, reviewedBy: { select: { id: true, name: true } } },
      }),
      this.prisma.benchmarkCase.count({ where }),
    ]);
    const items = cases.map(({ semanticGroup, ...c }) => ({
      ...c,
      semanticGroup: semanticGroup ? { id: semanticGroup.id, key: semanticGroup.key, title: semanticGroup.title } : null,
      facts: resolveCaseFacts({ ...c, semanticGroup, reviewedBy: undefined } as never),
    }));
    return paginated(items, total, query);
  }

  /** Validates (and unless dryRun, saves) a dataset. Non-admins always create private suites. */
  async import(auth: AuthContext, dto: ImportBenchmarkDto) {
    if (dto.official && auth.user.role !== 'ADMIN') {
      throw AppException.forbidden('Only administrators can import official benchmark suites.');
    }
    const parsed = parseBenchmarkDataset(dto.dataset);
    if (!parsed.ok) {
      throw AppException.validation('The dataset does not match the AtlasGuard benchmark format.', parsed.errors);
    }
    const { dataset, warnings } = parsed;
    const official = Boolean(dto.official);
    const isAdmin = auth.user.role === 'ADMIN';
    const visibility = dataset.suite.visibility === 'public' && isAdmin ? 'PUBLIC' : 'PRIVATE';
    const notes = [...warnings];
    if (dataset.suite.visibility === 'public' && !isAdmin) {
      notes.push({ path: 'suite.visibility', message: 'Imported as private: only administrators can publish public suites.' });
    }
    const counts = {
      semanticGroups: dataset.semanticGroups.length,
      cases: dataset.semanticGroups.reduce((n, g) => n + g.cases.length, 0) + dataset.cases.length,
    };
    if (dto.dryRun) {
      return { valid: true, saved: false, warnings: notes, counts, contentHash: datasetContentHash(dataset) };
    }
    const suite = await this.save(dataset, { ownerId: official ? null : auth.user.id, official, visibility });
    return { valid: true, saved: true, warnings: notes, counts, suite };
  }

  async save(dataset: BenchmarkDataset, options: { ownerId: string | null; official: boolean; visibility: 'PUBLIC' | 'PRIVATE' }) {
    const existing = await this.prisma.benchmarkSuite.findUnique({
      where: {
        namespace_slug_version: {
          namespace: namespaceFor(options),
          slug: dataset.suite.slug,
          version: dataset.suite.version,
        },
      },
    });
    if (existing) {
      throw AppException.conflict(
        `Suite "${dataset.suite.slug}" version ${dataset.suite.version} already exists. Increase the version to import changes.`,
      );
    }
    return this.prisma.$transaction((tx) => importDataset(tx, dataset, options), { timeout: 60_000 });
  }

  async export(auth: AuthContext, id: string) {
    const suite = await this.requireVisibleSuite(auth, id);
    const [groups, cases] = await Promise.all([
      this.prisma.semanticGroup.findMany({ where: { suiteId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.benchmarkCase.findMany({ where: { suiteId: id } }),
    ]);
    return { suite, dataset: exportDataset(suite, groups, cases) };
  }

  /**
   * Records a content review. Verification requires an explicit attestation and is stored
   * with the reviewer's identity; official suites can only be reviewed by administrators.
   */
  async reviewCase(auth: AuthContext, suiteId: string, caseId: string, dto: ReviewCaseDto) {
    const suite = await this.requireVisibleSuite(auth, suiteId);
    if (!this.canManage(auth, suite)) {
      throw AppException.forbidden(
        suite.isOfficial ? 'Only administrators can review official benchmark content.' : 'Only the suite owner can review its cases.',
      );
    }
    const benchmarkCase = await this.prisma.benchmarkCase.findFirst({ where: { id: caseId, suiteId, archivedAt: null } });
    if (!benchmarkCase) throw AppException.notFound('Benchmark case');

    const reviewer = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id }, select: { name: true } });
    const now = new Date();
    const provenance = { ...(benchmarkCase.provenance as Record<string, unknown>) };
    if (dto.status === 'VERIFIED') {
      provenance.reviewStatus = 'verified';
      provenance.reviewedBy = reviewer.name;
      provenance.reviewedAt = now.toISOString();
    } else {
      provenance.reviewStatus = dto.status === 'PENDING_REVIEW' ? 'pending_review' : 'draft';
      delete provenance.reviewedBy;
      delete provenance.reviewedAt;
    }
    return this.prisma.benchmarkCase.update({
      where: { id: caseId },
      data: {
        reviewStatus: dto.status,
        reviewedById: auth.user.id,
        reviewedAt: now,
        reviewNotes: dto.notes ?? null,
        provenance: provenance as Prisma.InputJsonValue,
      },
      include: { reviewedBy: { select: { id: true, name: true } } },
    });
  }
}
