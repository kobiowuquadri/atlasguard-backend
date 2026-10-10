import { Module } from '@nestjs/common';
import { BenchmarksModule } from '../benchmarks/benchmarks.module';
import { ProjectsModule } from '../projects/projects.module';
import { ProvidersModule } from '../providers/providers.module';
import { EvaluationWorker } from './evaluation-worker.service';
import { EvaluationsController } from './evaluations.controller';
import { EvaluationsService } from './evaluations.service';
import { RunAnalysisService } from './run-analysis.service';

@Module({
  imports: [ProjectsModule, BenchmarksModule, ProvidersModule],
  controllers: [EvaluationsController],
  providers: [EvaluationsService, EvaluationWorker, RunAnalysisService],
  exports: [EvaluationsService, EvaluationWorker, RunAnalysisService],
})
export class EvaluationsModule {}
