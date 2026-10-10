import { Module } from '@nestjs/common';
import { ModelConfigsService } from './model-configs.service';
import { ModelController } from './model.controller';
import { ModelProviderRegistry } from './model-provider.registry';

@Module({
  controllers: [ModelController],
  providers: [ModelProviderRegistry, ModelConfigsService],
  exports: [ModelProviderRegistry, ModelConfigsService],
})
export class ProvidersModule {}
