import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/database/prisma.service';
import { EvaluationWorker } from '../src/evaluations/evaluation-worker.service';

export const ORIGIN = 'http://localhost:3000';

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  WORKER_ENABLED: 'false',
  RATE_LIMIT_ENABLED: 'false',
  AUTO_SEED_BENCHMARKS: 'true',
  ENABLE_FIXTURE_PROVIDER: 'true',
  FIXTURE_DELAY_MS: '0',
  NATLAS_BASE_URL: '',
  NATLAS_API_KEY: '',
  APP_ORIGINS: ORIGIN,
  API_KEY_PEPPER: 'integration-test-pepper-0123456789abcdef',
  ADMIN_EMAILS: 'admin@atlasguard.test,benchmark-admin@atlasguard.test',
  SWAGGER_ENABLED: 'true',
};

export interface TestApp {
  app: NestExpressApplication;
  http: ReturnType<typeof request>;
  prisma: PrismaService;
  worker: EvaluationWorker;
  close: () => Promise<void>;
}

/** Boots the real AppModule against the test database (worker driven manually). */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  Object.assign(process.env, TEST_ENV, env);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: ['error'] });
  configureApp(app);
  await app.init();
  return {
    app,
    http: request(app.getHttpServer()),
    prisma: app.get(PrismaService),
    worker: app.get(EvaluationWorker),
    close: () => app.close(),
  };
}

let counter = 0;

/** Registers a user and returns a cookie-carrying agent. */
export async function signUp(t: TestApp, overrides: { email?: string; name?: string } = {}) {
  counter++;
  const email = overrides.email ?? `user${counter}-${Date.now()}@atlasguard.test`;
  const agent = request.agent(t.app.getHttpServer());
  const res = await agent
    .post('/api/v1/auth/register')
    .set('origin', ORIGIN)
    .send({ name: overrides.name ?? `Tester ${counter}`, email, password: 'correct horse battery' });
  if (res.status !== 201) throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.data.user as { id: string; email: string; role: string }, email };
}

export async function createProject(agent: request.Agent, name = 'Test project') {
  const res = await agent.post('/api/v1/projects').set('origin', ORIGIN).send({ name });
  if (res.status !== 201) throw new Error(`project failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; name: string };
}

export async function officialSuiteId(t: TestApp): Promise<string> {
  const suite = await t.prisma.benchmarkSuite.findFirstOrThrow({ where: { namespace: 'official', slug: 'nigerian-context-v1' } });
  return suite.id;
}

export async function modelConfigId(t: TestApp, key: 'system-natlas' | 'system-fixture'): Promise<string> {
  return (await t.prisma.modelConfiguration.findUniqueOrThrow({ where: { key } })).id;
}

/** Drains the evaluation queue synchronously. */
export async function drainQueue(t: TestApp, max = 10) {
  for (let i = 0; i < max; i++) {
    if (!(await t.worker.processNextRun())) return;
  }
}
