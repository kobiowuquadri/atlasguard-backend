/**
 * LIVE SDK integration test against a running AtlasGuard API. Skipped unless configured:
 *
 *   ATLASGUARD_TEST_BASE_URL=http://localhost:4000 ATLASGUARD_TEST_API_KEY=ag_… \
 *   ATLASGUARD_TEST_PROJECT_ID=… ATLASGUARD_TEST_SIMULATED=1 pnpm --filter @atlasguard/sdk test
 *
 * With ATLASGUARD_TEST_SIMULATED=1 the run uses the server's development fixtures (the
 * test then asserts the run is labelled simulated); otherwise it uses real N-ATLaS.
 */
import { describe, expect, it } from 'vitest';
import { AtlasGuard } from '../src/index';

const baseUrl = process.env.ATLASGUARD_TEST_BASE_URL;
const apiKey = process.env.ATLASGUARD_TEST_API_KEY;
const projectId = process.env.ATLASGUARD_TEST_PROJECT_ID;
const simulated = process.env.ATLASGUARD_TEST_SIMULATED === '1';

describe.skipIf(!baseUrl || !apiKey || !projectId)('AtlasGuard SDK (live API)', () => {
  it('runs a small evaluation end to end', { timeout: 300_000 }, async () => {
    const atlas = new AtlasGuard({ baseUrl: baseUrl!, apiKey: apiKey! });
    const configs = await atlas.system.modelConfigurations();
    const config = configs.find((c) => c.isSimulated === simulated && c.availability === 'available');
    expect(config, 'an available model configuration').toBeDefined();

    const run = await atlas.evaluations.run({
      projectId: projectId!,
      suiteId: 'nigerian-context-v1',
      languages: ['en-NG', 'ha'],
      categories: ['financial_terminology'],
      modelConfigurationId: config!.id as string,
    });
    const finished = await atlas.evaluations.waitForCompletion(run.id, { intervalMs: 1000 });
    expect(finished.status).toBe('COMPLETED');
    expect(finished.isSimulated).toBe(simulated);

    const results = await atlas.evaluations.results(run.id);
    expect(results.items.length).toBe(finished.totalCases);
    expect(results.items.every((r) => r.executedAt)).toBe(true);

    const consistency = await atlas.evaluations.consistency(run.id);
    expect(consistency.length).toBeGreaterThan(0);

    const csv = await atlas.reports.export(run.id, 'csv');
    expect(csv.split('\n')[0]).toContain('case_key');
  });
});
