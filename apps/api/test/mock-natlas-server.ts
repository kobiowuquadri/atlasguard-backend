/**
 * MOCK N-ATLaS inference server for automated tests ONLY. It imitates the HTTP contract of
 * services/natlas-inference (OpenAI-style chat completions + /health + /model-info) so the
 * real NatlasProvider and worker can be exercised without a GPU. It is not N-ATLaS.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type MockMode = 'ok' | 'down' | 'flaky' | 'mismatch' | 'loading';

export interface MockNatlas {
  url: string;
  apiKey: string;
  requests: Array<{ path: string; body: unknown }>;
  setMode: (mode: MockMode) => void;
  close: () => Promise<void>;
}

const ANSWERS: Array<[RegExp, string]> = [
  [/capital|olú-ìlú|babban birnin|isi obodo/i, 'Abuja is the capital city of Nigeria.'],
  [/independence|òmìnira|'yancin kai|nnwere onwe/i, 'Nigeria became independent on 1 October 1960.'],
  [/states|ìpínlẹ̀|jihohi|steeti/i, 'Nigeria has 36 states and the Federal Capital Territory.'],
];

export async function startMockNatlas(apiKey = 'mock-inference-key'): Promise<MockNatlas> {
  let mode: MockMode = 'ok';
  const requests: MockNatlas['requests'] = [];

  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const path = req.url ?? '/';
      requests.push({ path, body: raw ? JSON.parse(raw) : null });
      if (mode === 'down') return send(503, { detail: 'service unavailable' });
      if (path === '/health') return send(200, { status: mode === 'loading' ? 'loading' : 'ready', model_loaded: mode !== 'loading' });
      if (req.headers.authorization !== `Bearer ${apiKey}`) return send(401, { detail: 'invalid token' });
      if (path === '/v1/models') return send(200, { object: 'list', data: [{ id: 'NCAIR1/N-ATLaS' }] });
      if (path === '/model-info') {
        return send(200, { model_id: 'NCAIR1/N-ATLaS', revision: 'mock-revision-0001', dtype: 'float16', quantization: 'none', device: 'mock', runtime: 'mock-server' });
      }
      if (path === '/v1/chat/completions' && req.method === 'POST') {
        if (mode === 'flaky') return send(502, { detail: 'upstream generation failed' });
        const body = JSON.parse(raw) as { messages: Array<{ role: string; content: string }> };
        const prompt = body.messages.at(-1)?.content ?? '';
        const answer = ANSWERS.find(([re]) => re.test(prompt))?.[1] ?? 'I am not sure.';
        return send(200, {
          id: `chatcmpl-mock-${requests.length}`,
          object: 'chat.completion',
          model: mode === 'mismatch' ? 'some-other-model' : 'NCAIR1/N-ATLaS',
          choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 },
          atlasguard: { inference_ms: 321, revision: 'mock-revision-0001' },
        });
      }
      return send(404, { detail: 'not found' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    apiKey,
    requests,
    setMode: (m) => (mode = m),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
