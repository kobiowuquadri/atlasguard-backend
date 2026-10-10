import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProject, createTestApp, drainQueue, modelConfigId, officialSuiteId, ORIGIN, signUp, type TestApp } from './helpers';
import { startMockNatlas, type MockNatlas } from './mock-natlas-server';

let t: TestApp;
let mock: MockNatlas;
let suiteId: string;
let fixtureConfig: string;
let natlasConfig: string;

beforeAll(async () => {
  mock = await startMockNatlas();
  t = await createTestApp({
    NATLAS_BASE_URL: mock.url,
    NATLAS_API_KEY: mock.apiKey,
    NATLAS_MAX_RETRIES: '0',
    NATLAS_TIMEOUT_MS: '5000',
  });
  suiteId = await officialSuiteId(t);
  fixtureConfig = await modelConfigId(t, 'system-fixture');
  natlasConfig = await modelConfigId(t, 'system-natlas');
});
afterAll(async () => {
  await t.close();
  await mock.close();
});

describe('evaluation runs with simulated fixtures', () => {
  it('evaluates every case once, labels the run simulated and detects cross-language conflicts', async () => {
    const { agent } = await signUp(t);
    const project = await createProject(agent);
    const created = await agent
      .post('/api/v1/evaluations/runs')
      .set('origin', ORIGIN)
      .send({ projectId: project.id, suiteId, languages: ['en-NG', 'yo', 'ha', 'ig'], modelConfigurationId: fixtureConfig });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: 'QUEUED', isSimulated: true, totalCases: 57, benchmarkVersion: '1.0.0' });
    const runId = created.body.data.id;

    await drainQueue(t);
    await drainQueue(t); // re-draining must not double-count anything

    const run = (await agent.get(`/api/v1/evaluations/runs/${runId}`)).body.data;
    expect(run.status).toBe('COMPLETED');
    expect(run.progress).toMatchObject({ total: 57, done: 57, pending: 0 });
    expect(run.completedCases).toBe(57);
    const v = run.progress.byVerdict;
    expect((v.PASSED ?? 0) + (v.FAILED ?? 0) + (v.NEEDS_REVIEW ?? 0)).toBe(57);
    expect(run.summary.overall.total).toBe(57);
    expect(await t.prisma.evaluationResult.count({ where: { evaluationRunId: runId } })).toBe(57);

    // Timestamps are consistent even though the test database is not in UTC.
    const started = new Date(run.startedAt).getTime();
    const completed = new Date(run.completedAt).getTime();
    expect(started).toBeLessThanOrEqual(completed);
    expect(Math.abs(Date.now() - started)).toBeLessThan(5 * 60_000);

    const consistency = (await agent.get(`/api/v1/evaluations/runs/${runId}/consistency`)).body.data;
    expect(consistency).toHaveLength(14);
    const transfer = consistency.find((g: { semanticGroupKey: string }) => g.semanticGroupKey === 'transfer-fee-total');
    expect(transfer.verdict).toBe('INCONSISTENT');
    expect(transfer.entries.map((e: { language: string }) => e.language)).toEqual(['en-NG', 'yo', 'ha', 'ig']);
    expect(transfer.findings.find((f: { type: string }) => f.type === 'numeric_conflict').values.ha).toEqual([5500]);

    // Results are returned in benchmark order with the evaluated snapshot.
    const results = (await agent.get(`/api/v1/evaluations/runs/${runId}/results?pageSize=4`)).body.data;
    expect(results.map((r: { caseKey: string }) => r.caseKey)).toEqual([
      'transfer-fee-total.en-NG',
      'transfer-fee-total.yo',
      'transfer-fee-total.ha',
      'transfer-fee-total.ig',
    ]);
    expect(results[2]).toMatchObject({ finalVerdict: 'FAILED', responseMetadata: { simulated: true } });
    expect(results[2].caseSnapshot.facts[0].value).toBe(5050);

    // Simulated runs can never be exported as N-ATLaS evidence.
    const evidence = await agent.get(`/api/v1/reports/${runId}/evidence`);
    expect(evidence.status).toBe(403);
    expect(evidence.body.error.code).toBe('EVIDENCE_EXPORT_DISABLED');
  });

  it('lets reviewers override automated verdicts but not technical outcomes', async () => {
    const { agent } = await signUp(t);
    const project = await createProject(agent);
    const runId = (
      await agent
        .post('/api/v1/evaluations/runs')
        .set('origin', ORIGIN)
        .send({ projectId: project.id, suiteId, languages: ['ig'], categories: ['cultural_context'], modelConfigurationId: fixtureConfig })
    ).body.data.id;
    await drainQueue(t);
    const results = (await agent.get(`/api/v1/evaluations/runs/${runId}/results`)).body.data;
    const failed = results.find((r: { finalVerdict: string }) => r.finalVerdict === 'FAILED');
    expect(failed).toBeDefined();

    const before = (await agent.get(`/api/v1/evaluations/runs/${runId}`)).body.data.summary.overall;
    const reviewed = await agent
      .post(`/api/v1/evaluations/runs/${runId}/results/${failed.id}/reviews`)
      .set('origin', ORIGIN)
      .send({ decision: 'PASSED', notes: 'Greeting is acceptable in context' });
    expect(reviewed.status).toBe(201);
    expect(reviewed.body.data).toMatchObject({ verdict: 'FAILED', finalVerdict: 'PASSED' });
    expect(reviewed.body.data.reviews[0]).toMatchObject({ decision: 'PASSED', previousVerdict: 'FAILED' });
    const after = (await agent.get(`/api/v1/evaluations/runs/${runId}`)).body.data.summary;
    expect(after.overall.passed).toBe(before.passed + 1);
    expect(after.humanReviewed).toBe(1);
  });

  it('cancels a queued run and skips its cases', async () => {
    const { agent } = await signUp(t);
    const project = await createProject(agent);
    const runId = (
      await agent.post('/api/v1/evaluations/runs').set('origin', ORIGIN).send({ projectId: project.id, suiteId, languages: ['yo'], modelConfigurationId: fixtureConfig })
    ).body.data.id;
    const cancelled = await agent.post(`/api/v1/evaluations/runs/${runId}/cancel`).set('origin', ORIGIN);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelled.body.data.progress.byVerdict).toEqual({ SKIPPED: 14 });
    expect((await agent.post(`/api/v1/evaluations/runs/${runId}/cancel`).set('origin', ORIGIN)).body.error.code).toBe('RUN_NOT_CANCELLABLE');
  });

  it('resumes a run interrupted mid-flight without duplicating results', async () => {
    const { agent } = await signUp(t);
    const project = await createProject(agent);
    const runId = (
      await agent
        .post('/api/v1/evaluations/runs')
        .set('origin', ORIGIN)
        .send({ projectId: project.id, suiteId, languages: ['ha'], categories: ['civic_information'], modelConfigurationId: fixtureConfig })
    ).body.data.id;
    // Simulate a crashed worker: run RUNNING with an old heartbeat and one case in flight.
    await t.prisma.evaluationRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', lockedBy: 'dead-worker', heartbeatAt: new Date(Date.now() - 10 * 60_000), attempts: 1 },
    });
    const first = await t.prisma.evaluationResult.findFirstOrThrow({ where: { evaluationRunId: runId } });
    await t.prisma.evaluationResult.update({ where: { id: first.id }, data: { executionStatus: 'RUNNING', attempts: 1 } });

    await drainQueue(t);
    const run = (await agent.get(`/api/v1/evaluations/runs/${runId}`)).body.data;
    expect(run.status).toBe('COMPLETED');
    expect(run.progress).toMatchObject({ total: 3, done: 3 });
    expect(await t.prisma.evaluationResult.count({ where: { evaluationRunId: runId } })).toBe(3);
  });

  it('hides runs from other users', async () => {
    const owner = await signUp(t);
    const project = await createProject(owner.agent);
    const runId = (
      await owner.agent.post('/api/v1/evaluations/runs').set('origin', ORIGIN).send({ projectId: project.id, suiteId, languages: ['yo'], modelConfigurationId: fixtureConfig })
    ).body.data.id;
    const other = await signUp(t);
    expect((await other.agent.get(`/api/v1/evaluations/runs/${runId}`)).status).toBe(404);
    expect((await other.agent.get(`/api/v1/evaluations/runs/${runId}/results`)).status).toBe(404);
    expect((await other.agent.get(`/api/v1/reports/${runId}`)).status).toBe(404);
    expect(
      (await other.agent.post('/api/v1/evaluations/runs').set('origin', ORIGIN).send({ projectId: project.id, suiteId, languages: ['yo'] })).status,
    ).toBe(404);
  });
});

