import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { ModelConfiguration, Prisma } from '@prisma/client';
import { FIXTURE_MODEL_ID } from '@atlasguard/evaluator';
import { SUPPORTED_LANGUAGES } from '@atlasguard/shared';
import { AppException } from '../common/app-exception';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import { FIXTURE_ENDPOINT_REFERENCE, NATLAS_ENDPOINT_REFERENCE } from './model-provider.registry';

/** System prompt recommended on the official N-ATLaS model card. */
export const NATLAS_DEFAULT_SYSTEM_PROMPT =
  'you are a large language model trained by Awarri AI technologies. You are a friendly assistant and you are here to help.';

export interface InferenceDefaults {
  temperature: number;
  maxTokens: number;
  topP?: number;
  repetitionPenalty?: number;
  systemPrompt: string | null;
}

/** Defaults follow the model card (temperature 0.1, repetition penalty 1.12). */
export const NATLAS_DEFAULT_PARAMETERS: InferenceDefaults = {
  temperature: 0.1,
  maxTokens: 512,
  repetitionPenalty: 1.12,
  systemPrompt: NATLAS_DEFAULT_SYSTEM_PROMPT,
};

export const SYSTEM_NATLAS_KEY = 'system-natlas';
export const SYSTEM_FIXTURE_KEY = 'system-fixture';

@Injectable()
export class ModelConfigsService implements OnModuleInit {
  private readonly logger = new Logger(ModelConfigsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Keeps the system configurations in sync with server configuration at boot. */
  async onModuleInit(): Promise<void> {
    await this.syncSystemConfigurations();
  }

  async syncSystemConfigurations(): Promise<void> {
    const natlas: Prisma.ModelConfigurationUncheckedCreateInput = {
      key: SYSTEM_NATLAS_KEY,
      name: 'N-ATLaS 8B — AtlasGuard inference endpoint',
      providerType: 'NATLAS',
      modelIdentifier: this.config.NATLAS_MODEL_ID,
      modelRevision: this.config.NATLAS_MODEL_REVISION || null,
      endpointReference: NATLAS_ENDPOINT_REFERENCE,
      supportedLanguages: [...SUPPORTED_LANGUAGES],
      defaultParameters: NATLAS_DEFAULT_PARAMETERS as unknown as Prisma.InputJsonValue,
      isSimulated: false,
    };
    const { key: natlasKey, ...natlasUpdate } = natlas;
    await this.prisma.modelConfiguration.upsert({ where: { key: natlasKey! }, create: natlas, update: natlasUpdate });

    const fixture: Prisma.ModelConfigurationUncheckedCreateInput = {
      key: SYSTEM_FIXTURE_KEY,
      name: 'Development fixtures (SIMULATED — not N-ATLaS)',
      providerType: 'FIXTURE',
      modelIdentifier: FIXTURE_MODEL_ID,
      modelRevision: null,
      endpointReference: FIXTURE_ENDPOINT_REFERENCE,
      supportedLanguages: [...SUPPORTED_LANGUAGES],
      defaultParameters: { temperature: 0, maxTokens: 512, systemPrompt: null } as Prisma.InputJsonValue,
      isSimulated: true,
    };
    const { key: fixtureKey, ...fixtureUpdate } = fixture;
    await this.prisma.modelConfiguration.upsert({ where: { key: fixtureKey! }, create: fixture, update: fixtureUpdate });
    this.logger.log('System model configurations synchronised.');
  }

  /** Configurations usable on this server, real N-ATLaS first. */
  async listAvailable(): Promise<ModelConfiguration[]> {
    const configs = await this.prisma.modelConfiguration.findMany({
      where: { projectId: null, ...(!this.config.ENABLE_FIXTURE_PROVIDER && { providerType: 'NATLAS' }) },
      orderBy: [{ isSimulated: 'asc' }, { createdAt: 'asc' }],
    });
    return configs;
  }

  async resolve(id: string | undefined): Promise<ModelConfiguration> {
    const config = id
      ? await this.prisma.modelConfiguration.findFirst({ where: { id, projectId: null } })
      : await this.prisma.modelConfiguration.findUnique({ where: { key: SYSTEM_NATLAS_KEY } });
    if (!config) throw AppException.notFound('Model configuration');
    if (config.providerType === 'FIXTURE' && !this.config.ENABLE_FIXTURE_PROVIDER) {
      throw AppException.notFound('Model configuration');
    }
    return config;
  }
}
