import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { loadOfficialDatasets } from '@atlasguard/benchmarks';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import { importDataset } from './dataset-importer';

/**
 * Imports AtlasGuard's official benchmark datasets that are not yet in the database.
 * Existing suites are never modified, so reviews recorded in the app are preserved.
 */
@Injectable()
export class BenchmarkSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(BenchmarkSeeder.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.AUTO_SEED_BENCHMARKS) await this.seed();
  }

  async seed(): Promise<number> {
    let imported = 0;
    for (const { dataset } of loadOfficialDatasets()) {
      const exists = await this.prisma.benchmarkSuite.findUnique({
        where: {
          namespace_slug_version: { namespace: 'official', slug: dataset.suite.slug, version: dataset.suite.version },
        },
      });
      if (exists) continue;
      await this.prisma.$transaction(
        (tx) =>
          importDataset(tx, dataset, {
            ownerId: null,
            official: true,
            visibility: dataset.suite.visibility === 'public' ? 'PUBLIC' : 'PRIVATE',
          }),
        { timeout: 60_000 },
      );
      imported++;
      this.logger.log(`Imported official benchmark ${dataset.suite.slug} v${dataset.suite.version}.`);
    }
    return imported;
  }
}
