/**
 * 儀表板全元件資料來源盤點。
 *
 * 用法：
 *   npx tsx scripts/dashboard-data-lineage-report.ts            # 內建版面（載入時會跑的升級一併套用）
 *   npx tsx scripts/dashboard-data-lineage-report.ts plane.json # 從資料庫匯出的版面（單一平面或平面陣列）
 *
 * 每個元件一列：在哪個畫布、什麼元件、資料從哪裡來（自己的 SQL／REST／MQTT，或群組列欄位）、
 * 讀哪些欄位。判斷跟屬性面板「資料來源」卡同一支函式（describeWidgetDataLineage）。
 */
import { readFileSync } from 'node:fs';
import { cloneDemoPlane } from '../src/features/dashboard/constants/demoPlane.ts';
import { migratePlane } from '../src/features/dashboard/utils/migrateDashboardPlane.ts';
import { describeWidgetDataLineage, type LineageSource } from '../src/features/dashboard/utils/widgetDataLineage.ts';
import type { CanvasElementProps, ChildWidget, DashboardPlane } from '../src/features/dashboard/types.ts';

function loadPlanes(): DashboardPlane[] {
  const file = process.argv[2];
  if (!file) return [cloneDemoPlane()];
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as DashboardPlane | DashboardPlane[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function sourceText(source: LineageSource): string {
  const target = source.kind === 'sql'
    ? `${source.target.replace(/\s+/g, ' ').slice(0, 48)}…`
    : source.target;
  const path = source.path ? ` → ${source.path}` : '';
  const post = source.postProcessId ? ` ＋${source.postProcessId}` : '';
  return `${source.kind.toUpperCase()} ${target}${path}${post}`;
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

const STATUS_LABEL = {
  own: '自己綁定',
  'group-row': '群組列欄位',
  'own+group-row': '自己綁定＋群組列',
  static: '⚠ 沒有資料來源（寫死）',
  label: '固定標題文字',
  decorative: '樣式（不顯示資料）',
} as const;

for (const raw of loadPlanes()) {
  const plane = migratePlane(raw);
  console.log(`\n## ${plane.name}\n`);
  console.log('| 畫布 | 元件 | 狀態 | 資料來源 | 讀的欄位 | 問題 |');
  console.log('|---|---|---|---|---|---|');
  const counts: Record<string, number> = {};
  const emit = (canvas: string, widget: ChildWidget, group: CanvasElementProps | null) => {
    const lineage = describeWidgetDataLineage(widget, group);
    counts[lineage.status] = (counts[lineage.status] ?? 0) + 1;
    if (lineage.status === 'decorative' || lineage.status === 'label') return;
    const sources = [
      ...lineage.own.map(sourceText),
      ...(lineage.group ? lineage.group.sources.map((source) => `群組：${sourceText(source)}`) : []),
    ];
    const name = (widget as { label?: string }).label
      || (widget as { title?: string }).title
      || (widget as { content?: string }).content
      || '';
    console.log(`| ${cell(canvas)} | ${widget.type} ${cell(String(name).slice(0, 24))} | ${STATUS_LABEL[lineage.status]} | ${cell(sources.join('<br>') || lineage.staticText || '—')} | ${lineage.fields.map((field) => field.derivedFrom ? `${field.name}*` : field.name).join(', ') || '—'} | ${cell(lineage.problems.join('；') || '')} |`);
  };
  for (const element of plane.elements) {
    const isGroup = !!element.isGroup;
    const templates = element.genericGroup?.enabled ? element.genericGroup.templates ?? [] : [];
    if (templates.length > 0) {
      for (const template of templates) {
        for (const child of template.children) emit(`${element.label} · 樣板 ${template.name}`, child, element);
      }
    } else {
      for (const child of element.children ?? []) emit(element.label, child, isGroup ? element : null);
    }
  }
  console.log(`\n統計：${Object.entries(counts).map(([status, n]) => `${STATUS_LABEL[status as keyof typeof STATUS_LABEL]} ${n}`).join('、')}`);
  console.log('欄位後面有 * 的：執行時會被車端即時 MQTT 覆寫（規則見屬性面板資料來源卡）。');
}
