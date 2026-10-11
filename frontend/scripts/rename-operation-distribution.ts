/**
 * 把資料庫裡版面保存的「車輛分佈」元件（統計營運中／整備中／待命中、綁 /facility/vehicle-distribution）
 * 改名為「營運分佈」（規則見 src/features/dashboard/utils/operationDistribution.ts）。
 *
 * 只改名稱，綁定、位置、尺寸不動；可以重複執行。經後端版面儲存 API 寫回（帶 expectedVersion），寫之前備份。
 *
 * 用法（frontend 目錄）：
 *   npx tsx scripts/rename-operation-distribution.ts            只預覽
 *   npx tsx scripts/rename-operation-distribution.ts --apply    寫回
 * 後端位址預設 http://127.0.0.1:3000，可用 BACKEND_URL 指定。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renameOperationDistributions } from '../src/features/dashboard/utils/operationDistribution.ts';
import type { DashboardPlane } from '../src/features/dashboard/types.ts';

const base = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000';
const apply = process.argv.includes('--apply');

type StoredPlane = { planeId: string; name: string; width: number; height: number; viewportMode: string; elements: unknown[]; version: number; isTemplate: boolean };
const planes = (await (await fetch(`${base}/syncdrive-api/dashboard/planes`)).json()) as StoredPlane[];
let pending = 0;
for (const stored of planes) {
  const plane = { id: stored.planeId, name: stored.name, elements: stored.elements } as unknown as DashboardPlane;
  const result = renameOperationDistributions(plane);
  if (result.upgraded.length === 0) continue;
  console.log(`版面「${stored.name}」（${stored.planeId}，第 ${stored.version} 版）：「車輛分佈」改名為「營運分佈」 ${result.upgraded.join('、')}`);
  pending += result.upgraded.length;
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
      updatedBy: 'rename-operation-distribution',
    }),
  });
  const saved = await response.json();
  if (!response.ok) throw new Error(`寫回失敗：${JSON.stringify(saved).slice(0, 300)}`);
  console.log(`  已寫回，現在是第 ${saved.version} 版；原內容備份在 ${backup}`);
}
if (pending === 0) console.log('沒有需要改名的「車輛分佈」元件');
else if (!apply) console.log(`\n共 ${pending} 個元件可改名；確認後加 --apply 寫回`);
