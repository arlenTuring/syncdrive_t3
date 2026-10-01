/**
 * 儀表板全元件資料來源盤點。
 *
 * 用法：
 *   npx tsx scripts/dashboard-data-lineage-report.ts --api http://127.0.0.1:3000
 *   npx tsx scripts/dashboard-data-lineage-report.ts --demo      # 明確盤點內建範例
 *   npx tsx scripts/dashboard-data-lineage-report.ts plane.json  # 匯出的單一平面或平面陣列
 *
 * 每個元件一列：在哪個畫布、什麼元件、資料從哪裡來（自己的 SQL／REST／MQTT，或群組列欄位）、
 * 讀哪些欄位。判斷跟屬性面板「資料來源」卡同一支函式（describeWidgetDataLineage）。
 */
import { readFileSync } from 'node:fs';
import { cloneDemoPlane } from '../src/features/dashboard/constants/demoPlane.ts';
import { migratePlane } from '../src/features/dashboard/utils/migrateDashboardPlane.ts';
import { describeWidgetDataLineage, type LineageSource } from '../src/features/dashboard/utils/widgetDataLineage.ts';
import type { CanvasElementProps, ChildWidget, DashboardPlane } from '../src/features/dashboard/types.ts';
import { collectAllChildArrays } from '../src/features/dashboard/template/childArrayVariants.ts';

const arg = process.argv[2];
const apiBase = arg === '--api' ? (process.argv[3] ?? 'http://127.0.0.1:3000') : null;

async function loadPlanes(): Promise<DashboardPlane[]> {
  if (!arg) throw new Error('請指定資料庫 API：--api http://127.0.0.1:3000，或明確使用 --demo');
  if (arg === '--demo') return [cloneDemoPlane()];
  if (apiBase) {
    const res = await fetch(`${apiBase}/syncdrive-api/dashboard/planes`);
    if (!res.ok) throw new Error(`讀取資料庫畫布失敗：HTTP ${res.status}`);
    const rows = await res.json() as Array<DashboardPlane & { planeId?: string }>;
    return rows.map((row) => ({ ...row, id: row.planeId ?? row.id }));
  }
  const file = arg;
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

const healthCache = new Map<string, Promise<string>>();
function sourceHealth(source: LineageSource): Promise<string> {
  const key = `${source.kind}:${source.target}`;
  const existing = healthCache.get(key);
  if (existing) return existing;
  const promise = (async () => {
    if (!apiBase) return '未連線檢查';
    if (source.kind === 'mqtt') return '即時串流（未取快照）';
    if (source.kind === 'sql' && /\$?\{[A-Za-z_][A-Za-z0-9_]*\}/.test(source.target)) {
      return '執行時查詢（需群組列代入）';
    }
    try {
      const res = source.kind === 'sql'
        ? await fetch(`${apiBase}/syncdrive-api/datasource/query`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: source.target, limit: 1 }),
          })
        : await fetch(source.target.startsWith('/') ? `${apiBase}${source.target}` : source.target);
      if (!res.ok) return `失敗 HTTP ${res.status}`;
      const body = await res.json() as { rowCount?: number; rows?: unknown[]; data?: unknown[] } | unknown[];
      const count = Array.isArray(body)
        ? body.length
        : (body.rowCount ?? body.rows?.length ?? body.data?.length ?? 1);
      return count > 0 ? `有資料（${count}）` : '查詢成功但沒有資料';
    } catch (error) {
      return `失敗：${error instanceof Error ? error.message : String(error)}`;
    }
  })();
  healthCache.set(key, promise);
  return promise;
}

const STATUS_LABEL = {
  own: '自己綁定',
  'group-row': '群組列欄位',
  'own+group-row': '自己綁定＋群組列',
  static: '⚠ 沒有資料來源（寫死）',
  label: '固定標題文字',
  decorative: '樣式（不顯示資料）',
} as const;

for (const raw of await loadPlanes()) {
  const plane = migratePlane(raw);
  console.log(`\n## ${plane.name}\n`);
  console.log('| 畫布 | 元件 | 狀態 | 資料來源 | 資料狀態 | 讀的欄位 | 問題 |');
  console.log('|---|---|---|---|---|---|---|');
  const counts: Record<string, number> = {};
  const seen = new Set<string>();
  const emit = async (canvas: string, widget: ChildWidget, group: CanvasElementProps | null) => {
    if (seen.has(widget.id)) return;
    seen.add(widget.id);
    const lineage = describeWidgetDataLineage(widget, group);
    counts[lineage.status] = (counts[lineage.status] ?? 0) + 1;
    if (lineage.status === 'decorative' || lineage.status === 'label') return;
    const sources = [
      ...lineage.own.map(sourceText),
      ...(lineage.group ? lineage.group.sources.map((source) => `群組：${sourceText(source)}`) : []),
    ];
    const healthSources = [...lineage.own, ...(lineage.group?.sources ?? [])];
    const health = await Promise.all(healthSources.map(sourceHealth));
    const name = (widget as { label?: string }).label
      || (widget as { title?: string }).title
      || (widget as { content?: string }).content
      || '';
    console.log(`| ${cell(canvas)} | ${widget.type} ${cell(String(name).slice(0, 24))} (${widget.id}) | ${STATUS_LABEL[lineage.status]} | ${cell(sources.join('<br>') || lineage.staticText || '—')} | ${cell([...new Set(health)].join('<br>') || '不需要')} | ${lineage.fields.map((field) => field.derivedFrom ? `${field.name}*` : field.name).join(', ') || '—'} | ${cell(lineage.problems.join('；') || '')} |`);
  };
  for (const element of plane.elements) {
    const isGroup = !!element.isGroup;
    const arrays = collectAllChildArrays(element);
    for (let index = 0; index < arrays.length; index += 1) {
      for (const child of arrays[index]) await emit(`${element.label} (${element.id}) · 子畫板 ${index + 1}`, child, isGroup ? element : null);
    }
  }
  console.log(`\n統計：${Object.entries(counts).map(([status, n]) => `${STATUS_LABEL[status as keyof typeof STATUS_LABEL]} ${n}`).join('、')}`);
  console.log('欄位後面有 * 的：執行時會被車端即時 MQTT 覆寫（規則見屬性面板資料來源卡）。');
}
