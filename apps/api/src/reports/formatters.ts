import type { ReportDocument } from './reports.service';

/** Quotes a CSV cell and neutralises spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

const pct = (rate: number | null) => (rate === null ? '—' : `${(rate * 100).toFixed(1)}%`);
const ms = (value: number | null) => (value === null ? '—' : `${value.toLocaleString('en-NG')} ms`);
const cell = (value: unknown) => String(value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Human-readable Markdown report built only from stored evaluation records. */
export function toMarkdown(report: ReportDocument): string {
  const o = report.overview;
  const s = report.summary;
  const lines: string[] = [];
  lines.push(`# AtlasGuard evaluation report`);
  lines.push('');
  if (report.simulated) {
    lines.push(`> **SIMULATED RUN.** ${report.simulationNotice}`);
    lines.push('');
  }
  lines.push(`## Overview`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Project | ${cell(o.project.name)} |`);
  lines.push(`| Evaluation run | \`${o.run.id}\` (${o.run.status}) |`);
  lines.push(`| Benchmark suite | ${cell(o.benchmark.name)} \`${o.benchmark.slug}\` v${o.benchmark.version} |`);
  lines.push(`| Benchmark content hash | \`${o.benchmark.contentHash}\` |`);
  lines.push(`| Model | \`${o.model.modelIdentifier}\`${o.model.modelRevision ? ` @ \`${o.model.modelRevision}\`` : ''} (${o.model.providerType}) |`);
  lines.push(`| Languages | ${o.languages.join(', ')} |`);
  lines.push(`| Executed | ${o.run.startedAt ?? '—'} → ${o.run.completedAt ?? '—'} |`);
  lines.push(`| Evaluator | ${report.generator.evaluatorVersion} |`);
  lines.push('');
  lines.push(`## Results summary`);
  lines.push('');
  lines.push(`| Total | Completed | Passed | Failed | Needs review | Errors | Skipped | Verified pass rate | Avg latency |`);
  lines.push(`| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  lines.push(
    `| ${s.total} | ${s.completed} | ${s.passed} | ${s.failed} | ${s.needsReview} | ${s.errors} | ${s.skipped} | ${pct(s.verifiedPassRate)} | ${ms(s.averageLatencyMs)} |`,
  );
  lines.push('');
  lines.push(`## Language performance`);
  lines.push('');
  lines.push(`| Language | Cases | Passed | Failed | Needs review | Errors | Verified pass rate | Avg latency |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const l of report.languagePerformance) {
    lines.push(`| ${l.name} | ${l.total} | ${l.passed} | ${l.failed} | ${l.needsReview} | ${l.errors} | ${pct(l.verifiedPassRate)} | ${ms(l.averageLatencyMs)} |`);
  }
  lines.push('');
  lines.push(`## Category performance`);
  lines.push('');
  lines.push(`| Category | Cases | Passed | Failed | Needs review | Verified pass rate |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: |`);
  for (const c of report.categoryPerformance) {
    lines.push(`| ${c.label} | ${c.total} | ${c.passed} | ${c.failed} | ${c.needsReview} | ${pct(c.verifiedPassRate)} |`);
  }
  lines.push('');
  lines.push(`## Cross-language consistency`);
  lines.push('');
  const cs = report.consistency;
  lines.push(
    `${cs.groupsCompared} semantic group(s) compared — confirmed contradictions: ${cs.confirmedContradictions}; ` +
      Object.entries(cs.byVerdict)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', '),
  );
  lines.push('');
  for (const g of cs.groups) {
    lines.push(`### ${cell(g.title)} — ${g.verdict}`);
    lines.push('');
    lines.push(`Languages compared: ${g.languagesCompared.join(', ') || '—'}${g.languagesMissing.length ? `; missing: ${g.languagesMissing.join(', ')}` : ''}`);
    lines.push('');
    for (const f of g.findings) lines.push(`- **${f.type}** (${f.severity}): ${f.message}`);
    lines.push('');
  }
  lines.push(`## Detailed findings`);
  lines.push('');
  for (const f of report.findings) {
    lines.push(`### ${f.caseKey} — ${f.finalVerdict ?? 'PENDING'}${f.humanReviewed ? ' (human-reviewed)' : ''}`);
    lines.push('');
    lines.push(`**Prompt:** ${f.prompt}`);
    lines.push('');
    lines.push(`**Model response:** ${f.response ?? `_No response — ${f.error?.code ?? 'not executed'}${f.error?.message ? `: ${f.error.message}` : ''}_`}`);
    lines.push('');
    if (f.referenceFacts.length) {
      lines.push(`**Reference facts:** ${f.referenceFacts.join('; ')}`);
      lines.push('');
    }
    for (const c of f.checks) {
      lines.push(`- \`${c.id}\` **${c.status}** — ${c.explanation}${c.evidence ? ` _Evidence: ${c.evidence}_` : ''}`);
    }
    lines.push(`- Latency: ${ms(f.latencyMs)}`);
    lines.push('');
  }
  lines.push(`## Methodology`);
  lines.push('');
  for (const [k, v] of Object.entries(report.methodology)) lines.push(`- **${k}**: ${v}`);
  lines.push('');
  lines.push(`## Limitations`);
  lines.push('');
  for (const l of report.limitations) lines.push(`- ${l}`);
  lines.push('');
  lines.push(`## Model information`);
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify({ model: o.model, inference: o.inference }, null, 2));
  lines.push('```');
  lines.push('');
  lines.push(`_${report.attribution}_`);
  lines.push('');
  lines.push(`_Generated by AtlasGuard at ${report.generatedAt}._`);
  return `${lines.join('\n')}\n`;
}
