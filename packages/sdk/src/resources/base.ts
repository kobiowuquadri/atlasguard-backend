import type { AtlasGuard, QueryValue } from '../client';
import type { Page, PageParams } from '../types';

export abstract class Resource {
  constructor(protected readonly client: AtlasGuard) {}

  protected async getJson<T>(path: string, query?: Record<string, QueryValue>, signal?: AbortSignal): Promise<T> {
    return (await this.client.request<T>('GET', path, { query, signal })).data;
  }

  protected async getPage<T>(path: string, query?: Record<string, QueryValue>, signal?: AbortSignal): Promise<Page<T>> {
    const res = await this.client.request<T[]>('GET', path, { query, signal });
    return { items: res.data, meta: res.meta ?? { page: 1, pageSize: res.data.length, total: res.data.length, totalPages: 1 } };
  }

  /** Iterates every item across pages. */
  protected async *iterate<T>(path: string, query: Record<string, QueryValue> & PageParams = {}): AsyncGenerator<T> {
    let page = query.page ?? 1;
    for (;;) {
      const res = await this.getPage<T>(path, { ...query, page, pageSize: query.pageSize ?? 100 });
      yield* res.items;
      if (page >= res.meta.totalPages) return;
      page++;
    }
  }

  protected async postJson<T>(path: string, body: unknown = {}, signal?: AbortSignal): Promise<T> {
    return (await this.client.request<T>('POST', path, { body, signal })).data;
  }

  protected async patchJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return (await this.client.request<T>('PATCH', path, { body, signal })).data;
  }

  protected async deleteJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    return (await this.client.request<T>('DELETE', path, { signal })).data;
  }

  protected async getText(path: string, query?: Record<string, QueryValue>, signal?: AbortSignal): Promise<string> {
    return (await this.client.request<string>('GET', path, { query, signal, raw: true })).data;
  }
}
