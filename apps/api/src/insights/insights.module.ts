import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ProvidersModule } from '../providers/providers.module';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';

@Module({
  imports: [ProjectsModule, ProvidersModule],
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
