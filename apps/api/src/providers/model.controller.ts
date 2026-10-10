import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NATLAS_ATTRIBUTION } from '@atlasguard/shared';
import { Public } from '../common/decorators';
import { ModelConfigsService } from './model-configs.service';
import { ModelProviderRegistry } from './model-provider.registry';

@ApiTags('System')
@Controller()
export class ModelController {
  constructor(
    private readonly registry: ModelProviderRegistry,
    private readonly configs: ModelConfigsService,
  ) {}

  @Public()
  @Get('model/status')
  @ApiOperation({
    summary: 'Live status of the configured N-ATLaS endpoint (and of simulated fixtures, when enabled).',
  })
  async status(@Query('refresh') refresh?: string) {
    const force = refresh === 'true';
    const natlasHealth = await this.registry.health(this.registry.natlas, force);
    const natlasInfo =
      natlasHealth.status === 'available'
        ? await this.registry.natlas.getModelInfo()
        : {
            providerType: 'NATLAS' as const,
            providerName: this.registry.natlas.providerName,
            modelIdentifier: this.registry.natlas.modelIdentifier,
            simulated: false,
            reportedBy: 'configuration' as const,
          };
    return {
      natlas: { configured: this.registry.natlas.isConfigured(), health: natlasHealth, model: natlasInfo },
      fixtures: this.registry.fixture
        ? { enabled: true, health: await this.registry.health(this.registry.fixture, force), simulated: true }
        : { enabled: false },
      attribution: NATLAS_ATTRIBUTION,
    };
  }

  @Get('model-configurations')
  @ApiOperation({ summary: 'Model configurations available for evaluation runs on this server.' })
  async list() {
    const configs = await this.configs.listAvailable();
    return Promise.all(
      configs.map(async (c) => {
        const provider = c.providerType === 'NATLAS' ? this.registry.natlas : this.registry.fixture;
        const health = provider ? await this.registry.health(provider) : null;
        return { ...c, availability: health?.status ?? 'unavailable', availabilityMessage: health?.message ?? null };
      }),
    );
  }
}
