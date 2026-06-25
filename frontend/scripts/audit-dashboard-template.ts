/**
 * 稽核儀表板樣板／快照：未知欄位、群組子範本完整性、綁定覆蓋率
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { CanvasElementProps, ChildWidget, DashboardPlane } from '../src/features/dashboard/types.ts';
import { parseTemplateFile } from '../src/features/dashboard/template/importTemplate.ts';
import { getAllGroupChildWidgets } from '../src/features/dashboard/template/bindingHealth.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const input = process.argv[2]
  ?? resolve(__dirname, '../src/features/dashboard/constants/demoPlane.snapshot.json');

const raw = readFileSync(input, 'utf8');
const json = JSON.parse(raw);
const plane: DashboardPlane = json.plane
  ? ({
    id: 'demo-plane',
    ...json.plane,
    createdAt: json.plane.createdAt ?? Date.now(),
    updatedAt: json.plane.updatedAt ?? Date.now(),
  } as DashboardPlane)
  : (json as DashboardPlane);

// 允許的 canvas / widget 欄位（types.ts 定義 + 執行期慣用欄位）
const CANVAS_KEYS = new Set([
  'id', 'type', 'x', 'y', 'width', 'height', 'label', 'backgroundColor', 'backgroundImage',
  'opacity', 'children', 'childrenDefault', 'childrenNormal', 'canvasKind', 'mapId', 'mapScale',
  'dataSourceId', 'sqlQuery', 'dataUrl', 'refreshInterval', 'variableName', 'iteratorField',
  'groupRepeatMode', 'groupPresentation', 'groupScrollInterval', 'layoutMode', 'gridColumns',
  'gapX', 'gapY', 'xField', 'yField', 'slotCount', 'slotKeyField', 'groupSlotAssignment',
  'groupTransition', 'groupTileFit', 'groupTileAlign', 'groupTilePadding', 'groupTilePadX',
  'groupTilePadY', 'templateHideChrome', 'templateWidth', 'templateHeight', 'groupVariableMode',
  'dualCanvasEnabled', 'displayGate', 'groupTileScaleMode',
]);

const WIDGET_BASE_KEYS = new Set([
  'id', 'type', 'x', 'y', 'width', 'height',
]);

const WIDGET_TYPE_KEYS: Record<string, Set<string>> = {
  text: new Set(['content', 'fontSize', 'lineHeight', 'fontFamily', 'fontWeight', 'color', 'textAlign',
    'borderRadius', 'borderWidth', 'borderColor', 'backgroundColor', 'icon', 'iconImage', 'textWrap',
    'contentPadding', 'colorRulesEnabled', 'colorRules', 'colorField', 'dataSourceId', 'sqlQuery',
    'valueField', 'mqttDataSourceId', 'mqttTopic', 'mqttValuePath', 'refreshInterval', 'dataUrl',
    'severityTextColor', 'labelUppercase']),
  'stat-card': new Set(['label', 'valueField', 'unit', 'valueFontSize', 'labelFontSize', 'valueColor',
    'labelColor', 'unitColor', 'valueFontWeight', 'contentAlign', 'labelPosition', 'layoutGap',
    'dataSourceId', 'sqlQuery', 'refreshInterval', 'dataUrl', 'mqttDataSourceId', 'mqttTopic',
    'mqttValuePath', 'summarySql', 'borderRadius', 'backgroundColor']),
  'alert-banner': new Set(['content', 'fontSize', 'fontWeight', 'fontFamily', 'textWrap', 'borderRadius',
    'icon', 'iconImage', 'dataSourceId', 'sqlQuery', 'refreshInterval', 'mqttDataSourceId', 'mqttTopic',
    'mqttValuePath', 'triggerConditions', 'alertPresentation', 'carouselIntervalMs', 'triggerField',
    'triggerMode', 'triggerValue']),
  gauge: new Set(['valueField', 'unit', 'min', 'max', 'variant', 'mqttDataSourceId', 'mqttTopic',
    'mqttValuePath', 'dataSourceId', 'sqlQuery', 'refreshInterval', 'fontSize', 'labelFontSize']),
  'color-block': new Set(['backgroundColor', 'borderRadius', 'opacity', 'dataSourceId', 'sqlQuery',
    'mqttDataSourceId', 'mqttTopic', 'mqttValuePath', 'refreshInterval']),
  'progress-bar': new Set(['valueField', 'max', 'barColor', 'trackColor', 'dataSourceId', 'sqlQuery',
    'refreshInterval', 'mqttDataSourceId', 'mqttTopic', 'mqttValuePath']),
  'line-chart': new Set(['valueField', 'labelField', 'dataSourceId', 'sqlQuery', 'refreshInterval',
    'lineColor', 'fillColor', 'showGrid', 'showDots', 'yMin', 'yMax', 'mqttDataSourceId', 'mqttTopic']),
  'route-progress': new Set(['dataSourceId', 'sqlQuery', 'refreshInterval', 'mqttDataSourceId', 'mqttTopic',
    'mqttValuePath', 'actionRules', 'showVehicleCode', 'segmentBarEnabled']),
  'segment-bar': new Set(['stationsField', 'segmentIndexField', 'remainPctField', 'dataSourceId', 'sqlQuery',
    'refreshInterval', 'mqttDataSourceId', 'mqttTopic']),
  'slot-grid': new Set(['dataSourceId', 'sqlQuery', 'refreshInterval', 'slotRules', 'columns', 'rows',
    'gap', 'cellHeight']),
  clock: new Set(['format', 'showDate', 'showSeconds', 'fontSize', 'dateFontSize', 'color', 'dateColor', 'fontFamily']),
  'status-badge': new Set(['defaultLabel', 'defaultBgColor', 'defaultTextColor', 'fontSize', 'borderRadius',
    'showDot', 'dataSourceId', 'sqlQuery', 'valueField', 'colorRules', 'colorRulesEnabled']),
  'empty-state': new Set(['message', 'icon', 'iconImage', 'fontSize', 'color']),
};

function allowedKeys(type: string): Set<string> {
  const specific = WIDGET_TYPE_KEYS[type];
  if (!specific) return new Set([...WIDGET_BASE_KEYS, 'dataSourceId', 'sqlQuery', 'refreshInterval']);
  return new Set([...WIDGET_BASE_KEYS, ...specific]);
}

const unknownKeys: { path: string; key: string }[] = [];
const missingDual: string[] = [];
const widgetTypes = new Map<string, number>();

function auditCanvas(el: CanvasElementProps, path: string) {
  for (const k of Object.keys(el)) {
    if (!CANVAS_KEYS.has(k)) unknownKeys.push({ path, key: k });
  }
  if (el.dualCanvasEnabled) {
    if (!(el.childrenDefault?.length)) missingDual.push(`${path}: 缺少 childrenDefault`);
    if (!(el.childrenNormal?.length)) missingDual.push(`${path}: 缺少 childrenNormal`);
  }
  for (const w of getAllGroupChildWidgets(el)) auditWidget(w, `${path}/${w.type}:${w.id}`);
  for (const w of el.children ?? []) auditWidget(w, `${path}/${w.type}:${w.id}`);
}

function auditWidget(w: ChildWidget, path: string) {
  widgetTypes.set(w.type, (widgetTypes.get(w.type) ?? 0) + 1);
  const allowed = allowedKeys(w.type);
  for (const k of Object.keys(w)) {
    if (!allowed.has(k)) unknownKeys.push({ path, key: k });
  }
}

console.log(`稽核：${input}`);
console.log(`  平面：${plane.width}×${plane.height}，畫布 ${plane.elements.length} 個`);

for (const el of plane.elements) auditCanvas(el, el.label ?? el.id);

console.log('\n元件類型統計：');
for (const [t, n] of [...widgetTypes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t}: ${n}`);
}

if (missingDual.length) {
  console.log('\n⚠ 雙畫板群組問題：');
  missingDual.forEach((m) => console.log(`  ${m}`));
}

if (unknownKeys.length) {
  console.log(`\n⚠ 未在型別白名單的欄位（${unknownKeys.length} 筆，可能仍可儲存）：`);
  const grouped = new Map<string, number>();
  for (const { key } of unknownKeys) grouped.set(key, (grouped.get(key) ?? 0) + 1);
  for (const [k, n] of [...grouped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`  ${k}: ${n}`);
  }
} else {
  console.log('\n✓ 所有欄位均在已知型別白名單內');
}

// 樣板格式驗證
if (json.kind === 'syncdrive-dashboard-template') {
  parseTemplateFile(json);
  console.log('\n✓ syncdrive-dashboard-template 格式有效');
}

console.log('\n稽核完成');
