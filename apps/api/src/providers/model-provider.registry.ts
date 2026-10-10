import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { ModelConfiguration } from '@prisma/client';
import { loadFixtures } from '@atlasguard/benchmarks';
import { FixtureProvider, NatlasProvider, type ModelProvider, type ProviderHealth } from '@atlasguard/evaluator';
import { AppException } from '../common/app-exception';
import { APP_CONFIG, type AppConfig } from '../config/env';

export const NATLAS_ENDPOINT_REFERENCE = 'env:NATLAS';
export const FIXTURE_ENDPOINT_REFERENCE = 'fixture:builtin';
const HEALTH_CACHE_MS = 15_000;

/**
 * Resolves model configurations to provider instances. Endpoints are only ever taken from
 * server configuration (never from user input), which rules out SSRF via model settings.
 */
@Injectable()
export class ModelProviderRegistry {
  private readonly logger = new Logger(ModelProviderRegistry.name);
  readonly natlas: NatlasProvider;
  readonly fixture: FixtureProvider | null;
  private readonly healthCache = new Map<string, { at: number; value: Promise<ProviderHealth> }>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.natlas = new NatlasProvider({
      baseUrl: config.NATLAS_BASE_URL || null,
      apiKey: config.NATLAS_API_KEY || null,
      modelId: config.NATLAS_MODEL_ID,
      acceptedModelNames: config.NATLAS_ACCEPTED_MODEL_NAMES,
      timeoutMs: config.NATLAS_TIMEOUT_MS,
      maxRetries: config.NATLAS_MAX_RETRIES,
      maxConcurrency: config.NATLAS_MAX_CONCURRENCY,
      healthPath: config.NATLAS_HEALTH_PATH,
    });
    this.fixture = config.ENABLE_FIXTURE_PROVIDER
      ? new FixtureProvider({ fixtures: loadFixtures(), delayMs: config.FIXTURE_DELAY_MS })
      : null;
    if (!this.natlas.isConfigured()) {
      this.logger.warn('NATLAS_BASE_URL is not set: real N-ATLaS evaluations are unavailable until an endpoint is configured.');
    }
    if (this.fixture) {
      this.logger.warn('Development fixture provider is ENABLED. Fixture runs are simulated and labelled as such.');
    }
  }

  forConfiguration(config: Pick<ModelConfiguration, 'endpointReference' | 'providerType'>): ModelProvider {
    if (config.providerType === 'NATLAS' && config.endpointReference === NATLAS_ENDPOINT_REFERENCE) {
      if (!this.natlas.isConfigured()) {
        throw new AppException(
          'MODEL_PROVIDER_NOT_CONFIGURED',
          'No N-ATLaS inference endpoint is configured on this server. Set NATLAS_BASE_URL (see docs/natlas-integration.md).',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      return this.natlas;
    }
    if (config.providerType === 'FIXTURE' && config.endpointReference === FIXTURE_ENDPOINT_REFERENCE && this.fixture) {
      return this.fixture;
    }
    throw new AppException(
      'UNSUPPORTED_MODEL_CONFIGURATION',
      'This model configuration is not available on this server.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /** Health check with a short cache so dashboards polling status do not hammer the endpoint. */
  health(provider: ModelProvider, force = false): Promise<ProviderHealth> {
    const key = provider.providerType;
    const cached = this.healthCache.get(key);
    if (!force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) return cached.value;
    const value = provider.healthCheck();
    this.healthCache.set(key, { at: Date.now(), value });
    return value;
  }
}
