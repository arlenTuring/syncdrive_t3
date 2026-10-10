/**
 * 把資料庫裡版面保存的運能趨勢圖（line-chart，/operation-metrics/capacity-trend）升級：
 * X 軸改用帶日期的營運時間戳、色帶取時間模板時段顏色、關閉每筆資料的小圓點、顯示資料問題
 * （規則見 src/features/dashboard/utils/capacityTrendChart.ts）。
 *
 * 只升級 X 軸還是 time 的舊設定；可以重複執行。元件 ID、位置、尺寸與其他元素不動。
 * 經後端正式的版面儲存 API 寫回（帶 expectedVersion，別人剛存過就失敗、不覆蓋），寫之前備份。
 *
 * 用法（frontend 目錄）：
 *   npx tsx scripts/upgrade-capacity-trend-chart.ts            只預覽
 *   npx tsx scripts/upgrade-capacity-trend-chart.ts --apply    寫回
 * 後端位址預設 http://127.0.0.1:3000，可用 BACKEND_URL 指定。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { upgradeCapacityTrendCharts } from '../src/features/dashboard/utils/capacityTrendChart.ts';
import type { DashboardPlane } from '../src/features/dashboard/types.ts';

const base = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000';
const apply = process.argv.includes('--apply');

type StoredPlane = { planeId: string; name: string; width: number; height: number; viewportMode: string; elements: unknown[]; version: number; isTemplate: boolean };
const planes = (await (await fetch(`${base}/syncdrive-api/dashboard/planes`)).json()) as StoredPlane[];
let pending = 0;
for (const stored of planes) {
  const plane = { id: stored.planeId, name: stored.name, elements: stored.elements } as unknown as DashboardPlane;
  const result = upgradeCapacityTrendCharts(plane);
  if (result.upgraded.length === 0) continue;
  console.log(`版面「${stored.name}」（${stored.planeId}，第 ${stored.version} 版）：升級運能趨勢圖 ${result.upgraded.join('、')}`);
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
      updatedBy: 'upgrade-capacity-trend-chart',
    }),
  });
  const saved = await response.json();
  if (!response.ok) throw new Error(`寫回失敗：${JSON.stringify(saved).slice(0, 300)}`);
  console.log(`  已寫回，現在是第 ${saved.version} 版；原內容備份在 ${backup}`);
}
if (pending === 0) console.log('沒有需要升級的舊版運能趨勢圖');
else if (!apply) console.log(`\n共 ${pending} 個圖表可升級；確認後加 --apply 寫回`);
