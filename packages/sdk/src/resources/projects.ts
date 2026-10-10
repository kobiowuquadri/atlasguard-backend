import type { Page, PageParams, Project } from '../types';
import { Resource } from './base';

export class ProjectsResource extends Resource {
  list(params: PageParams & { search?: string } = {}, signal?: AbortSignal): Promise<Page<Project>> {
    return this.getPage<Project>('/projects', { ...params }, signal);
  }

  get(id: string, signal?: AbortSignal): Promise<Project & { recentRuns: unknown[]; evaluationSummary: unknown }> {
    return this.getJson(`/projects/${encodeURIComponent(id)}`, undefined, signal);
  }

  create(input: { name: string; description?: string }, signal?: AbortSignal): Promise<Project> {
    return this.postJson<Project>('/projects', input, signal);
  }

  update(id: string, input: { name?: string; description?: string }, signal?: AbortSignal): Promise<Project> {
    return this.patchJson<Project>(`/projects/${encodeURIComponent(id)}`, input, signal);
  }

  /** Archives the project; its evaluation history is preserved. */
  archive(id: string, signal?: AbortSignal): Promise<{ id: string; archived: boolean }> {
    return this.deleteJson(`/projects/${encodeURIComponent(id)}`, signal);
  }
}
