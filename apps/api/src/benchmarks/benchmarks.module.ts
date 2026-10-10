import { Module } from '@nestjs/common';
import { BenchmarkSeeder } from './benchmark-seeder.service';
import { BenchmarksController } from './benchmarks.controller';
import { BenchmarksService } from './benchmarks.service';

@Module({
  controllers: [BenchmarksController],
  providers: [BenchmarksService, BenchmarkSeeder],
  exports: [BenchmarksService, BenchmarkSeeder],
})
export class BenchmarksModule {}
