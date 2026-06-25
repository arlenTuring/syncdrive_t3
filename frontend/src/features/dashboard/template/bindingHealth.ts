import type { CanvasElementProps, DashboardPlane, ChildWidget } from '../types';
import type { WidgetDataBinding } from '../types';
import {
  getDataSourceById,
  isDataSourceAllowedForBinding,
} from '../store/useDataSourceStore';

export type BindingIssueReason =
  | 'missing_data_source'
  | 'missing_mqtt_source'
  | 'sql_without_source'
  | 'connection_failed'
  | 'config_mismatch';

export interface BindingIssue {
  refId: string;
  refLabel: string;
  kind: 'canvas' | 'widget' | 'datasource';
  canvasId?: string;
  reasons: BindingIssueReason[];
  detail: string;
  /** 連線失敗時受影響的綁定數量 */
  affectedCount?: number;
}

function needsSqlSource(w: WidgetDataBinding): boolean {
  return !!(w.sqlQuery?.trim() || (w as { summarySql?: string }).summarySql);
}

function checkDataSourceId(
  id: string | undefined,
  kind: 'sql' | 'mqtt',
  reasons: BindingIssueReason[],
  detailParts: string[],
): void {
  if (!id) return;
  const ds = getDataSourceById(id);
  if (!ds) {
    reasons.push(kind === 'mqtt' ? 'missing_mqtt_source' : 'missing_data_source');
    detailParts.push(`找不到${kind === 'mqtt' ? ' MQTT ' : ''}資料來源「${id}」`);
    return;
  }
  if (!isDataSourceAllowedForBinding(id, kind)) {
    reasons.push('config_mismatch');
    detailParts.push(
      kind === 'sql'
        ? `「${id}」不是 SQL 類型，請在數據綁定 → SQL 分頁改選`
        : `「${id}」不是 MQTT 類型，請在數據綁定 → MQTT 分頁改選`,
    );
  }
}

function issuesFromBinding(
  refId: string,
  refLabel: string,
  kind: 'canvas' | 'widget',
  binding: WidgetDataBinding,
  canvasId?: string,
): BindingIssue | null {
  const reasons: BindingIssueReason[] = [];
  const detailParts: string[] = [];

  if (needsSqlSource(binding) && !binding.dataSourceId && !binding.dataUrl) {
    reasons.push('sql_without_source');
    detailParts.push('已設定 SQL 但未指定資料來源');
  }

  checkDataSourceId(binding.dataSourceId, 'sql', reasons, detailParts);

  if (binding.mqttTopic || binding.mqttDataSourceId) {
    if (!binding.mqttDataSourceId) {
      reasons.push('missing_mqtt_source');
      detailParts.push('已設定 MQTT 主題但未指定 MQTT 資料來源');
    } else {
      checkDataSourceId(binding.mqttDataSourceId, 'mqtt', reasons, detailParts);
    }
  }

  if (reasons.length === 0) return null;

  return {
    refId,
    refLabel,
    kind,
    canvasId,
    reasons,
    detail: detailParts.join('；') || '資料連線異常',
  };
}

/** 合併 children / childrenNormal / childrenDefault（雙畫板群組） */
export function getAllGroupChildWidgets(el: CanvasElementProps): ChildWidget[] {
  const lists = [el.children, el.childrenNormal, el.childrenDefault].filter(
    (c): c is ChildWidget[] => !!c?.length,
  );
  const seen = new Set<string>();
  const out: ChildWidget[] = [];
  for (const list of lists) {
    for (const child of list) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
    }
  }
  return out;
}

function collectSourceIdsFromPlane(plane: DashboardPlane): Set<string> {
  const sourceIds = new Set<string>();
  for (const el of plane.elements) {
    if (el.dataSourceId) sourceIds.add(el.dataSourceId);
    if (el.displayGate?.dataSourceId) sourceIds.add(el.displayGate.dataSourceId);
    for (const child of getAllGroupChildWidgets(el)) {
      const w = child as ChildWidget & WidgetDataBinding;
      if (w.dataSourceId) sourceIds.add(w.dataSourceId);
      if (w.mqttDataSourceId) sourceIds.add(w.mqttDataSourceId);
    }
  }
  return sourceIds;
}

function countBindingsForSource(plane: DashboardPlane, sourceId: string): number {
  let n = 0;
  for (const el of plane.elements) {
    const canvasRefs = [el.dataSourceId, el.displayGate?.dataSourceId];
    if (canvasRefs.includes(sourceId)) n++;
    for (const child of getAllGroupChildWidgets(el)) {
      const w = child as ChildWidget & WidgetDataBinding;
      if (w.dataSourceId === sourceId || w.mqttDataSourceId === sourceId) n++;
    }
  }
  return n;
}

