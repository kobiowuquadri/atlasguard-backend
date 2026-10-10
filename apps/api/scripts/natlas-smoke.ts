/**
 * REAL N-ATLaS integration smoke test — requires access to a running N-ATLaS endpoint.
 * (Unit tests use mocked HTTP; this script talks to the actual model.)
 *
 *   NATLAS_BASE_URL=https://… NATLAS_API_KEY=… pnpm smoke:natlas
 *
 * Checks health, model provenance, and generates answers in Nigerian English and Yoruba
 * through the same NatlasProvider the evaluation worker uses. Exits non-zero on failure.
 */
import { randomUUID } from 'node:crypto';
import { NatlasProvider, ProviderError, evaluateCase } from '@atlasguard/evaluator';

try {
  process.loadEnvFile('.env');
} catch {
  // rely on the real environment
}

const SYSTEM_PROMPT =
  'you are a large language model trained by Awarri AI technologies. You are a friendly assistant and you are here to help.';

const PROMPTS = [
  { key: 'capital.en-NG', language: 'en-NG' as const, text: 'What is the capital city of Nigeria? Answer in one sentence.' },
  { key: 'capital.yo', language: 'yo' as const, text: 'Kí ni olú-ìlú orílẹ̀-èdè Nàìjíríà? Dáhùn ní gbólóhùn kan ní èdè Yorùbá.' },
];

async function main(): Promise<number> {
  const baseUrl = process.env.NATLAS_BASE_URL;
  if (!baseUrl) {
    console.error('NATLAS_BASE_URL is not set. This smoke test needs a real N-ATLaS endpoint.');
    return 2;
  }
  const provider = new NatlasProvider({
    baseUrl,
    apiKey: process.env.NATLAS_API_KEY || null,
    modelId: process.env.NATLAS_MODEL_ID || undefined,
    acceptedModelNames: (process.env.NATLAS_ACCEPTED_MODEL_NAMES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    timeoutMs: Number(process.env.NATLAS_TIMEOUT_MS ?? 180_000),
  });

  const health = await provider.healthCheck();
  console.log(`health: ${health.status} (${health.latencyMs ?? '?'} ms) — ${health.message}`);
  if (health.status !== 'available') return 1;

  const info = await provider.getModelInfo();
  console.log('model:', JSON.stringify(info, null, 2));

  let failures = 0;
  for (const prompt of PROMPTS) {
    try {
      const res = await provider.generate({
        requestId: randomUUID(),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt.text },
        ],
        parameters: { temperature: 0.1, maxTokens: 128, repetitionPenalty: 1.12 },
      });
      const evaluation = evaluateCase(
        {
          key: prompt.key,
          language: prompt.language,
          facts: [{ id: 'capital', type: 'entity', description: 'The capital is Abuja', required: true, accepted: ['Abuja'], conflicting: ['Lagos'] }],
          rules: [],
        },
        { text: res.text, latencyMs: res.latencyMs, servedModel: res.servedModel, expectedModel: info.modelIdentifier, acceptedModelNames: provider.acceptedModelNames, finishReason: res.finishReason },
      );
      console.log(`\n[${prompt.key}] served by ${res.servedModel} in ${res.latencyMs} ms (provider generation ${res.providerInferenceMs ?? '?'} ms)`);
      console.log(`prompt:   ${prompt.text}`);
      console.log(`response: ${res.text}`);
      console.log(`verdict:  ${evaluation.summary}`);
      if (res.simulated) throw new Error('provider reported a simulated response');
    } catch (error) {
      failures++;
      console.error(`\n[${prompt.key}] FAILED:`, error instanceof ProviderError ? `${error.code}: ${error.message}` : error);
    }
  }
  console.log(failures === 0 ? '\nN-ATLaS smoke test passed.' : `\nN-ATLaS smoke test failed (${failures}).`);
  return failures === 0 ? 0 : 1;
}

// Set exitCode instead of calling process.exit(): exiting while fetch keep-alive sockets are
// still closing trips a libuv assertion on Windows. Node exits once the sockets idle out.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
