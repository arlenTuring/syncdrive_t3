import {
  OperationShift,
  OperationShiftPublishStatus,
  OperationShiftUsageStatus,
} from '../database/entities/operation-shift.entity';

export const UNTITLED_OPERATION_SHIFT_NAME = '未完成的正線班表';

/**
 * 發布前檢查狀態。班表可以手動改，所以「生成當下的檢查」不算數：
 * 指紋對不上就代表檢查之後又被改過，一律回 unchecked。
 * 前端 `schedulePublishCheck.ts` 是同一套規則，兩邊都要能算，
 * 因為清單只拿得到 body、拿不到前端的執行期狀態。
 */
export type OperationShiftPublishCheckState = 'unchecked' | 'blocked' | 'ready';

export const OPERATION_SHIFT_PUBLISH_CHECK_LABEL: Record<
  OperationShiftPublishCheckState,
  string
> = {
  unchecked: '未檢查',
  blocked: '不建議發布',
  ready: '可發布',
};

/**
 * plan 內容指紋：列、卡 id、起訖時刻。
 * 必須與前端 buildPlanFingerprint() 完全一致，否則清單會永遠顯示未檢查。
 */
function buildPlanFingerprint(plan: unknown): string {
  if (!plan || typeof plan !== 'object') return '';
  const timelines = (plan as { timelines?: unknown }).timelines;
  if (!Array.isArray(timelines)) return '';
  const parts: string[] = [];
  for (const timeline of timelines) {
    if (!timeline || typeof timeline !== 'object') continue;
    const row = (timeline as { row?: unknown }).row;
    const blocks = (timeline as { blocks?: unknown }).blocks;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      parts.push(
        `${String(row)}|${String(b.id)}|${String(b.plannedStartMinute)}|${String(b.plannedEndMinute)}`,
      );
    }
  }
  parts.sort();
  return parts.join('\n');
}

export function resolveOperationShiftPublishCheckState(
  body: Record<string, unknown> | null | undefined,
): OperationShiftPublishCheckState {
  const output = body?.scheduleOutput;
  if (!output || typeof output !== 'object') return 'unchecked';
  const o = output as Record<string, unknown>;
  const check = o.publishCheck;
  if (!check || typeof check !== 'object') return 'unchecked';
  const c = check as Record<string, unknown>;
  if (
    typeof c.planFingerprint !== 'string' ||
    typeof c.publishSafe !== 'boolean'
  ) {
    return 'unchecked';
  }
  if (c.planFingerprint !== buildPlanFingerprint(o.plan)) return 'unchecked';
  return c.publishSafe ? 'ready' : 'blocked';
}

export type OperationShiftListItem = {
  shift_id: string;
  name: string;
  time_template_name: string;
  version: string;
  /** 建立方式：參數生成 / 手動製作 */
  creation_mode: 'parametric' | 'manual';
  creation_mode_label: string;
  publish_status: OperationShiftPublishStatus;
  publish_status_label: string;
  usage_status: OperationShiftUsageStatus;
  usage_status_label: string;
  /** 發布前檢查狀態（站位重疊／碰撞保護）；與 publish_status 是兩件事 */
  publish_check_state: OperationShiftPublishCheckState;
  publish_check_label: string;
  created_at: string;
  updated_at: string;
};

export function formatOperationShiftTimestamp(
  ms: string | number | null | undefined,
): string {
  if (ms == null || ms === '') return '—';
  const n = Number(ms);
  if (!Number.isFinite(n)) return '—';
  const d = new Date(n);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${day} ${hh}:${mm}`;
}

export function operationShiftUsageStatusLabel(
  status: OperationShiftUsageStatus,
): string {
  return status === OperationShiftUsageStatus.IN_USE ? '使用中' : '閒置中';
}

export function operationShiftPublishStatusLabel(
  status: OperationShiftPublishStatus,
): string {
  return status === OperationShiftPublishStatus.PUBLISHED ? '已發布' : '草稿區';
}

export function operationShiftCreationModeLabel(
  mode: 'parametric' | 'manual',
): string {
  return mode === 'manual' ? '手動製作' : '參數生成';
}

function readBodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readCreationMode(
  body: Record<string, unknown>,
): 'parametric' | 'manual' {
  return body.creationMode === 'manual' ? 'manual' : 'parametric';
}

export function toOperationShiftListItem(
  row: OperationShift,
): OperationShiftListItem {
  const body = row.body ?? {};
  const timeTemplateName =
    readBodyString(body, 'timeTemplateName') ||
    readBodyString(body, 'time_template_name');
  const version = readBodyString(body, 'version');
  const creationMode = readCreationMode(body);
  const publishCheckState = resolveOperationShiftPublishCheckState(body);

  return {
    shift_id: row.id,
    name: row.name,
    time_template_name: timeTemplateName || '—',
    version: version || '—',
    creation_mode: creationMode,
    creation_mode_label: operationShiftCreationModeLabel(creationMode),
    publish_status: row.publishStatus,
    publish_status_label: operationShiftPublishStatusLabel(row.publishStatus),
    usage_status: row.usageStatus,
    usage_status_label: operationShiftUsageStatusLabel(row.usageStatus),
    publish_check_state: publishCheckState,
    publish_check_label: OPERATION_SHIFT_PUBLISH_CHECK_LABEL[publishCheckState],
    created_at: formatOperationShiftTimestamp(row.createdAt),
    updated_at: formatOperationShiftTimestamp(row.updatedAt),
  };
}
