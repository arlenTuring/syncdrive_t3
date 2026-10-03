/**
 * 升級資料庫裡已存的儀表板：先備份，再逐份 upsert（帶版本做樂觀鎖），不呼叫全量覆寫 API。
 *
 * 1. 已知的假營運狀態文案（精確值比對）。
 * 2. 系統內建查詢的舊版原文（含泛用群組 genericGroup.sources[] 內部來源）：指紋跟系統某一版
 *    一字不差才換成目前版本；像系統查詢但對不上的（可能是使用者改過）只列出位置，不動。
 *
 * 可重複執行：第二次 changedPlanes=0。
 * 用法：npx tsx scripts/upgrade-dashboard-real-data.ts [http://127.0.0.1:3000] [--dry-run]
 *
 * 部署機的內部 API 在 nginx 帳密後面：設環境變數 DASHBOARD_API_AUTH="帳號:密碼" 就會帶上
 * Basic 認證（deploy/git-sync.sh 會自動從 VM 的 deploy/.env 讀出來帶，不寫進任何檔案）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CanvasElementProps, ChildWidget } from '../src/features/dashboard/types.ts';
import { mapAllChildArrays } from '../src/features/dashboard/template/childArrayVariants.ts';
import { upgradeSystemQueries } from '../src/features/dashboard/utils/systemQueries.ts';
import type { DashboardPlane } from '../src/features/dashboard/types.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const apiBase = (args.find((arg) => !arg.startsWith('--')) ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const basicAuth = process.env.DASHBOARD_API_AUTH
  ? { Authorization: `Basic ${Buffer.from(process.env.DASHBOARD_API_AUTH).toString('base64')}` }
  : {};
const response = await fetch(`${apiBase}/syncdrive-api/dashboard/planes`, { headers: basicAuth });
if (response.status === 401) {
  throw new Error('讀取畫布失敗：HTTP 401，這個位址需要帳密。請設定 DASHBOARD_API_AUTH="帳號:密碼"（git-sync.sh 會自動帶）');
}
if (!response.ok) throw new Error(`讀取畫布失敗：HTTP ${response.status}`);
const planes = await response.json() as Array<{
  planeId: string; name: string; width: number; height: number; viewportMode?: string;
  elements: CanvasElementProps[]; isTemplate?: boolean; version?: number;
}>;

const backupDir = resolve('artifacts/dashboard-backups');
mkdirSync(backupDir, { recursive: true });
const backupPath = resolve(backupDir, `before-real-data-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(backupPath, `${JSON.stringify(planes, null, 2)}\n`);

let changedPlanes = 0;
let changedWidgets = 0;
let changedQueries = 0;
let unconfirmedQueries = 0;
for (const plane of planes) {
  let planeChanged = false;
  const elements = plane.elements.map((element) => mapAllChildArrays(element, (children) => children.map((child) => {
    const badge = child as ChildWidget & { defaultLabel?: string; defaultBgColor?: string; defaultTextColor?: string; showDot?: boolean };
    if (badge.type !== 'status-badge' || badge.defaultLabel !== '正常營運中 Level 1') return child;
    planeChanged = true;
    changedWidgets += 1;
    return {
      ...badge,
      defaultLabel: '尚未設定（營運狀態來源）',
      defaultBgColor: '#27272a',
      defaultTextColor: '#a1a1aa',
      showDot: false,
    } as ChildWidget;
  })));
  const queries = upgradeSystemQueries({
    id: plane.planeId, name: plane.name, width: plane.width, height: plane.height, elements, createdAt: 0, updatedAt: 0,
  } as DashboardPlane);
  for (const change of queries.changes) console.log(`更新系統查詢：${change.location}（${change.family}，原為 ${change.fromVersion} 版）`);
  for (const item of queries.unconfirmed) console.log(`未更新（像${item.family}但無法確認是系統原文，請人工確認）：${item.location}`);
  changedQueries += queries.changes.length;
  unconfirmedQueries += queries.unconfirmed.length;
  if (!planeChanged && queries.changes.length === 0) continue;
  if (dryRun) { changedPlanes += 1; continue; }
  const save = await fetch(`${apiBase}/syncdrive-api/dashboard/planes/${encodeURIComponent(plane.planeId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...basicAuth },
    body: JSON.stringify({ ...plane, elements: queries.plane.elements, expectedVersion: plane.version ?? null }),
  });
  if (!save.ok) throw new Error(`更新畫布 ${plane.planeId} 失敗：HTTP ${save.status}`);
  changedPlanes += 1;
}

console.log(JSON.stringify({ backupPath, dryRun, changedPlanes, changedWidgets, changedQueries, unconfirmedQueries }, null, 2));
