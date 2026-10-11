// Verifies AtlasGuard N-ATLaS evidence bundles without any dependencies:
//   node evidence/verify-evidence.mjs evidence/integration
//   node evidence/verify-evidence.mjs path/to/bundle.json [...]
// A folder argument checks every evidence bundle in it (other JSON files are skipped).
// The digest is SHA-256 over the bundle without its `integrity` field, serialised as JSON with
// object keys sorted recursively (the same canonical form the API uses when it exports a bundle).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const KIND = 'atlasguard.natlas-integration-evidence';

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
};

const targets = [];
for (const arg of process.argv.slice(2)) {
  if (statSync(arg).isDirectory()) {
    for (const name of readdirSync(arg).filter((n) => n.endsWith('.json')).sort()) {
      const file = join(arg, name);
      if (JSON.parse(readFileSync(file, 'utf8')).kind === KIND) targets.push(file);
    }
  } else {
    targets.push(arg);
  }
}

let failures = 0;
for (const file of targets) {
  const { integrity, ...bundle } = JSON.parse(readFileSync(file, 'utf8'));
  const digest = createHash('sha256').update(JSON.stringify(sortKeys(bundle))).digest('hex');
  const ok = bundle.kind === KIND && integrity?.algorithm === 'sha256' && integrity.digest === digest;
  if (!ok) failures++;
  const { cases, responses, errors, servedModels } = bundle.statistics ?? {};
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${file}\n     run ${bundle.run?.id} · ${responses}/${cases} responses · ${errors} errors · served by ${servedModels?.join(', ')}\n     sha256 ${digest}`,
  );
}
if (targets.length === 0) console.log('usage: node verify-evidence.mjs <folder | bundle.json> [...]');
process.exit(failures || targets.length === 0 ? 1 : 0);
