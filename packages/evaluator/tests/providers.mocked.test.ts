/**
 * MOCKED provider tests. Every response below is produced by a stub `fetch`; none of these
 * tests contact N-ATLaS. The real end-to-end check is apps/api `pnpm smoke:natlas`.
 */
import { describe, expect, it, vi } from 'vitest';
import { FixtureProvider } from '../src/providers/fixture-provider';
import { NatlasProvider, normalizeBaseUrl } from '../src/providers/natlas-provider';
import { ProviderError } from '../src/providers/errors';
import type { GenerationRequest } from '../src/providers/types';

const request: GenerationRequest = {
  requestId: 'req-1',
  messages: [{ role: 'user', content: 'Kí ni olú-ìlú Nàìjíríà?' }],
  parameters: { temperature: 0.1, maxTokens: 64, repetitionPenalty: 1.12 },
};

function completion(content: string, model = 'NCAIR1/N-ATLaS', extra: Record<string, unknown> = {}) {
  return {
    id: 'chatcmpl-123',
    object: 'chat.completion',
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    ...extra,
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function provider(fetchImpl: typeof fetch, options: Partial<ConstructorParameters<typeof NatlasProvider>[0]> = {}) {
  return new NatlasProvider({
    baseUrl: 'https://natlas.example.com/v1/',
    apiKey: 'secret-key',
    maxRetries: 2,
    sleep: async () => {},
    fetch: fetchImpl,
    ...options,
  });
}

async function expectProviderError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProviderError);
  expect((error as ProviderError).code).toBe(code);
  return error as ProviderError;
}

