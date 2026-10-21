// Evaluation step 1 for system B1: decompose every brief in a suite with the production decomposer
// (the same code path as POST /api/briefs) and write one requirements file per brief.
// Usage: tsx scripts/eval-decompose.ts <suiteDir> <outDir> <runId>
import fs from 'fs';
import path from 'path';
import { OpenProblemDecomposer } from '../lib/ai/open_query';
import { getLLMProvider } from '../lib/ai/providers';
import { withLedgerScope } from '../lib/ai/ledger';

// Same input shaping as app/api/briefs/route.ts
const DECOMPOSITION_INPUT_CHARS = 12_000;

async function main() {
  const [suiteDir, outDir, runId] = process.argv.slice(2);
  if (!suiteDir || !outDir || !runId) {
    console.error('Usage: tsx scripts/eval-decompose.ts <suiteDir> <outDir> <runId>');
    process.exit(2);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(suiteDir, 'suite.json'), 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  const decomposer = new OpenProblemDecomposer(getLLMProvider());

  for (const briefId of manifest.briefs as string[]) {
    const brief = JSON.parse(fs.readFileSync(path.join(suiteDir, 'briefs', `${briefId}.json`), 'utf8'));
    const input = `Project brief: ${brief.title}\n\n${String(brief.brief).slice(0, DECOMPOSITION_INPUT_CHARS)}`;
    const started = Date.now();
    const { requirements, mode } = await withLedgerScope(
      { scopeType: 'eval', scopeId: `${runId}:${briefId}`, purpose: 'brief_decomposition' },
      () => decomposer.decomposeDetailed(input)
    );
    fs.writeFileSync(
      path.join(outDir, `${briefId}.json`),
      JSON.stringify({ briefId, mode, durationMs: Date.now() - started, requirements }, null, 2)
    );
    console.log(`[eval-decompose] ${briefId}: ${requirements.requirements.length} requirements (${mode})`);
  }
  // The ledger writes asynchronously; give pending inserts a moment before the pool closes
  await new Promise((resolve) => setTimeout(resolve, 500));
  process.exit(0);
}

main().catch((err) => {
  console.error('[eval-decompose] failed:', err);
  process.exit(1);
});
