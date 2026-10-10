/**
 * Validates every dataset in datasets/ (or the files given as arguments) against the
 * AtlasGuard dataset schema and prints quality warnings plus a review-status summary.
 *
 *   pnpm --filter @atlasguard/benchmarks validate [file.json ...]
 */
import path from 'node:path';
import { listDatasetFiles, loadDataset, DatasetValidationError } from '../src/index';

const files = process.argv.slice(2).length > 0 ? process.argv.slice(2).map((f) => path.resolve(f)) : listDatasetFiles();
let failed = false;

for (const file of files) {
  try {
    const { dataset, warnings } = loadDataset(file);
    const cases = [...dataset.semanticGroups.flatMap((g) => g.cases), ...dataset.cases];
    const byStatus = cases.reduce<Record<string, number>>((acc, c) => {
      acc[c.provenance.reviewStatus] = (acc[c.provenance.reviewStatus] ?? 0) + 1;
      return acc;
    }, {});
    const byLanguage = cases.reduce<Record<string, number>>((acc, c) => {
      acc[c.language] = (acc[c.language] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`✔ ${path.basename(file)} — ${dataset.suite.name} v${dataset.suite.version}`);
    console.log(`  ${dataset.semanticGroups.length} semantic groups, ${cases.length} cases`);
    console.log(`  languages: ${Object.entries(byLanguage).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    console.log(`  review status: ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    for (const w of warnings) console.log(`  ⚠ ${w.path}: ${w.message}`);
  } catch (error) {
    failed = true;
    if (error instanceof DatasetValidationError) {
      console.error(`✘ ${error.message}`);
    } else {
      console.error(`✘ ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

process.exitCode = failed ? 1 : 0;
