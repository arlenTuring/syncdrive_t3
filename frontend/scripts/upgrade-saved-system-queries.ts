/**
 * 把資料庫裡版面保存的「系統內建查詢」升級成目前版本（demoSql.ts）。
 *
 * 只換跟系統某一版原文一字不差的 SQL（utils/systemQueries.ts 的完整指紋判斷）；使用者改過的
 * 一律不動、只列出位置。經後端正式的版面儲存 API 寫回（帶 expectedVersion，別人剛存過就失敗、
 * 不覆蓋），寫之前把原本的 elements 備份成 JSON。
 *
 * 用法（frontend 目錄）：
 *   npx tsx scripts/upgrade-saved-system-queries.ts            只預覽
 *   npx tsx scripts/upgrade-saved-system-queries.ts --apply    寫回
 * 後端位址預設 http://127.0.0.1:3000，可用 BACKEND_URL 指定。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { upgradeSystemQueries } from '../src/features/dashboard/utils/systemQueries.ts';
import type { DashboardPlane } from '../src/features/dashboard/types.ts';

const base = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000';
const apply = process.argv.includes('--apply');

type StoredPlane = { planeId: string; name: string; width: number; height: number; viewportMode: string; elements: unknown[]; version: number; isTemplate: boolean };
const planes = (await (await fetch(`${base}/syncdrive-api/dashboard/planes`)).json()) as StoredPlane[];
let pending = 0;
for (const stored of planes) {
  const plane = { id: stored.planeId, name: stored.name, elements: stored.elements } as unknown as DashboardPlane;
  const result = upgradeSystemQueries(plane);
  console.log(`版面「${stored.name}」（${stored.planeId}，第 ${stored.version} 版）：可升級 ${result.changes.length} 處，對不上不動 ${result.unconfirmed.length} 處`);
  for (const change of result.changes) console.log(`  ↑ ${change.family}（原為 ${change.fromVersion}）｜${change.location}`);
  for (const item of result.unconfirmed) console.log(`  ? ${item.family}｜${item.location}`);
  if (result.changes.length === 0) continue;
  pending += result.changes.length;
  if (!apply) continue;
  const backupDir = resolve(import.meta.dirname, '../../backend/logs/dashboard-plane-backups');
  mkdirSync(backupDir, { recursive: true });
  const backup = resolve(backupDir, `${stored.planeId}.v${stored.version}.${Date.now()}.json`);
  writeFileSync(backup, JSON.stringify(stored, null, 1));
  const response = await fetch(`${base}/syncdrive-api/dashboard/planes/${encodeURIComponent(stored.planeId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: stored.name,
      width: stored.width,
      height: stored.height,
      viewportMode: stored.viewportMode,
      isTemplate: stored.isTemplate,
      elements: result.plane.elements,
      expectedVersion: stored.version,
      updatedBy: 'upgrade-saved-system-queries',
    }),
  });
  const saved = await response.json();
  if (!response.ok) throw new Error(`寫回失敗：${JSON.stringify(saved).slice(0, 300)}`);
  console.log(`  已寫回，現在是第 ${saved.version} 版；原內容備份在 ${backup}`);
}
if (!apply && pending > 0) console.log(`\n共 ${pending} 處可升級；確認後加 --apply 寫回`);
