import type { ModelStatus } from '../types';
import { Resource } from './base';

export class SystemResource extends Resource {
  health(signal?: AbortSignal): Promise<{ status: string; version: string; evaluatorVersion: string }> {
    return this.getJson('/health', undefined, signal);
  }

  /** Whether the configured N-ATLaS endpoint is reachable, plus reported model provenance. */
  modelStatus(signal?: AbortSignal): Promise<ModelStatus> {
    return this.getJson('/model/status', undefined, signal);
  }

  modelConfigurations(signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return this.getJson('/model-configurations', undefined, signal);
  }
}
