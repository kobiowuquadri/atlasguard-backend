import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { BenchmarksModule } from './benchmarks/benchmarks.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/response.interceptor';
import { ConfigModule } from './config/config.module';
import { APP_CONFIG, type AppConfig } from './config/env';
import { DatabaseModule } from './database/database.module';
import { EvaluationsModule } from './evaluations/evaluations.module';
import { FeedbackController } from './feedback/feedback.controller';
import { InsightsModule } from './insights/insights.module';
import { ProjectsModule } from './projects/projects.module';
import { ProvidersModule } from './providers/providers.module';
import { ReportsModule } from './reports/reports.module';
import { SystemController } from './system/system.controller';
import { UsersController } from './users/users.controller';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
        skipIf: () => !config.RATE_LIMIT_ENABLED,
      }),
    }),
    AuthModule,
    ApiKeysModule,
    ProjectsModule,
    ProvidersModule,
    BenchmarksModule,
    EvaluationsModule,
    ReportsModule,
    InsightsModule,
  ],
  controllers: [SystemController, UsersController, FeedbackController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    },
  ],
})
export class AppModule {}
