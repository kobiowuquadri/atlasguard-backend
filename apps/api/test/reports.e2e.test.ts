import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProject, createTestApp, drainQueue, modelConfigId, officialSuiteId, ORIGIN, signUp, type TestApp } from './helpers';

let t: TestApp;
let agent: Awaited<ReturnType<typeof signUp>>['agent'];
let runA: string;
let runB: string;

beforeAll(async () => {
  t = await createTestApp();
  const suiteId = await officialSuiteId(t);
  const fixture = await modelConfigId(t, 'system-fixture');
  ({ agent } = await signUp(t));
  const project = await createProject(agent);
  const start = async (languages: string[]) =>
    (await agent.post('/api/v1/evaluations/runs').set('origin', ORIGIN).send({ projectId: project.id, suiteId, languages, modelConfigurationId: fixture }))
      .body.data.id as string;
  runA = await start(['en-NG', 'ha']);
  runB = await start(['en-NG', 'ha', 'yo']);
  await drainQueue(t);
});
afterAll(async () => {
  await t.close();
});

describe('reports', () => {
  it('builds a structured report from stored records with methodology and limitations', async () => {
    const res = await agent.get(`/api/v1/reports/${runA}`);
    expect(res.status).toBe(200);
    const r = res.body.data;
    expect(r.simulated).toBe(true);
    expect(r.simulationNotice).toMatch(/NOT output from N-ATLaS/);
    expect(r.summary.total).toBe(29);
    expect(r.languagePerformance.map((l: { language: string }) => l.language)).toEqual(['en-NG', 'ha']);
    expect(r.findings).toHaveLength(29);
    expect(r.methodology.passRate).toMatch(/PASSED \/ \(PASSED \+ FAILED\)/);
    expect(r.limitations.length).toBeGreaterThan(2);
    expect(r.attribution).toMatch(/Awarri Technologies/);
  });

  it('exports CSV (formula-safe), Markdown and JSON files', async () => {
    const csv = await agent.get(`/api/v1/reports/${runA}/export?format=csv`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/SIMULATED\.csv/);
    const lines = csv.text.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toContain('case_key');
    expect(lines.length).toBe(31); // header + 29 rows + trailing newline

    const md = await agent.get(`/api/v1/reports/${runA}/export?format=markdown`);
    expect(md.text).toMatch(/^# AtlasGuard evaluation report/);
    expect(md.text).toContain('**SIMULATED RUN.**');
    expect(md.text).toContain('## Cross-language consistency');

    const json = await agent.get(`/api/v1/reports/${runA}/export?format=json`);
    expect(JSON.parse(json.text).overview.run.id).toBe(runA);
  });

  it('compares two runs of the same suite', async () => {
    const res = await agent.get(`/api/v1/reports/compare?baseRunId=${runA}&targetRunId=${runB}`);
    expect(res.status).toBe(200);
    expect(res.body.data.casesCompared).toBe(29);
    expect(res.body.data.byLanguage.map((r: { key: string }) => r.key).sort()).toEqual(['en-NG', 'ha', 'yo']);
    expect(res.body.data.caseChanges).toEqual([]); // fixtures are deterministic
  });

  it('rejects comparisons across different suites', async () => {
    const dataset = {
      formatVersion: 1,
      suite: { slug: 'other-suite', name: 'Other suite', version: '1.0.0' },
      cases: [
        { key: 'x.en-NG', language: 'en-NG', title: 'Capital', prompt: 'Capital of Nigeria?', difficulty: 'easy', category: 'civic_information', provenance: { sourceType: 'human', reviewStatus: 'draft' } },
      ],
    };
    const suite = (await agent.post('/api/v1/benchmarks/import').set('origin', ORIGIN).send({ dataset })).body.data.suite;
    const project = await createProject(agent, 'cmp');
    const fixture = await modelConfigId(t, 'system-fixture');
    const runC = (
      await agent.post('/api/v1/evaluations/runs').set('origin', ORIGIN).send({ projectId: project.id, suiteId: suite.id, languages: ['en-NG'], modelConfigurationId: fixture })
    ).body.data.id;
    await drainQueue(t);
    const res = await agent.get(`/api/v1/reports/compare?baseRunId=${runA}&targetRunId=${runC}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INCOMPATIBLE_RUNS');
  });
});