describe('NatlasProvider (mocked HTTP)', () => {
  it('sends an OpenAI-style request and records the response', async () => {
    const fetchMock = vi.fn(async () =>
      json(completion('Àbújá ni olú-ìlú Nàìjíríà.', 'NCAIR1/N-ATLaS', { atlasguard: { inference_ms: 812, revision: 'e2944769' } })),
    );
    const res = await provider(fetchMock as unknown as typeof fetch).generate(request);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://natlas.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-key');
    expect((init.headers as Record<string, string>)['x-request-id']).toBe('req-1');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'NCAIR1/N-ATLaS',
      temperature: 0.1,
      max_tokens: 64,
      repetition_penalty: 1.12,
      stream: false,
    });
    expect(res).toMatchObject({
      text: 'Àbújá ni olú-ìlú Nàìjíríà.',
      servedModel: 'NCAIR1/N-ATLaS',
      providerRequestId: 'chatcmpl-123',
      providerInferenceMs: 812,
      attempts: 1,
      simulated: false,
      finishReason: 'stop',
    });
    expect(res.usage).toEqual({ promptTokens: 20, completionTokens: 8, totalTokens: 28 });
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns empty content unchanged so the validity check can fail it', async () => {
    const res = await provider((async () => json(completion(''))) as unknown as typeof fetch).generate(request);
    expect(res.text).toBe('');
  });

  it('rejects malformed responses without retrying', async () => {
    const fetchMock = vi.fn(async () => json({ model: 'NCAIR1/N-ATLaS', choices: [] }));
    await expectProviderError(provider(fetchMock as unknown as typeof fetch).generate(request), 'PROVIDER_INVALID_RESPONSE');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects responses that do not identify the model', async () => {
    const body = completion('x') as Record<string, unknown>;
    delete body.model;
    await expectProviderError(provider((async () => json(body)) as unknown as typeof fetch).generate(request), 'PROVIDER_INVALID_RESPONSE');
  });

  it('never accepts output from a different model', async () => {
    const err = await expectProviderError(
      provider((async () => json(completion('hi', 'meta-llama/Llama-3.1-8B-Instruct'))) as unknown as typeof fetch).generate(request),
      'PROVIDER_MODEL_MISMATCH',
    );
    expect(err.retryable).toBe(false);
  });

  it('accepts explicitly configured served-model aliases', async () => {
    const res = await provider((async () => json(completion('ok', 'n-atlas'))) as unknown as typeof fetch, {
      acceptedModelNames: ['n-atlas'],
    }).generate(request);
    expect(res.servedModel).toBe('n-atlas');
  });

  it('does not retry authentication failures', async () => {
    const fetchMock = vi.fn(async () => json({ error: 'bad token secret-key' }, 401));
    const err = await expectProviderError(provider(fetchMock as unknown as typeof fetch).generate(request), 'PROVIDER_AUTH_FAILED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err.message).not.toContain('secret-key');
  });

  it('does not retry bad requests', async () => {
    const fetchMock = vi.fn(async () => json({ detail: 'max_tokens too large' }, 422));
    await expectProviderError(provider(fetchMock as unknown as typeof fetch).generate(request), 'PROVIDER_BAD_REQUEST');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries transient 5xx failures and then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: 'loading' }, 503))
      .mockResolvedValueOnce(json(completion('Abuja')));
    const res = await provider(fetchMock as unknown as typeof fetch).generate(request);
    expect(res.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honours Retry-After on 429 responses', async () => {
    const sleeps: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: 'slow down' }, 429, { 'retry-after': '3' }))
      .mockResolvedValueOnce(json(completion('Abuja')));
    await provider(fetchMock as unknown as typeof fetch, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }).generate(request);
    expect(sleeps[0]).toBeGreaterThanOrEqual(3000);
  });

  it('gives up after the retry budget with the attempt count recorded', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    });
    const err = await expectProviderError(provider(fetchMock as unknown as typeof fetch).generate(request), 'PROVIDER_UNAVAILABLE');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(err.attempts).toBe(3);
    expect(err.message).toContain('ECONNREFUSED');
  });

  it('classifies slow endpoints as timeouts', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const err = await expectProviderError(
      provider(fetchMock as unknown as typeof fetch, { timeoutMs: 20, maxRetries: 1 }).generate(request),
      'PROVIDER_TIMEOUT',
    );
    expect(err.attempts).toBe(2);
  });

  it('stops immediately when the caller cancels', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          setTimeout(() => controller.abort(), 5);
        }),
    );
    await expectProviderError(
      provider(fetchMock as unknown as typeof fetch).generate({ ...request, signal: controller.signal }),
      'PROVIDER_CANCELLED',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bounds concurrent requests', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchMock = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
      return json(completion('ok'));
    });
    const p = provider(fetchMock as unknown as typeof fetch, { maxConcurrency: 2 });
    await Promise.all(Array.from({ length: 6 }, (_, i) => p.generate({ ...request, requestId: `r${i}` })));
    expect(peak).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('reports not_configured health and refuses to generate without an endpoint', async () => {
    const p = new NatlasProvider({ baseUrl: null });
    expect(p.isConfigured()).toBe(false);
    expect((await p.healthCheck()).status).toBe('not_configured');
    await expectProviderError(p.generate(request), 'PROVIDER_NOT_CONFIGURED');
  });

  it('treats a loading model as unavailable', async () => {
    const health = await provider((async () => json({ status: 'starting', model_loaded: false })) as unknown as typeof fetch).healthCheck();
    expect(health.status).toBe('unavailable');
    expect(health.message).toContain('loading');
  });

  it('collects model provenance from /v1/models and /model-info', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/v1/models')
        ? json({ object: 'list', data: [{ id: 'NCAIR1/N-ATLaS' }] })
        : json({ model_id: 'NCAIR1/N-ATLaS', revision: 'e294476928aca9030e924ca27bb8e085e8581273', dtype: 'float16', quantization: 'none', device: 'cuda', runtime: 'transformers', context_length: 8192 }),
    );
    const info = await provider(fetchMock as unknown as typeof fetch).getModelInfo();
    expect(info).toMatchObject({
      servedModel: 'NCAIR1/N-ATLaS',
      revision: 'e294476928aca9030e924ca27bb8e085e8581273',
      dtype: 'float16',
      reportedBy: 'provider',
      simulated: false,
    });
  });

  it('normalises base URLs and rejects unsafe ones', () => {
    expect(normalizeBaseUrl('https://x.trycloudflare.com/')).toBe('https://x.trycloudflare.com');
    expect(normalizeBaseUrl('https://x.modal.run/v1')).toBe('https://x.modal.run');
    expect(() => normalizeBaseUrl('ftp://x.example.com')).toThrow();
    expect(() => normalizeBaseUrl('https://user:pass@x.example.com')).toThrow(/credentials/);
  });
});

describe('FixtureProvider (simulated)', () => {
  it('returns deterministic fixtures and labels them as simulated', async () => {
    const p = new FixtureProvider({ fixtures: { 'capital.en-NG': 'Abuja is the capital.' } });
    const res = await p.generate({ ...request, metadata: { caseKey: 'capital.en-NG' } });
    expect(res).toMatchObject({ text: 'Abuja is the capital.', simulated: true, servedModel: 'atlasguard-fixture-v1' });
    const again = await p.generate({ ...request, metadata: { caseKey: 'capital.en-NG' } });
    expect(again.providerRequestId).toBe(res.providerRequestId);
    expect((await p.getModelInfo()).simulated).toBe(true);
  });

  it('marks missing fixtures explicitly', async () => {
    const res = await new FixtureProvider({ fixtures: {} }).generate({ ...request, metadata: { caseKey: 'unknown.case' } });
    expect(res.text).toContain('[SIMULATED FIXTURE]');
  });
});
