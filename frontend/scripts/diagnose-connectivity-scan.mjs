/**
 * 診斷斷路掃描結果（泛用規則，不預設鏈數）
 * npx tsx frontend/scripts/diagnose-connectivity-scan.mjs [map.json]
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mapPath = process.argv[2];
if (!mapPath) {
  console.error('Usage: npx tsx frontend/scripts/diagnose-connectivity-scan.mjs <map.json>');
  process.exit(1);
}
const map = JSON.parse(readFileSync(mapPath, 'utf8'));

const scanMod = await import(
  pathToFileURL(
    join(__dirname, '../src/features/map-editor/utils/trackConnectivityScan.ts'),
  ).href
);

const plan = scanMod.buildConnectivityScanPlan(map.areas ?? []);

console.log('Map:', mapPath);
console.log('Segments in network:', plan.segmentById.size);
console.log('Discovered chains:', plan.chains.length);
plan.chains.forEach((chain, i) => {
  const labels = chain.segmentIds.map((id) =>
    scanMod.trackDisplayLabel(plan.segmentById.get(id), id),
  );
  console.log(
    `  chain ${i + 1} (${chain.segmentIds.length}):`,
    labels.slice(0, 6).join(', '),
    labels.length > 6 ? `... +${labels.length - 6}` : '',
  );
  if (chain.pendingIssues.length > 0) {
    chain.pendingIssues.forEach((entry) => {
      console.log(`    issue @${entry.revealIndex}: [${entry.issue.kind}] ${entry.issue.message}`);
    });
  }
});

const endpointGaps = plan.issues.filter((i) => i.kind === 'endpoint_gap');
console.log('\nEndpoint gaps (physical adjacent, refField not connected):', endpointGaps.length);
endpointGaps.slice(0, 10).forEach((issue) => {
  console.log(`  - ${issue.message}`);
});
if (endpointGaps.length > 10) {
  console.log(`  ... +${endpointGaps.length - 10} more`);
}
