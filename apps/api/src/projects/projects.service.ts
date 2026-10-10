import { Injectable } from '@nestjs/common';
import type { Prisma, Project } from '@prisma/client';
import { AppException } from '../common/app-exception';
import type { AuthContext } from '../common/auth-context';
import { pageArgs, paginated } from '../common/pagination';
import { PrismaService } from '../database/prisma.service';
import type { CreateProjectDto, ListProjectsQueryDto, UpdateProjectDto } from './projects.dto';

const RUN_PREVIEW = {
  id: true,
  status: true,
  isSimulated: true,
  totalCases: true,
  completedCases: true,
  summary: true,
  createdAt: true,
  completedAt: true,
  languages: true,
  suite: { select: { id: true, name: true, version: true } },
} satisfies Prisma.EvaluationRunSelect;

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the project if the caller owns it (and, for project-scoped API keys, if it is
   * the key's project). Unknown and foreign projects both yield 404 so existence is not leaked.
   */
  async requireProject(auth: AuthContext, projectId: string): Promise<Project> {
    if (auth.apiKeyProjectId && auth.apiKeyProjectId !== projectId) throw AppException.notFound('Project');
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, ownerId: auth.user.id, archivedAt: null },
    });
    if (!project) throw AppException.notFound('Project');
    return project;
  }

  /** Ids of projects the caller can read. */
  async accessibleProjectIds(auth: AuthContext): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: { ownerId: auth.user.id, ...(auth.apiKeyProjectId && { id: auth.apiKeyProjectId }) },
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }

  async create(auth: AuthContext, dto: CreateProjectDto) {
    if (auth.apiKeyProjectId) throw AppException.forbidden('Project-scoped API keys cannot create projects.');
    return this.prisma.project.create({
      data: { ownerId: auth.user.id, name: dto.name, description: dto.description || null },
    });
  }

  async list(auth: AuthContext, query: ListProjectsQueryDto) {
    const where: Prisma.ProjectWhereInput = {
      ownerId: auth.user.id,
      archivedAt: null,
      ...(auth.apiKeyProjectId && { id: auth.apiKeyProjectId }),
      ...(query.search && { name: { contains: query.search, mode: 'insensitive' } }),
    };
    const [projects, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
        include: {
          _count: { select: { runs: true } },
          runs: { orderBy: { createdAt: 'desc' }, take: 1, select: RUN_PREVIEW },
        },
      }),
      this.prisma.project.count({ where }),
    ]);
    const items = projects.map(({ _count, runs, ...project }) => ({
      ...project,
      runCount: _count.runs,
      latestRun: runs[0] ?? null,
    }));
    return paginated(items, total, query);
  }

  async get(auth: AuthContext, id: string) {
    const project = await this.requireProject(auth, id);
    const [recentRuns, statusCounts] = await Promise.all([
      this.prisma.evaluationRun.findMany({
        where: { projectId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: RUN_PREVIEW,
      }),
      this.prisma.evaluationRun.groupBy({ by: ['status'], where: { projectId: id }, _count: { _all: true } }),
    ]);
    const runsByStatus = Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all]));
    const lastCompleted = recentRuns.find((r) => r.status === 'COMPLETED') ?? null;
    return {
      ...project,
      recentRuns,
      evaluationSummary: {
        totalRuns: statusCounts.reduce((sum, s) => sum + s._count._all, 0),
        runsByStatus,
        lastCompletedRun: lastCompleted,
      },
    };
  }

  async update(auth: AuthContext, id: string, dto: UpdateProjectDto) {
    await this.requireProject(auth, id);
    return this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description || null }),
      },
    });
  }

  /** Archives the project. Its evaluation history is preserved for reproducibility. */
  async archive(auth: AuthContext, id: string) {
    await this.requireProject(auth, id);
    await this.prisma.project.update({ where: { id }, data: { archivedAt: new Date() } });
    await this.prisma.apiKey.updateMany({ where: { projectId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    return { id, archived: true };
  }
}
