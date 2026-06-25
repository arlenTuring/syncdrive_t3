/**
 * 驗證 demoPlane.snapshot.json 能否完整還原儀表板圖台
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { CanvasElementProps, ChildWidget, DashboardPlane } from '../src/features/dashboard/types.ts';
import { collectBindingIssues, getAllGroupChildWidgets } from '../src/features/dashboard/template/bindingHealth.ts';
import { cloneDemoPlane } from '../src/features/dashboard/constants/demoPlane.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const snapshotPath = resolve(__dirname, '../src/features/dashboard/constants/demoPlane.snapshot.json');

const WIDGET_TYPES = new Set([
  'text', 'image', 'color-block', 'clock', 'empty-state', 'alert-banner', 'stat-card',
  'progress-bar', 'line-chart', 'route-progress', 'unit-telemetry-card', 'map-canvas',
  'status-badge', 'event-log', 'segment-bar', 'slot-grid', 'gauge', 'data-table',
  'vehicle-container',
]);

const CORE_LABELS = ['事件中心', '班次中心', '運能趨勢', '即時圖台'];
const DATA_GROUPS = ['車輛狀態', '車輛分佈', '整備分佈', '事件輪播', '正線班次', '整備班表'];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function walkWidgets(plane: DashboardPlane, fn: (w: ChildWidget, canvas: CanvasElementProps) => void) {
  for (const el of plane.elements) {
    for (const w of getAllGroupChildWidgets(el)) fn(w, el);
    for (const w of el.children ?? []) fn(w, el);
  }
}

const raw = readFileSync(snapshotPath, 'utf8');
const snapshot = JSON.parse(raw) as DashboardPlane;
const cloned = cloneDemoPlane();

assert(snapshot.id === 'demo-plane', 'snapshot id 應為 demo-plane');
assert(typeof snapshot.createdAt === 'number', 'snapshot 缺少 createdAt');
assert(typeof snapshot.updatedAt === 'number', 'snapshot 缺少 updatedAt');
assert(snapshot.width === 3840 && snapshot.height === 1080, '平面尺寸應為 3840×1080');
assert(Array.isArray(snapshot.elements) && snapshot.elements.length >= 8, 'elements 數量不足');

const labels = new Set(snapshot.elements.map((e) => e.label ?? ''));
for (const l of CORE_LABELS) assert(labels.has(l), `缺少核心畫布：${l}`);

for (const g of DATA_GROUPS) {
  const el = snapshot.elements.find((e) => e.label === g);
  if (!el) continue;
  assert((getAllGroupChildWidgets(el).length > 0) || (el.children?.length ?? 0) > 0, `群組「${g}」無子範本`);
}

let unknownTypes = 0;
const seenWidgetIds = new Set<string>();
walkWidgets(snapshot, (w) => {
  if (seenWidgetIds.has(w.id)) return;
  seenWidgetIds.add(w.id);
  if (!WIDGET_TYPES.has(w.type)) unknownTypes++;
});
assert(unknownTypes === 0, `發現 ${unknownTypes} 個未知 widget type`);

const issues = collectBindingIssues(snapshot);
const hardIssues = issues.filter((i) =>
  i.reasons.some((r) => r !== 'connection_failed'),
);
assert(hardIssues.length === 0, `靜態綁定問題 ${hardIssues.length} 筆：${hardIssues[0]?.detail}`);

// 雙畫板群組：childrenNormal / childrenDefault 應存在於事件輪播
const eventScroll = snapshot.elements.find((e) => e.label === '事件輪播');
if (eventScroll?.dualCanvasEnabled) {
  assert((eventScroll.childrenDefault?.length ?? 0) > 0, '事件輪播缺少 childrenDefault');
  assert((eventScroll.childrenNormal?.length ?? 0) > 0, '事件輪播缺少 childrenNormal');
}

// round-trip：cloneDemoPlane 應與 snapshot 結構一致
const rejson = JSON.stringify(cloned);
const snapjson = JSON.stringify(snapshot);
assert(rejson === snapjson, 'cloneDemoPlane() 與 snapshot 不一致（還原後會漂移）');

console.log('validate-demo-plane-snapshot: OK');
console.log(`  elements: ${snapshot.elements.length}`);
console.log(`  widgets: ${snapshot.elements.reduce((n, e) => n + getAllGroupChildWidgets(e).length + (e.children?.length ?? 0), 0)}`);
console.log(`  demoLayoutVersion: ${snapshot.demoLayoutVersion}`);