/** 掃描平面內所有資料綁定，回傳靜態問題（不含連線測試） */
export function collectBindingIssues(plane: DashboardPlane): BindingIssue[] {
  const issues: BindingIssue[] = [];

  for (const el of plane.elements) {
    const canvasBinding: WidgetDataBinding = {
      dataSourceId: el.dataSourceId,
      sqlQuery: el.sqlQuery,
      dataUrl: el.dataUrl,
      refreshInterval: el.refreshInterval,
    };
    const canvasIssue = issuesFromBinding(el.id, el.label || '畫布', 'canvas', canvasBinding);
    if (canvasIssue) issues.push(canvasIssue);

    if (el.displayGate?.dataSourceId || el.displayGate?.sqlQuery) {
      const gateIssue = issuesFromBinding(
        `${el.id}-gate`,
        `${el.label || '畫布'} / 顯示閘門`,
        'widget',
        {
          dataSourceId: el.displayGate.dataSourceId ?? el.dataSourceId,
          sqlQuery: el.displayGate.sqlQuery,
          refreshInterval: el.displayGate.refreshInterval,
        },
        el.id,
      );
      if (gateIssue) issues.push(gateIssue);
    }

    for (const child of getAllGroupChildWidgets(el)) {
      const w = child as ChildWidget & WidgetDataBinding;
      const label = `${el.label} / ${w.type}`;
      const childIssue = issuesFromBinding(w.id, label, 'widget', w, el.id);
      if (childIssue) issues.push(childIssue);
    }
  }

  return issues;
}

export function countBindingIssues(plane: DashboardPlane): BindingIssue[] {
  return collectBindingIssues(plane);
}

export async function pingDataSourceById(id: string, timeoutMs = 5_000): Promise<boolean> {
  const ds = getDataSourceById(id);
  if (!ds) return false;
  if (ds.type === 'internal' || ds.type === 'mqtt') {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${ds.backendUrl}/syncdrive-api/datasource/ping`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const body = await res.json();
      return !!body.ok;
    } catch {
      return false;
    }
  }
  return true;
}

/** 對平面引用的資料來源執行連線測試；連線失敗合併為每來源一則（避免 57 則重複） */
export async function collectBindingIssuesWithPing(
  plane: DashboardPlane,
): Promise<BindingIssue[]> {
  const base = collectBindingIssues(plane);
  const sourceIds = collectSourceIdsFromPlane(plane);

  const pingResults = new Map<string, boolean>();
  await Promise.all(
    [...sourceIds].map(async id => {
      pingResults.set(id, await pingDataSourceById(id));
    }),
  );

  const failedIds = [...pingResults.entries()].filter(([, ok]) => !ok).map(([id]) => id);
  if (failedIds.length === 0) return base;

  const connectionIssues: BindingIssue[] = failedIds.map(id => {
    const ds = getDataSourceById(id);
    const affected = countBindingsForSource(plane, id);
    return {
      refId: `datasource-${id}`,
      refLabel: ds?.name ?? id,
      kind: 'datasource',
      reasons: ['connection_failed'],
      detail: `無法連線至後端（影響 ${affected} 處綁定）`,
      affectedCount: affected,
    };
  });

  return [...base, ...connectionIssues];
}

export function issuesByRefId(issues: BindingIssue[]): Map<string, BindingIssue> {
  return new Map(issues.map(i => [i.refId, i]));
}

/** 顯示用：合併連線失敗訊息 */
export function summarizeBindingIssues(issues: BindingIssue[]): {
  displayLabel: string;
  tooltip: string;
} {
  const conn = issues.filter(i => i.reasons.includes('connection_failed'));
  const other = issues.filter(i => !i.reasons.includes('connection_failed'));

  if (conn.length > 0 && other.length === 0) {
    const totalAffected = conn.reduce((s, i) => s + (i.affectedCount ?? 1), 0);
    return {
      displayLabel: conn.length === 1
        ? `後端無法連線（${totalAffected} 處綁定）`
        : `${conn.length} 個資料來源無法連線`,
      tooltip: conn.map(i => `${i.refLabel}: ${i.detail}`).join('\n'),
    };
  }

  return {
    displayLabel: `${issues.length} 處資料連線異常`,
    tooltip: issues.map(i => `${i.refLabel}: ${i.detail}`).join('\n'),
  };
}
