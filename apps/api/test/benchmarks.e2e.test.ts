import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, officialSuiteId, ORIGIN, signUp, type TestApp } from './helpers';

let t: TestApp;
let suiteId: string;
beforeAll(async () => {
  t = await createTestApp();
  suiteId = await officialSuiteId(t);
});
afterAll(async () => {
  await t.close();
});

const tinyDataset = (version = '1.0.0', visibility = 'private') => ({
  formatVersion: 1,
  suite: { slug: 'tiny-suite', name: 'Tiny suite', version, visibility },
  semanticGroups: [
    {
      key: 'capital',
      title: 'Capital',
      category: 'civic_information',
      expectedFacts: [{ id: 'capital', type: 'entity', description: 'Abuja', accepted: ['Abuja'] }],
      cases: [
        { key: 'capital.en-NG', language: 'en-NG', title: 'Capital (en)', prompt: 'Capital of Nigeria?', difficulty: 'easy', provenance: { sourceType: 'human', reviewStatus: 'draft' } },
        { key: 'capital.yo', language: 'yo', title: 'Capital (yo)', prompt: 'Kí ni olú-ìlú Nàìjíríà?', difficulty: 'easy', provenance: { sourceType: 'human', reviewStatus: 'draft' } },
      ],
    },
  ],
});

describe('benchmarks', () => {
  it('seeds the official Nigerian Context suite with honest review statistics', async () => {
    const { agent } = await signUp(t);
    const res = await agent.get('/api/v1/benchmarks');
    const suite = res.body.data.find((s: { id: string }) => s.id === suiteId);
    expect(suite).toMatchObject({ slug: 'nigerian-context-v1', isOfficial: true, visibility: 'PUBLIC', canManage: false });
    expect(suite.stats).toMatchObject({ caseCount: 57, semanticGroupCount: 14, verifiedCount: 0 });
    expect(suite.stats.languages).toEqual({ 'en-NG': 15, yo: 14, ha: 14, ig: 14 });
  });

  it('finds suites by slug (used by the SDK to resolve "nigerian-context-v1")', async () => {
    const { agent } = await signUp(t);
    const res = await agent.get('/api/v1/benchmarks?search=nigerian-context-v1');
    expect(res.body.data.map((s: { slug: string }) => s.slug)).toContain('nigerian-context-v1');
  });

  it('filters cases and resolves group facts per case', async () => {
    const { agent } = await signUp(t);
    const res = await agent.get(`/api/v1/benchmarks/${suiteId}/cases?language=ha&category=financial_terminology`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    for (const c of res.body.data) {
      expect(c.language).toBe('ha');
      expect(c.facts.length).toBeGreaterThan(0);
      expect(c.provenance.translationSource).toBe('ai_generated');
      expect(c.reviewStatus).toBe('PENDING_REVIEW');
    }
  });

  it('validates imports and reports structural errors', async () => {
    const { agent } = await signUp(t);
    const dry = await agent.post('/api/v1/benchmarks/import').set('origin', ORIGIN).send({ dataset: tinyDataset(), dryRun: true });
    expect(dry.body.data).toMatchObject({ valid: true, saved: false, counts: { semanticGroups: 1, cases: 2 } });

    const broken = tinyDataset();
    broken.semanticGroups[0]!.cases[1]!.language = 'en-NG';
    const bad = await agent.post('/api/v1/benchmarks/import').set('origin', ORIGIN).send({ dataset: broken });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(bad.body.error.details.some((d: { message: string }) => d.message.includes('already has a en-NG variant'))).toBe(true);
  });

  it('imports private suites, forces non-admin imports to private and rejects duplicate versions', async () => {
    const { agent } = await signUp(t);
    const saved = await agent.post('/api/v1/benchmarks/import').set('origin', ORIGIN).send({ dataset: tinyDataset('1.0.0', 'public') });
    expect(saved.status).toBe(201);
    expect(saved.body.data.suite.visibility).toBe('PRIVATE');
    expect(saved.body.data.warnings.some((w: { path: string }) => w.path === 'suite.visibility')).toBe(true);

    const dup = await agent.post('/api/v1/benchmarks/import').set('origin', ORIGIN).send({ dataset: tinyDataset('1.0.0') });
    expect(dup.status).toBe(409);

    const other = await signUp(t);
    expect((await other.agent.get(`/api/v1/benchmarks/${saved.body.data.suite.id}`)).status).toBe(404);
  });

  it('exports a dataset that re-imports as a new version', async () => {
    const { agent } = await signUp(t);
    const exported = await agent.get(`/api/v1/benchmarks/${suiteId}/export`);
    expect(exported.status).toBe(200);
    expect(exported.headers['content-disposition']).toContain('nigerian-context-v1-v1.0.0.json');
    const dataset = JSON.parse(exported.text);
    dataset.suite.version = '1.0.1';
    const reimport = await agent.post('/api/v1/benchmarks/import').set('origin', ORIGIN).send({ dataset, dryRun: true });
    expect(reimport.body.data.counts.cases).toBe(57);
  });

  it('restricts official content review to administrators and requires attestation to verify', async () => {
    const dev = await signUp(t);
    const admin = await signUp(t, { email: 'benchmark-admin@atlasguard.test' });
    const caseRow = await t.prisma.benchmarkCase.findFirstOrThrow({ where: { suiteId, key: 'capital-of-nigeria.yo' } });
    const url = `/api/v1/benchmarks/${suiteId}/cases/${caseRow.id}/review`;

    expect((await dev.agent.patch(url).set('origin', ORIGIN).send({ status: 'VERIFIED', attestation: true })).status).toBe(403);
    expect((await admin.agent.patch(url).set('origin', ORIGIN).send({ status: 'VERIFIED' })).status).toBe(400);

    const ok = await admin.agent.patch(url).set('origin', ORIGIN).send({ status: 'VERIFIED', attestation: true, notes: 'Checked by a fluent reviewer' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ reviewStatus: 'VERIFIED', reviewNotes: 'Checked by a fluent reviewer' });
    expect(ok.body.data.provenance).toMatchObject({ reviewStatus: 'verified', reviewedBy: expect.any(String), reviewedAt: expect.any(String) });

    // reset for other tests
    await admin.agent.patch(url).set('origin', ORIGIN).send({ status: 'PENDING_REVIEW' });
  });
});
