/** Regenerates schemas/benchmark-dataset.schema.json from the Zod schema in @atlasguard/shared. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { BenchmarkDatasetSchema } from '@atlasguard/shared';

const schema = z.toJSONSchema(BenchmarkDatasetSchema, { io: 'input', unrepresentable: 'any' });
const out = path.resolve(__dirname, '..', 'schemas', 'benchmark-dataset.schema.json');
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify(
    {
      ...schema,
      $id: 'https://atlasguard.dev/schemas/benchmark-dataset.schema.json',
      title: 'AtlasGuard benchmark dataset (formatVersion 1)',
      description:
        'Generated from @atlasguard/shared BenchmarkDatasetSchema. Cross-field rules (unique keys, one variant per language per group, verified content needs reviewer metadata) are enforced by the validator, not by this JSON Schema.',
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${path.relative(process.cwd(), out)}`);
