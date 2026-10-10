import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProject, createTestApp, ORIGIN, signUp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('authentication', () => {
  it('registers with an HTTP-only session cookie and never returns the token in the body', async () => {
    const res = await t.http
      .post('/api/v1/auth/register')
      .set('origin', ORIGIN)
      .send({ name: 'Ada', email: 'Ada@Example.com', password: 'correct horse battery' });
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email: 'ada@example.com', role: 'DEVELOPER' });
    expect(JSON.stringify(res.body)).not.toMatch(/token|passwordHash/i);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/ag_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('rejects duplicate emails', async () => {
    const res = await t.http.post('/api/v1/auth/register').send({ name: 'Ada 2', email: 'ada@example.com', password: 'another password' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('validates input with field-level details', async () => {
    const res = await t.http.post('/api/v1/auth/register').send({ name: 'B', email: 'not-an-email', password: 'short', extra: 1 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(3);
  });

  it('uses one generic message for unknown emails and wrong passwords', async () => {
    const wrong = await t.http.post('/api/v1/auth/login').send({ email: 'ada@example.com', password: 'wrong password' });
    const unknown = await t.http.post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'whatever' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: unknown.body.error.message });
  });

  it('logs in, reads /auth/me and logs out (session revoked server-side)', async () => {
    const agent = request.agent(t.app.getHttpServer());
    expect((await agent.post('/api/v1/auth/login').send({ email: 'ada@example.com', password: 'correct horse battery' })).status).toBe(200);
    const me = await agent.get('/api/v1/auth/me');
    expect(me.body.data).toMatchObject({ authMethod: 'session', user: { email: 'ada@example.com' } });
    expect((await agent.post('/api/v1/auth/logout').set('origin', ORIGIN)).status).toBe(200);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('blocks cookie-authenticated requests from foreign origins (CSRF)', async () => {
    const { agent } = await signUp(t);
    const res = await agent.post('/api/v1/projects').set('origin', 'https://evil.example').send({ name: 'Nope' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('promotes configured admin emails', async () => {
    const { user } = await signUp(t, { email: 'admin@atlasguard.test' });
    expect(user.role).toBe('ADMIN');
  });
});

describe('project isolation', () => {
  it('lets owners manage projects and hides them from everyone else', async () => {
    const owner = await signUp(t);
    const other = await signUp(t);
    const project = await createProject(owner.agent, 'Owner project');

    expect((await owner.agent.get(`/api/v1/projects/${project.id}`)).status).toBe(200);
    expect((await other.agent.get(`/api/v1/projects/${project.id}`)).status).toBe(404);
    expect((await other.agent.patch(`/api/v1/projects/${project.id}`).set('origin', ORIGIN).send({ name: 'hijack' })).status).toBe(404);
    const list = await other.agent.get('/api/v1/projects');
    expect(list.body.data.find((p: { id: string }) => p.id === project.id)).toBeUndefined();

    const updated = await owner.agent.patch(`/api/v1/projects/${project.id}`).set('origin', ORIGIN).send({ name: 'Renamed' });
    expect(updated.body.data.name).toBe('Renamed');
    expect((await owner.agent.delete(`/api/v1/projects/${project.id}`).set('origin', ORIGIN)).body.data.archived).toBe(true);
    expect((await owner.agent.get(`/api/v1/projects/${project.id}`)).status).toBe(404);
    expect(await t.prisma.project.findUnique({ where: { id: project.id } })).not.toBeNull();
  });

  it('requires authentication', async () => {
    const res = await t.http.get('/api/v1/projects');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('paginates', async () => {
    const { agent } = await signUp(t);
    for (let i = 0; i < 3; i++) await createProject(agent, `P${i}`);
    const res = await agent.get('/api/v1/projects?page=2&pageSize=2');
    expect(res.body.meta).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    expect(res.body.data).toHaveLength(1);
  });
});

describe('API keys', () => {
  it('shows the key once, stores only a hash, and authenticates SDK requests', async () => {
    const { agent } = await signUp(t);
    const project = await createProject(agent, 'Keyed');
    const created = await agent.post('/api/v1/api-keys').set('origin', ORIGIN).send({ name: 'CI', projectId: project.id });
    expect(created.status).toBe(201);
    const key: string = created.body.data.key;
    expect(key).toMatch(/^ag_/);

    const stored = await t.prisma.apiKey.findUniqueOrThrow({ where: { id: created.body.data.apiKey.id } });
    expect(stored.keyHash).not.toContain(key);
    expect(JSON.stringify((await agent.get('/api/v1/api-keys')).body)).not.toContain(key);

    const me = await t.http.get('/api/v1/auth/me').set('authorization', `Bearer ${key}`);
    expect(me.body.data).toMatchObject({ authMethod: 'api_key', apiKeyProjectId: project.id });
    const viaHeader = await t.http.get(`/api/v1/projects/${project.id}`).set('x-api-key', key);
    expect(viaHeader.status).toBe(200);
  });

  it('confines project-scoped keys and blocks key management via keys', async () => {
    const { agent } = await signUp(t);
    const a = await createProject(agent, 'Project A');
    const b = await createProject(agent, 'Project B');
    const key = (await agent.post('/api/v1/api-keys').set('origin', ORIGIN).send({ name: 'scoped', projectId: a.id })).body.data.key;
    const bearer = { authorization: `Bearer ${key}` };

    expect((await t.http.get(`/api/v1/projects/${b.id}`).set(bearer)).status).toBe(404);
    const list = await t.http.get('/api/v1/projects').set(bearer);
    expect(list.body.data.map((p: { id: string }) => p.id)).toEqual([a.id]);
    expect((await t.http.post('/api/v1/projects').set(bearer).send({ name: 'new' })).status).toBe(403);
    expect((await t.http.post('/api/v1/api-keys').set(bearer).send({ name: 'escalate' })).status).toBe(403);
  });

  it('rejects revoked and unknown keys', async () => {
    const { agent } = await signUp(t);
    const created = (await agent.post('/api/v1/api-keys').set('origin', ORIGIN).send({ name: 'temp' })).body.data;
    expect((await agent.delete(`/api/v1/api-keys/${created.apiKey.id}`).set('origin', ORIGIN)).status).toBe(200);
    const revoked = await t.http.get('/api/v1/projects').set('authorization', `Bearer ${created.key}`);
    expect(revoked.status).toBe(401);
    expect(revoked.body.error.message).toMatch(/invalid or has been revoked/);
    expect((await t.http.get('/api/v1/projects').set('authorization', 'Bearer ag_madeup')).status).toBe(401);
  });
});
