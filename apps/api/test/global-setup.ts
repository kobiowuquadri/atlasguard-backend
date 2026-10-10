/**
 * Starts a disposable PostgreSQL database for the integration tests and applies the
 * Prisma migrations. Uses TEST_DATABASE_URL when provided (CI service container),
 * otherwise an embedded PostgreSQL 17 cluster in .data/postgres-test.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const API_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(API_ROOT, '..', '..');

function migrate(url: string) {
  execSync('npx prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}

export default async function setup() {
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    migrate(process.env.TEST_DATABASE_URL);
    return () => undefined;
  }

  const port = Number(process.env.TEST_DB_PORT ?? 54330);
  const databaseDir = path.join(REPO_ROOT, '.data', 'postgres-test');
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: 'atlasguard',
    password: 'atlasguard',
    port,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
  });
  if (!existsSync(path.join(databaseDir, 'PG_VERSION'))) await pg.initialise();
  await pg.start();

  const client = pg.getPgClient();
  await client.connect();
  await client.query('DROP DATABASE IF EXISTS atlasguard_e2e WITH (FORCE)');
  await client.query(`CREATE DATABASE atlasguard_e2e ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  await client.end();

  const url = `postgresql://atlasguard:atlasguard@localhost:${port}/atlasguard_e2e`;
  process.env.DATABASE_URL = url;
  migrate(url);

  return async () => {
    await pg.stop();
  };
}
