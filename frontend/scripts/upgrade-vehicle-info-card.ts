/**
 * 把資料庫裡版面保存的「車輛狀態」群組樣板（總控大屏最下方每台車一張的卡片）從舊版半圓儀表
 * 升級成新版車輛資訊卡（utils/vehicleInfoCardTemplate.ts）。
 *
 * 只升級舊版樣板：已經有八方向障礙元件的視為新版（可能已被使用者再調整），不動；可以重複執行。
 * 群組 ID、資料來源、查詢、排序、外部位置與尺寸不動，其他元素一律不動。
 * 經後端正式的版面儲存 API 寫回（帶 expectedVersion，別人剛存過就失敗、不覆蓋），
 * 寫之前把原本的版面備份成 JSON。
 *
 * 用法（frontend 目錄）：
 *   npx tsx scripts/upgrade-vehicle-info-card.ts            只預覽
 *   npx tsx scripts/upgrade-vehicle-info-card.ts --apply    寫回
 * 後端位址預設 http://127.0.0.1:3000，可用 BACKEND_URL 指定。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { upgradeVehicleCardTemplate } from '../src/features/dashboard/utils/vehicleInfoCardTemplate.ts';
import type { DashboardPlane } from '../src/features/dashboard/types.ts';

const base = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000';
const apply = process.argv.includes('--apply');

type StoredPlane = { planeId: string; name: string; width: number; height: number; viewportMode: string; elements: unknown[]; version: number; isTemplate: boolean };
const planes = (await (await fetch(`${base}/syncdrive-api/dashboard/planes`)).json()) as StoredPlane[];
let pending = 0;
for (const stored of planes) {
  const plane = { id: stored.planeId, name: stored.name, elements: stored.elements } as unknown as DashboardPlane;
  const result = upgradeVehicleCardTemplate(plane);
  if (result.upgraded.length === 0) continue;
  console.log(`版面「${stored.name}」（${stored.planeId}，第 ${stored.version} 版）：升級車輛卡片群組 ${result.upgraded.join('、')}`);
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
      updatedBy: 'upgrade-vehicle-info-card',
    }),
  });
  const saved = await response.json();
  if (!response.ok) throw new Error(`寫回失敗：${JSON.stringify(saved).slice(0, 300)}`);
  console.log(`  已寫回，現在是第 ${saved.version} 版；原內容備份在 ${backup}`);
}
if (pending === 0) console.log('沒有需要升級的舊版車輛卡片');
else if (!apply) console.log(`\n共 ${pending} 個群組可升級；確認後加 --apply 寫回`);
