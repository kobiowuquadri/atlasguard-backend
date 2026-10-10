import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { APP_CONFIG, type AppConfig } from './config/env';

// Load apps/api/.env when present (production platforms inject real environment variables).
try {
  process.loadEnvFile('.env');
} catch {
  // no .env file
}

async function main(): Promise<void> {
  const app = await createApp();
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.PORT, '0.0.0.0');
  Logger.log(
    `AtlasGuard API listening on port ${config.PORT}${config.SWAGGER_ENABLED ? ' — docs at /api/docs' : ''}`,
    'Bootstrap',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
