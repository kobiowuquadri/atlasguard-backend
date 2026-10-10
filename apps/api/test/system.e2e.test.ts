import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ORIGIN, signUp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('system endpoints', () => {
  it('serves liveness and readiness publicly', async () => {
    expect((await t.http.get('/api/v1/health')).body).toMatchObject({ success: true, data: { status: 'ok', evaluatorVersion: '1.0.0' } });
    expect((await t.http.get('/api/v1/ready')).body.data).toEqual({ status: 'ready', database: 'ok' });
  });

  it('reports model status without leaking endpoint details', async () => {
    const res = await t.http.get('/api/v1/model/status');
    expect(res.body.data.natlas).toMatchObject({ configured: false, health: { status: 'not_configured' } });
    expect(res.body.data.fixtures.enabled).toBe(true);
    expect(res.body.data.attribution).toMatch(/Awarri/);
  });

  it('echoes valid request ids and generates them otherwise', async () => {
    const res = await t.http.get('/api/v1/health').set('x-request-id', 'req-test-12345');
    expect(res.headers['x-request-id']).toBe('req-test-12345');
    const generated = await t.http.get('/api/v1/health').set('x-request-id', '<script>');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('renders unknown routes and errors with the standard envelope', async () => {
    const res = await t.http.get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND', requestId: expect.any(String) } });
    const bad = await t.http.get('/api/v1/projects/not-a-uuid').set('authorization', 'Bearer ag_none');
    expect(bad.status).toBe(401);
  });

  it('sets security headers and hides the framework', async () => {
    const res = await t.http.get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS only for configured origins', async () => {
    const allowed = await t.http.options('/api/v1/projects').set('origin', ORIGIN).set('access-control-request-method', 'POST');
    expect(allowed.headers['access-control-allow-origin']).toBe(ORIGIN);
    const denied = await t.http.options('/api/v1/projects').set('origin', 'https://evil.example').set('access-control-request-method', 'POST');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('publishes the OpenAPI document', async () => {
    const res = await t.http.get('/api/docs-json');
    expect(res.status).toBe(200);
    expect(res.body.info.title).toBe('AtlasGuard API');
    expect(Object.keys(res.body.paths)).toEqual(expect.arrayContaining(['/api/v1/evaluations/runs', '/api/v1/benchmarks/import', '/api/v1/reports/{runId}/export']));
  });

  it('stores beta feedback only with consent', async () => {
    const { agent } = await signUp(t);
    const base = { testerIdentifier: 'Tester A', testedFeatures: ['Running an evaluation'], overallAssessment: 'Useful tool overall.' };
    expect((await agent.post('/api/v1/feedback').set('origin', ORIGIN).send({ ...base, consentRecorded: false })).status).toBe(400);
    const ok = await agent.post('/api/v1/feedback').set('origin', ORIGIN).send({ ...base, consentRecorded: true, easeOfUseRating: 4 });
    expect(ok.status).toBe(201);
    expect((await agent.get('/api/v1/feedback')).status).toBe(403);
  });
});
