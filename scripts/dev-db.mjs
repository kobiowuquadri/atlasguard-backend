#!/usr/bin/env node
/**
 * Starts a real PostgreSQL 17 server for local development without Docker or admin rights,
 * using the official binaries packaged by `embedded-postgres`. Data persists in .data/postgres.
 *
 *   pnpm db:start                         # keeps running until Ctrl+C
 *   pnpm db:start -- --recreate-non-utf8  # drop & recreate databases that are not UTF-8
 *
 * Connection string: postgresql://atlasguard:atlasguard@localhost:54329/atlasguard
 * (override the port with DEV_DB_PORT). Use Docker Compose or a hosted database instead
 * if you prefer; AtlasGuard only needs DATABASE_URL pointing at a UTF-8 database.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseDir = path.join(root, '.data', 'postgres');
const port = Number(process.env.DEV_DB_PORT ?? 54329);
const recreate = process.argv.includes('--recreate-non-utf8');

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'atlasguard',
  password: 'atlasguard',
  port,
  persistent: true,
  // Yoruba, Hausa and Igbo text (and ₦) require UTF-8 regardless of the OS code page.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
  onError: (message) => console.error(String(message).trim()),
});

/** Creates `name` as a UTF-8 database (from template0) if it does not exist. */
export async function ensureUtf8Database(client, name, { recreateIfWrongEncoding = false } = {}) {
  const { rows } = await client.query(
    'SELECT pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = $1',
    [name],
  );
  if (rows.length > 0 && rows[0].encoding === 'UTF8') return 'exists';
  if (rows.length > 0) {
    if (!recreateIfWrongEncoding) {
      throw new Error(
        `Database "${name}" uses ${rows[0].encoding}, but AtlasGuard requires UTF8. ` +
          'Re-run with --recreate-non-utf8 to drop and recreate it (its data will be lost).',
      );
    }
    await client.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await client.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  return rows.length > 0 ? 'recreated' : 'created';
}

if (!existsSync(path.join(databaseDir, 'PG_VERSION'))) {
  console.log(`Initialising a new PostgreSQL cluster in ${path.relative(root, databaseDir)} …`);
  await pg.initialise();
}
await pg.start();

const client = pg.getPgClient();
await client.connect();
try {
  for (const name of ['atlasguard', 'atlasguard_test']) {
    const outcome = await ensureUtf8Database(client, name, { recreateIfWrongEncoding: recreate });
    if (outcome !== 'exists') console.log(`${outcome === 'created' ? 'Created' : 'Recreated'} UTF-8 database ${name}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await client.end();
  await pg.stop();
  process.exit(1);
}
await client.end();

console.log(`PostgreSQL is running: postgresql://atlasguard:atlasguard@localhost:${port}/atlasguard`);
console.log('Press Ctrl+C to stop.');

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
