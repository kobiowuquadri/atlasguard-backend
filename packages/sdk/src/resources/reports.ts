import type { ExportFormat } from '../types';
import { Resource } from './base';

export class ReportsResource extends Resource {
  /** Structured report built from stored evaluation records. */
  get(runId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.getJson(`/reports/${encodeURIComponent(runId)}`, undefined, signal);
  }

  /** Report export as text: JSON, CSV or Markdown. */
  export(runId: string, format: ExportFormat = 'json', signal?: AbortSignal): Promise<string> {
    return this.getText(`/reports/${encodeURIComponent(runId)}/export`, { format }, signal);
  }

  /** Compares two runs of the same benchmark suite. */
  compare(baseRunId: string, targetRunId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.getJson('/reports/compare', { baseRunId, targetRunId }, signal);
  }

  /**
   * N-ATLaS integration evidence for a completed, non-simulated run. The API refuses this
   * for simulated runs (EVIDENCE_EXPORT_DISABLED).
   */
  evidence(runId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.getJson(`/reports/${encodeURIComponent(runId)}/evidence`, undefined, signal);
  }
}
