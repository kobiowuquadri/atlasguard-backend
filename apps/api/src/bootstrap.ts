import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { NATLAS_ATTRIBUTION } from '@atlasguard/shared';
import { AppModule } from './app.module';
import { requestIdMiddleware, requestLogMiddleware } from './common/http-middleware';
import { APP_CONFIG, loadConfig, type AppConfig } from './config/env';
import { API_VERSION } from './system/system.controller';

const LOG_LEVELS: Record<AppConfig['LOG_LEVEL'], LogLevel[]> = {
  debug: ['debug', 'verbose', 'log', 'warn', 'error', 'fatal'],
  info: ['log', 'warn', 'error', 'fatal'],
  warn: ['warn', 'error', 'fatal'],
  error: ['error', 'fatal'],
};

export function createLogger(config: AppConfig): ConsoleLogger {
  return new ConsoleLogger('AtlasGuard', {
    json: config.isProduction,
    logLevels: config.NODE_ENV === 'test' ? ['error', 'fatal'] : LOG_LEVELS[config.LOG_LEVEL],
  });
}

export async function createApp(): Promise<NestExpressApplication> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: createLogger(config),
  });
  configureApp(app);
  return app;
}

export function buildOpenApiDocument(app: NestExpressApplication): OpenAPIObject {
  const config = app.get<AppConfig>(APP_CONFIG);
  const builder = new DocumentBuilder()
    .setTitle('AtlasGuard API')
    .setDescription(
      [
        'Multilingual evaluation and reliability infrastructure for N-ATLaS (Yoruba, Hausa, Igbo, Nigerian English).',
        '',
        'Authenticate with an API key (`Authorization: Bearer ag_…`, created in the dashboard) or a dashboard session cookie.',
        'Successful responses are wrapped as `{ "success": true, "data": … }`; errors as `{ "success": false, "error": { "code", "message", "requestId" } }`.',
        '',
        NATLAS_ATTRIBUTION,
      ].join('\n'),
    )
    .setVersion(API_VERSION)
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'AtlasGuard API key (ag_…)' })
    .addCookieAuth(config.SESSION_COOKIE_NAME)
    .build();
  return SwaggerModule.createDocument(app, builder);
}

/** Security, parsing, CORS, routing and docs. Shared by the server and integration tests. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<AppConfig>(APP_CONFIG);
  if (config.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { limit: '100kb', extended: false });
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: config.isProduction,
    }),
  );
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.use(requestLogMiddleware);
  app.enableCors({
    origin: config.APP_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-api-key', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'content-disposition'],
    maxAge: 600,
  });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  if (config.SWAGGER_ENABLED) {
    SwaggerModule.setup('api/docs', app, () => buildOpenApiDocument(app), {
      jsonDocumentUrl: 'api/docs-json',
      customSiteTitle: 'AtlasGuard API',
    });
  }
}
