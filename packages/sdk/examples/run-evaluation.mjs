// Plain JavaScript (ESM) usage of the built SDK.
//   pnpm --filter @atlasguard/sdk build
//   ATLASGUARD_BASE_URL=… ATLASGUARD_API_KEY=… ATLASGUARD_PROJECT_ID=… node examples/run-evaluation.mjs
import { AtlasGuard } from '../dist/index.js';

const atlas = new AtlasGuard({ baseUrl: process.env.ATLASGUARD_BASE_URL, apiKey: process.env.ATLASGUARD_API_KEY });

const run = await atlas.evaluations.run({
  projectId: process.env.ATLASGUARD_PROJECT_ID,
  suiteId: 'nigerian-context-v1',
  languages: ['ha', 'ig'],
  categories: ['civic_information'],
});
const finished = await atlas.evaluations.waitForCompletion(run.id);
console.log(finished.status, finished.summary?.byLanguage);
