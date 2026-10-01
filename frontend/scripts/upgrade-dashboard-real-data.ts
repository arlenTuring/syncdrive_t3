/**
 * 只升級資料庫裡已知的假營運狀態文案；先備份，再逐份 upsert，不呼叫全量覆寫 API。
 * 可重複執行：只匹配舊的精確值，第二次不會再修改。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CanvasElementProps, ChildWidget } from '../src/features/dashboard/types.ts';
import { mapAllChildArrays } from '../src/features/dashboard/template/childArrayVariants.ts';

const apiBase = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const response = await fetch(`${apiBase}/syncdrive-api/dashboard/planes`);
if (!response.ok) throw new Error(`讀取畫布失敗：HTTP ${response.status}`);
const planes = await response.json() as Array<{
  planeId: string; name: string; width: number; height: number; viewportMode?: string;
  elements: CanvasElementProps[]; isTemplate?: boolean;
}>;

const backupDir = resolve('artifacts/dashboard-backups');
mkdirSync(backupDir, { recursive: true });
const backupPath = resolve(backupDir, `before-real-data-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(backupPath, `${JSON.stringify(planes, null, 2)}\n`);

let changedPlanes = 0;
let changedWidgets = 0;
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
  if (!planeChanged) continue;
  const save = await fetch(`${apiBase}/syncdrive-api/dashboard/planes/${encodeURIComponent(plane.planeId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...plane, elements }),
  });
  if (!save.ok) throw new Error(`更新畫布 ${plane.planeId} 失敗：HTTP ${save.status}`);
  changedPlanes += 1;
}

console.log(JSON.stringify({ backupPath, changedPlanes, changedWidgets }, null, 2));