describe('evaluation runs through the real NatlasProvider (MOCK N-ATLaS HTTP server)', () => {
  it('records actual responses, provider metadata and exports integrity-checked evidence', async () => {
    mock.setMode('ok');
    const { agent } = await signUp(t);
    const project = await createProject(agent);
    const created = await agent
      .post('/api/v1/evaluations/runs')
      .set('origin', ORIGIN)
      .send({ projectId: project.id, suiteId, languages: ['en-NG', 'yo'], categories: ['civic_information'] });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ isSimulated: false, providerType: 'NATLAS', modelIdentifier: 'NCAIR1/N-ATLaS', modelConfigurationId: natlasConfig });
    const runId = created.body.data.id;
    await drainQueue(t);

    const run = (await agent.get(`/api/v1/evaluations/runs/${runId}`)).body.data;
    expect(run.status).toBe('COMPLETED');
    expect(run.modelRevision).toBe('mock-revision-0001');
    expect(run.providerMetadata.modelInfo).toMatchObject({ servedModel: 'NCAIR1/N-ATLaS', reportedBy: 'provider' });

    const sent = mock.requests.filter((r) => r.path === '/v1/chat/completions');
    expect(sent.length).toBe(6);
    expect(sent[0]!.body).toMatchObject({ model: 'NCAIR1/N-ATLaS', temperature: 0.1, repetition_penalty: 1.12, max_tokens: 512 });
    expect((sent[0]!.body as { messages: Array<{ role: string }> }).messages[0]!.role).toBe('system');

    const results = (await agent.get(`/api/v1/evaluations/runs/${runId}/results`)).body.data;
    const capital = results.find((r: { caseKey: string }) => r.caseKey === 'capital-of-nigeria.en-NG');
    expect(capital).toMatchObject({ response: 'Abuja is the capital city of Nigeria.', providerInferenceMs: 321, finalVerdict: 'PASSED' });
    expect(capital.responseMetadata).toMatchObject({ servedModel: 'NCAIR1/N-ATLaS', simulated: false });

    const evidence = await agent.get(`/api/v1/reports/${runId}/evidence`);
    expect(evidence.status).toBe(200);
    expect(evidence.body.data).toMatchObject({ kind: 'atlasguard.natlas-integration-evidence', run: { modelIdentifier: 'NCAIR1/N-ATLaS' } });
    expect(evidence.body.data.integrity.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(evidence.body.data)).not.toContain(mock.apiKey);
    expect(JSON.stringify(evidence.body.data)).not.toContain(mock.url);
  });

  it('never accepts output from a different model', async () => {
    mock.setMode('mismatch');
    const { agent } = await signUp(t);
    const project = await createProject(agent);
    const runId = (
      await agent.post('/api/v1/evaluations/runs').set('origin', ORIGIN).send({ projectId: project.id, suiteId, languages: ['yo'], categories: ['civic_information'] })
    ).body.data.id;
    await drainQueue(t);
    const run = (await agent.get(`/api/v1/evaluations/runs/${runId}`)).body.data;
    expect(run.status).toBe('FAILED');
    expect(run.errorDetails.code).toBe('UNSUPPORTED_MODEL_CONFIGURATION');
    const results = (await agent.get(`/api/v1/evaluations/runs/${runId}/results`)).body.data;
    expect(results.every((r: { response: string | null }) => r.response === null)).toBe(true);
    expect(results.some((r: { errorDetails: { code: string } | null }) => r.errorDetails?.code === 'PROVIDER_MODEL_MISMATCH')).toBe(true);
    mock.setMode('ok');
  });

  it('refuses to start when the endpoint is down and never substitutes fixtures', async () => {
    mock.setMode('down');
    const { agent } = await signUp(t);
    const project = await createProject(agent);
    const res = await agent.post('/api/v1/evaluations/runs').set('origin', ORIGIN).send({ projectId: project.id, suiteId, languages: ['yo'] });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('MODEL_PROVIDER_UNAVAILABLE');
    expect(await t.prisma.evaluationRun.count({ where: { projectId: project.id } })).toBe(0);
    mock.setMode('ok');
  });

  it('records provider failures as ERROR (not FAILED) and stops after repeated outages', async () => {
    mock.setMode('ok');
    const { agent } = await signUp(t);
    const project = await createProject(agent);
    const runId = (
      await agent.post('/api/v1/evaluations/runs').set('origin', ORIGIN).send({ projectId: project.id, suiteId, languages: ['ha', 'ig'] })
    ).body.data.id;
    mock.setMode('flaky'); // health stays green but every generation fails
    await drainQueue(t);
    const run = (await agent.get(`/api/v1/evaluations/runs/${runId}`)).body.data;
    expect(run.status).toBe('FAILED');
    expect(run.errorDetails.code).toBe('MODEL_PROVIDER_UNAVAILABLE');
    expect(run.progress.byVerdict.FAILED ?? 0).toBe(0);
    expect(run.progress.byVerdict.ERROR).toBeGreaterThanOrEqual(3);
    expect((run.progress.byVerdict.ERROR ?? 0) + (run.progress.byVerdict.SKIPPED ?? 0)).toBe(28);
    expect(run.summary.overall.verifiedPassRate).toBeNull(); // nothing decided, so no pass rate
    const errored = (await agent.get(`/api/v1/evaluations/runs/${runId}/results?verdict=ERROR`)).body.data[0];
    expect(errored.errorDetails).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: true });

    mock.setMode('down'); // a dead endpoint at claim time fails the run before any case starts
    const run2 = (
      await agent.post('/api/v1/evaluations/runs').set('origin', ORIGIN).send({ projectId: project.id, suiteId, languages: ['ha'] })
    );
    expect(run2.status).toBe(503);
    mock.setMode('ok');
  });
});

describe('without an N-ATLaS endpoint', () => {
  it('reports NOT_CONFIGURED instead of silently using another model', async () => {
    const bare = await createTestApp({ NATLAS_BASE_URL: '' });
    try {
      const { agent } = await signUp(bare);
      const project = await createProject(agent);
      const res = await agent.post('/api/v1/evaluations/runs').set('origin', ORIGIN).send({ projectId: project.id, suiteId, languages: ['yo'] });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('MODEL_PROVIDER_NOT_CONFIGURED');
    } finally {
      await bare.close();
    }
  });
});
