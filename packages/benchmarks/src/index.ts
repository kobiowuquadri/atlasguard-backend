import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseBenchmarkDataset, type BenchmarkDataset, type DatasetIssue } from '@atlasguard/shared';

/** Package root (works from both `src/` during tests and `dist/` after build). */
const PACKAGE_ROOT = path.resolve(__dirname, '..');
export const DATASETS_DIR = path.join(PACKAGE_ROOT, 'datasets');
export const FIXTURES_DIR = path.join(PACKAGE_ROOT, 'fixtures');

export interface LoadedDataset {
  file: string;
  dataset: BenchmarkDataset;
  warnings: DatasetIssue[];
}

export class DatasetValidationError extends Error {
  constructor(
    readonly file: string,
    readonly errors: DatasetIssue[],
  ) {
    super(`${file} is not a valid benchmark dataset:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`);
    this.name = 'DatasetValidationError';
  }
}

export function listDatasetFiles(dir = DATASETS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(dir, f));
}

export function loadDataset(file: string): LoadedDataset {
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const parsed = parseBenchmarkDataset(raw);
  if (!parsed.ok) throw new DatasetValidationError(path.basename(file), parsed.errors);
  return { file, dataset: parsed.dataset, warnings: parsed.warnings };
}

/** Loads and validates every dataset shipped with AtlasGuard. */
export function loadOfficialDatasets(): LoadedDataset[] {
  return listDatasetFiles().map(loadDataset);
}

/**
 * SIMULATED development fixtures, keyed by case key. These are hand-written responses used
 * only by the fixture provider; they are not model output.
 */
export function loadFixtures(dir = FIXTURES_DIR): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.fixtures.json'))) {
    const content = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as { responses?: Record<string, string> };
    Object.assign(merged, content.responses ?? {});
  }
  return merged;
}
