/**
 * MOCKED SDK tests: every response comes from a stub fetch. The live test in
 * live.test.ts talks to a running AtlasGuard API instead.
 */
import { describe, expect, it, vi } from 'vitest';
import { AtlasGuard, AtlasGuardApiError, AtlasGuardNetworkError, AtlasGuardTimeoutError, normalizeBaseUrl } from '../src/index';

const ok = (data: unknown, meta?: unknown) =>
  new Response(JSON.stringify({ success: true, data, ...(meta ? { meta } : {}) }), { status: 200, headers: { 'content-type': 'application/json' } });
const fail = (status: number, code: string, message = 'nope') =>
  new Response(JSON.stringify({ success: false, error: { code, message, requestId: 'req-9' } }), { status, headers: { 'content-type': 'application/json' } });

const SUITE_ID = '7f1a1a1a-1111-4111-8111-111111111111';

function client(fetchMock: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}) {
  return new AtlasGuard({ baseUrl: 'https://atlas.example.com', apiKey: 'ag_test_key', fetch: fetchMock as unknown as typeof fetch, ...extra });
}

describe('AtlasGuard SDK (mocked HTTP)', () => {
  it('normalises the base URL', () => {
    expect(normalizeBaseUrl('https://x.dev/')).toBe('https://x.dev/api/v1');
    expect(normalizeBaseUrl('https://x.dev/api/v1/')).toBe('https://x.dev/api/v1');
    expect(() => normalizeBaseUrl('x.dev')).toThrow();
  });

  it('sends the API key and unwraps the envelope', async () => {
    const fetchMock = vi.fn(async () => ok([{ id: 's1', slug: 'suite' }], { page: 1, pageSize: 20, total: 1, totalPages: 1 }));
    const page = await client(fetchMock).benchmarks.list({ language: 'yo' });
    expect(page.items[0]).toMatchObject({ id: 's1' });
    expect(page.meta.total).toBe(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://atlas.example.com/api/v1/benchmarks?language=yo');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ag_test_key');
  });

  it('maps API errors to AtlasGuardApiError with code and request id', async () => {
    const err = await client(vi.fn(async () => fail(503, 'MODEL_PROVIDER_UNAVAILABLE', 'endpoint down')), { maxRetries: 0 })
      .evaluations.get('r1')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AtlasGuardApiError);
    expect(err).toMatchObject({ status: 503, code: 'MODEL_PROVIDER_UNAVAILABLE', requestId: 'req-9' });
  });

  it('retries idempotent requests on 5xx but never retries POST', async () => {
    const getMock = vi.fn().mockResolvedValueOnce(fail(502, 'HTTP_ERROR')).mockResolvedValueOnce(ok({ id: 'r1', status: 'RUNNING' }));
    await expect(client(getMock).evaluations.get('r1')).resolves.toMatchObject({ id: 'r1' });
    expect(getMock).toHaveBeenCalledTimes(2);

    const postMock = vi.fn(async () => fail(503, 'MODEL_PROVIDER_UNAVAILABLE'));
    await expect(client(postMock).evaluations.cancel('r1')).rejects.toBeInstanceOf(AtlasGuardApiError);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry client errors', async () => {
    const fetchMock = vi.fn(async () => fail(404, 'NOT_FOUND'));
    await expect(client(fetchMock).projects.get('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('times out slow requests', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    await expect(client(fetchMock, { timeoutMs: 20, maxRetries: 0 }).system.health()).rejects.toBeInstanceOf(AtlasGuardTimeoutError);
  });

  it('reports network failures distinctly', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(client(fetchMock, { maxRetries: 0 }).system.health()).rejects.toBeInstanceOf(AtlasGuardNetworkError);
  });

  it('resolves suite slugs before queueing a run', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok([{ id: SUITE_ID, slug: 'nigerian-context-v1' }], { page: 1, pageSize: 100, total: 1, totalPages: 1 }))
      .mockResolvedValueOnce(ok({ id: 'run-1', status: 'QUEUED' }));
    const run = await client(fetchMock).evaluations.run({ projectId: 'p1', suiteId: 'nigerian-context-v1', languages: ['en-NG', 'yo'] });
    expect(run.id).toBe('run-1');
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ suiteId: SUITE_ID, languages: ['en-NG', 'yo'] });
  });

  it('polls until a run reaches a terminal state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ id: 'r1', status: 'QUEUED' }))
      .mockResolvedValueOnce(ok({ id: 'r1', status: 'RUNNING' }))
      .mockResolvedValueOnce(ok({ id: 'r1', status: 'COMPLETED' }));
    const seen: string[] = [];
    const run = await client(fetchMock).evaluations.waitForCompletion('r1', { intervalMs: 1, onProgress: (r) => seen.push(r.status) });
    expect(run.status).toBe('COMPLETED');
    expect(seen).toEqual(['QUEUED', 'RUNNING', 'COMPLETED']);
  });

  it('iterates every page of results', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok([{ id: 'a' }, { id: 'b' }], { page: 1, pageSize: 2, total: 3, totalPages: 2 }))
      .mockResolvedValueOnce(ok([{ id: 'c' }], { page: 2, pageSize: 2, total: 3, totalPages: 2 }));
    const ids: string[] = [];
    for await (const r of client(fetchMock).evaluations.allResults('r1', { pageSize: 2 })) ids.push(r.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('returns exports as raw text', async () => {
    const fetchMock = vi.fn(async () => new Response('run_id,case_key\r\nr1,x\r\n', { status: 200, headers: { 'content-type': 'text/csv' } }));
    const csv = await client(fetchMock).reports.export('r1', 'csv');
    expect(csv).toContain('case_key');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('/reports/r1/export?format=csv');
  });

  it('never serialises the API key', () => {
    expect(JSON.stringify(client(vi.fn()))).not.toContain('ag_test_key');
  });
});
