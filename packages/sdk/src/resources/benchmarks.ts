import type { BenchmarkCase, BenchmarkSuite, Language, Page, PageParams } from '../types';
import { Resource } from './base';

export interface CaseFilters extends PageParams {
  language?: Language;
  category?: string;
  reviewStatus?: 'DRAFT' | 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
  semanticGroupId?: string;
  search?: string;
}

export interface ImportResult {
  valid: boolean;
  saved: boolean;
  warnings: Array<{ path: string; message: string }>;
  counts: { semanticGroups: number; cases: number };
  suite?: BenchmarkSuite;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BenchmarksResource extends Resource {
  list(params: PageParams & { search?: string; language?: Language; category?: string } = {}, signal?: AbortSignal): Promise<Page<BenchmarkSuite>> {
    return this.getPage<BenchmarkSuite>('/benchmarks', { ...params }, signal);
  }

  get(id: string, signal?: AbortSignal): Promise<BenchmarkSuite & { semanticGroups: unknown[] }> {
    return this.getJson(`/benchmarks/${encodeURIComponent(id)}`, undefined, signal);
  }

  cases(id: string, filters: CaseFilters = {}, signal?: AbortSignal): Promise<Page<BenchmarkCase>> {
    return this.getPage<BenchmarkCase>(`/benchmarks/${encodeURIComponent(id)}/cases`, { ...filters }, signal);
  }

  /** Iterates every case of a suite (all pages). */
  allCases(id: string, filters: Omit<CaseFilters, 'page'> = {}): AsyncGenerator<BenchmarkCase> {
    return this.iterate<BenchmarkCase>(`/benchmarks/${encodeURIComponent(id)}/cases`, { ...filters });
  }

  /** Validates (dryRun) or imports a dataset in AtlasGuard benchmark format v1. */
  import(dataset: unknown, options: { dryRun?: boolean; official?: boolean } = {}, signal?: AbortSignal): Promise<ImportResult> {
    return this.postJson<ImportResult>('/benchmarks/import', { dataset, ...options }, signal);
  }

  /** Downloads the suite as an importable dataset object. */
  async export(id: string, signal?: AbortSignal): Promise<unknown> {
    return JSON.parse(await this.getText(`/benchmarks/${encodeURIComponent(id)}/export`, undefined, signal));
  }

  /**
   * Resolves a suite id or slug ("nigerian-context-v1") to an id. For slugs, the most
   * recently created visible suite with that slug wins.
   */
  async resolveId(idOrSlug: string, signal?: AbortSignal): Promise<string> {
    if (UUID.test(idOrSlug)) return idOrSlug;
    const { items } = await this.list({ search: idOrSlug, pageSize: 100 }, signal);
    const match = items.find((s) => s.slug === idOrSlug);
    if (!match) throw new Error(`No benchmark suite with slug "${idOrSlug}" is visible to this API key`);
    return match.id;
  }
}
