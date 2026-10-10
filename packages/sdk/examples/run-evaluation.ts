/**
 * Runs the Nigerian Context Benchmark for two languages and prints a summary.
 *
 *   ATLASGUARD_BASE_URL=https://your-host ATLASGUARD_API_KEY=ag_… ATLASGUARD_PROJECT_ID=… \
 *     npx tsx examples/run-evaluation.ts
 */
import { AtlasGuard, AtlasGuardApiError } from '../src/index';

async function main() {
  const atlas = new AtlasGuard({
    baseUrl: process.env.ATLASGUARD_BASE_URL!,
    apiKey: process.env.ATLASGUARD_API_KEY!,
  });

  const status = await atlas.system.modelStatus();
  console.log(`N-ATLaS endpoint: ${status.natlas.health.status} — ${status.natlas.health.message}`);

  const { items: suites } = await atlas.benchmarks.list();
  console.log('Suites:', suites.map((s) => `${s.slug} v${s.version} (${s.stats.caseCount} cases)`).join(', '));

  const run = await atlas.evaluations.run({
    projectId: process.env.ATLASGUARD_PROJECT_ID!,
    suiteId: 'nigerian-context-v1',
    languages: ['en-NG', 'yo'],
  });
  console.log(`Queued run ${run.id} (${run.totalCases} cases)`);

  const finished = await atlas.evaluations.waitForCompletion(run.id, {
    onProgress: (r) => process.stdout.write(`\r${r.status} ${r.progress?.done ?? 0}/${r.totalCases}   `),
  });
  console.log(`\nStatus: ${finished.status}${finished.isSimulated ? ' (SIMULATED fixtures)' : ''}`);

  const overall = finished.summary?.overall;
  if (overall) {
    console.log(
      `Verified pass rate: ${overall.verifiedPassRate === null ? 'n/a' : `${(overall.verifiedPassRate * 100).toFixed(1)}%`}` +
        ` (passed ${overall.passed}, failed ${overall.failed}, review ${overall.needsReview}, errors ${overall.errors})`,
    );
  }

  for (const group of await atlas.evaluations.consistency(run.id)) {
    if (group.verdict !== 'CONSISTENT') console.log(`- ${group.title}: ${group.verdict} — ${group.findings[0]?.message ?? ''}`);
  }

  const markdown = await atlas.reports.export(run.id, 'markdown');
  console.log(`\nMarkdown report: ${markdown.length} characters`);
}

main().catch((error) => {
  if (error instanceof AtlasGuardApiError) console.error(`${error.code} (${error.status}): ${error.message} [request ${error.requestId}]`);
  else console.error(error);
  process.exit(1);
});
