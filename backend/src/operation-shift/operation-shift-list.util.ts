import {
  OperationShift,
  OperationShiftPublishStatus,
  OperationShiftUsageStatus,
} from '../database/entities/operation-shift.entity';

import { buildPlanFingerprint as bundledPlanFingerprint } from './safety/schedule-safety.generated';
import { buildSafetySettingsFingerprint } from './safety/schedule-safety';

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
  blocked: '禁止發布',
  ready: '可發布',
};

/**
 * plan 內容指紋。與前端 buildPlanFingerprint() 是同一份程式（安全檢查打包檔），
 * 不在後端另寫一份——兩份遲早對不起來，清單就會永遠顯示未檢查或誤判可發布。
 */
export const buildPlanFingerprint = bundledPlanFingerprint as (
  plan: unknown,
) => string;

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
  // 路線停靠、碰撞保護等設定改了（或舊紀錄沒記設定），舊結論不能沿用
  const settings = buildSafetySettingsFingerprint({
    selectedRoutes: Array.isArray(body?.selectedRoutes)
      ? body.selectedRoutes
      : [],
    collisionProtectionSeconds:
      typeof body?.collisionProtectionSeconds === 'number'
        ? body.collisionProtectionSeconds
        : null,
    sectionCodes: body?.maintenanceSectionCodeBySection,
  });
  if (
    typeof c.settingsFingerprint !== 'string' ||
    c.settingsFingerprint !== settings
  )
    return 'unchecked';
  return c.publishSafe && c.publishBlockingCount === 0 ? 'ready' : 'blocked';
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
  /**
   * 排班結果的製作時間（ISO）。自動生成取 scheduleOutput.generatedAt，其次
   * scheduleOutput.plan.generatedAt；舊資料沒有記錄就是 null（畫面顯示「未記錄」），
   * 不拿現在時間或最後儲存時間補。最後儲存時間是 updated_at，兩者分開。
   */
  generated_at: string | null;
  /** generated_at 取自哪個欄位；null＝未記錄 */
  generated_at_source:
    | 'scheduleOutput.generatedAt'
    | 'scheduleOutput.plan.generatedAt'
    | null;
  /** 這個時間的正確稱呼：自動生成的是「生成時間」，手動班表是「建立排班結構時間」 */
  generated_at_label: string;
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

/** 排班結果的製作時間；兩處都沒有就是 null，不補造 */
export function readScheduleGeneratedAt(body: Record<string, unknown>): {
  at: string | null;
  source: OperationShiftListItem['generated_at_source'];
} {
  const output = body.scheduleOutput;
  if (!output || typeof output !== 'object') return { at: null, source: null };
  const outer = (output as Record<string, unknown>).generatedAt;
  if (typeof outer === 'string' && !Number.isNaN(Date.parse(outer))) {
    return {
      at: new Date(outer).toISOString(),
      source: 'scheduleOutput.generatedAt',
    };
  }
  const plan = (output as Record<string, unknown>).plan;
  const inner =
    plan && typeof plan === 'object'
      ? (plan as Record<string, unknown>).generatedAt
      : undefined;
  if (typeof inner === 'string' && !Number.isNaN(Date.parse(inner))) {
    return {
      at: new Date(inner).toISOString(),
      source: 'scheduleOutput.plan.generatedAt',
    };
  }
  return { at: null, source: null };
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
  const generated = readScheduleGeneratedAt(body);

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
    generated_at: generated.at,
    generated_at_source: generated.source,
    generated_at_label:
      creationMode === 'manual' ? '建立排班結構時間' : '生成時間',
  };
}
