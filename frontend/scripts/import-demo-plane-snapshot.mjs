#!/usr/bin/env node
/**
 * 將瀏覽器匯出的 demo-plane JSON 寫入內建還原快照
 * 用法：node scripts/import-demo-plane-snapshot.mjs ./my-plane.json
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const inPath = resolve(process.argv[2] ?? '');
const outPath = resolve(__dirname, '../src/features/dashboard/constants/demoPlane.snapshot.json');

if (!inPath || inPath === resolve('.')) {
  console.error('用法: node scripts/import-demo-plane-snapshot.mjs <plane.json>');
  process.exit(1);
}

const raw = readFileSync(inPath, 'utf8');
const parsed = JSON.parse(raw);
const plane = Array.isArray(parsed)
  ? (parsed.find((p) => p.id === 'demo-plane') ?? parsed[0])
  : parsed.plane ?? parsed;

if (!plane?.elements?.length) {
  console.error('無效的平面 JSON（缺少 elements）');
  process.exit(1);
}

const now = Date.now();
plane.id = 'demo-plane';
plane.demoLayoutVersion = Math.max(plane.demoLayoutVersion ?? 0, 110);
plane.createdAt = plane.createdAt ?? now;
plane.updatedAt = now;

writeFileSync(outPath, JSON.stringify(plane, null, 2), 'utf8');
console.log(`已寫入 ${outPath}（${plane.elements.length} 個畫布）`);

if (parsed.dataSources?.length) {
  const dsOut = resolve(__dirname, '../public/dashboard-templates/syncdrive-master-dashboard-3840x1080.json');
  writeFileSync(dsOut, JSON.stringify(parsed, null, 2), 'utf8');
  console.log(`已同步樣板檔 ${dsOut}`);
}
