/**
 * Development seed: imports AtlasGuard's official benchmark datasets (idempotent).
 * It never creates users, evaluation results or beta feedback — those must come from
 * real usage.
 *
 *   pnpm db:seed
 */
import { PrismaClient } from '@prisma/client';
import { loadOfficialDatasets } from '@atlasguard/benchmarks';
import { importDataset } from '../src/benchmarks/dataset-importer';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    for (const { dataset, warnings } of loadOfficialDatasets()) {
      const label = `${dataset.suite.slug} v${dataset.suite.version}`;
      const existing = await prisma.benchmarkSuite.findUnique({
        where: { namespace_slug_version: { namespace: 'official', slug: dataset.suite.slug, version: dataset.suite.version } },
      });
      if (existing) {
        console.log(`• ${label} already present — skipped`);
        continue;
      }
      await prisma.$transaction(
        (tx) =>
          importDataset(tx, dataset, {
            ownerId: null,
            official: true,
            visibility: dataset.suite.visibility === 'public' ? 'PUBLIC' : 'PRIVATE',
          }),
        { timeout: 60_000 },
      );
      console.log(`✔ imported ${label}${warnings.length ? ` (${warnings.length} quality warning(s))` : ''}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
