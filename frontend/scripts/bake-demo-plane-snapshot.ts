/**
 * ⚠️ 請勿用此腳本覆寫使用者調整過的內建版面。
 *
 * demoPlane.snapshot.json 的版面來源應為使用者匯出樣板：
 *   node scripts/promote-user-dashboard-template.mjs <template.json>
 *
 * 此腳本僅在「刻意從 demoPlane.ts 程式建構子重建」時使用（開發／除錯）。
 */
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildDemoPlaneFromCode } from '../src/features/dashboard/constants/demoPlane.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '../src/features/dashboard/constants/demoPlane.snapshot.json');

console.warn(
  '警告：此腳本會以 demoPlane.ts 程式版面覆寫 snapshot，可能與使用者設計稿不同。',
);
console.warn('若要保留設計稿版面，請改用 promote-user-dashboard-template.mjs');

const plane = buildDemoPlaneFromCode();
plane.id = 'demo-plane';
plane.updatedAt = Date.now();

writeFileSync(outPath, JSON.stringify(plane, null, 2), 'utf8');
console.log(`baked ${outPath}`);
console.log(`  elements: ${plane.elements.length}, version: ${plane.demoLayoutVersion ?? '?'}`);
