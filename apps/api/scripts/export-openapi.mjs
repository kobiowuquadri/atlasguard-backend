#!/usr/bin/env node
/**
 * Saves the OpenAPI document of a running API to docs/openapi.json.
 *   API_URL=http://localhost:4000 pnpm --filter @atlasguard/api openapi
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'openapi.json');
const res = await fetch(`${apiUrl}/api/docs-json`);
if (!res.ok) {
  console.error(`Could not fetch ${apiUrl}/api/docs-json (HTTP ${res.status}). Is the API running with SWAGGER_ENABLED=true?`);
  process.exit(1);
}
writeFileSync(out, `${JSON.stringify(await res.json(), null, 2)}\n`);
console.log(`wrote ${path.relative(process.cwd(), out)}`);
