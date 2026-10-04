/**
 * 訂單的業務分類（全系統一份）。
 *
 * line_kind 表示這張單「在做什麼」：載客正線 MAINLINE、空車過渡（出入廠、轉場、待命、暫停）
 * TRANSITION、作業整備（充電、保養、洗車、行檢…）MAINTENANCE。「誰下的單」（正式調度、
 * 模擬器重播、人工測試）放在 payload.source，不混進分類。
 *
 * 規則照任務的結構化用途判斷（kind＋原任務子類型），不看卡片文字或班次名稱。
 * 注意 kind='maintenance' 也包含待命、暫停這類不做作業的區塊——那些是過渡，不是整備。
 *
 * 儀表板 SQL 用同一套規則（frontend demoSql.ts 的 ORDER_BUSINESS_KIND_SQL），兩邊要一起改。
 */

export type BusinessLineKind = 'MAINLINE' | 'TRANSITION' | 'MAINTENANCE';

/** 不做作業、只是停著或移動的任務子類型 */
export const TRANSITION_TASK_TYPES: ReadonlySet<string> = new Set([
  'dispatch',
  'standby',
  'idle',
]);

/** 任務用途 → 業務分類。子類型不明（空字串）時回 null，由呼叫端決定，不猜。 */
export function classifyTask(
  kind: string | null | undefined,
  taskType: string | null | undefined,
): BusinessLineKind | null {
  const k = String(kind ?? '').trim();
  const t = String(taskType ?? '').trim();
  if (k === 'passenger' || t === 'passenger') return 'MAINLINE';
  if (k === 'movement' || TRANSITION_TASK_TYPES.has(t)) return 'TRANSITION';
  if (k === 'maintenance' && t) return 'MAINTENANCE';
  return null;
}

/**
 * 既有訂單的業務分類。
 *
 * - line_kind 已是三種之一：照它。
 * - 舊版模擬器重播單（line_kind='TEST' 且 payload.source='plan_replay'）：當時把分類寫成 TEST，
 *   這裡用單上保留的 kind 與整備子類型換算（有限相容）；子類型不明就回 null，不猜。
 * - 其他 TEST（PMS99 人工測試等）：回 'TEST'，不算任何業務分類。
 * - 沒有 line_kind：依 payload 的 task_type／kind 換算（舊資料）。
 */
export function orderBusinessKind(order: {
  lineKind?: string | null;
  payload?: Record<string, unknown> | null;
}): BusinessLineKind | 'TEST' | null {
  const lineKind = String(order.lineKind ?? '').toUpperCase();
  if (
    lineKind === 'MAINLINE' ||
    lineKind === 'TRANSITION' ||
    lineKind === 'MAINTENANCE'
  )
    return lineKind;
  const payload = order.payload ?? {};
  const kind = typeof payload.kind === 'string' ? payload.kind : null;
  // 整備子類型比 task_type 具體（舊版整備單的 task_type 一律是 'maintenance'）
  const taskType =
    typeof payload.maintenance_task_type === 'string' &&
    payload.maintenance_task_type
      ? payload.maintenance_task_type
      : typeof payload.task_type === 'string' && payload.task_type
        ? payload.task_type
        : null;
  if (lineKind === 'TEST') {
    return payload.source === 'plan_replay'
      ? classifyTask(kind, taskType)
      : 'TEST';
  }
  if (!lineKind) return classifyTask(kind, taskType);
  return null;
}

/**
 * 同一套規則的 SQL 版本（{@link orderBusinessKind}）；儀表板的 ORDER_BUSINESS_KIND_SQL 是同一段，
 * 兩邊要一起改。不看 trip_code。
 */
export function orderBusinessKindSql(o: string): string {
  // 整備子類型比 task_type 具體（舊版整備單的 task_type 一律是 'maintenance'）
  const taskType = `COALESCE(NULLIF(${o}.payload->>'maintenance_task_type', ''), NULLIF(${o}.payload->>'task_type', ''))`;
  return `CASE
      WHEN ${o}.line_kind IN ('MAINLINE', 'TRANSITION', 'MAINTENANCE') THEN ${o}.line_kind
      WHEN COALESCE(${o}.line_kind, '') = ''
        OR (${o}.line_kind = 'TEST' AND ${o}.payload->>'source' = 'plan_replay') THEN
        CASE
          WHEN ${o}.payload->>'kind' = 'passenger' OR ${taskType} = 'passenger' THEN 'MAINLINE'
          WHEN ${o}.payload->>'kind' = 'movement' OR ${taskType} IN ('dispatch', 'standby', 'idle') THEN 'TRANSITION'
          WHEN ${o}.payload->>'kind' = 'maintenance' AND ${taskType} IS NOT NULL THEN 'MAINTENANCE'
        END
      WHEN ${o}.line_kind = 'TEST' THEN 'TEST'
    END`;
}
