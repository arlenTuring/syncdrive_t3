import { SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS } from './schedule-engine/physics';

/**
 * 整備的「作業」與「等待」
 * ======================
 *
 * 充電、保養、行檢、洗車是<strong>作業</strong>：車到了設施要真的做事。使用者的規則
 * （白皮書 YARD-03、YARD-07）：
 *
 * - 作業不能被壓成零，也不能靠刪卡假裝做完。
 * - 提早到設施只能<strong>等待</strong>，不能因此提早開始或提早做完；等待期間仍佔著格位。
 * - 整備尾巴沒有授權，不能為了出場移動而截短。
 *
 * 待命不是作業：它本身就是「車停著等」，提早到或提早走不影響任何工作量，所以不套用上面三條。
 */
export const WORK_YARD_TASK_TYPES: ReadonlySet<string> = new Set([
  'charging',
  'servicing',
  'inspection',
  'washing',
]);

export function isWorkYardTaskType(taskType: string): boolean {
  return WORK_YARD_TASK_TYPES.has(taskType);
}

/**
 * 整備設定裡使用者填的作業時長（秒）；沒有設定回 0。
 * 行檢、洗車讀各自的作業時長；保養取各保養項目中最長的一項；充電、待命沒有這個欄位。
 */
export function configuredYardWorkSeconds(
  taskType: string,
  maintenanceBody: Record<string, unknown> | null | undefined,
): number {
  const body = (maintenanceBody ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const minutes = (value: unknown) => {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed * 60 : 0;
  };
  if (taskType === 'inspection') return minutes(body.preTrip?.operationDurationMinutes);
  if (taskType === 'washing') return minutes(body.carWash?.operationDurationMinutes);
  if (taskType === 'servicing') {
    const conditions = body.maintenance?.cycleConditions;
    return Array.isArray(conditions)
      ? Math.max(0, ...conditions.map((item) => minutes((item as { durationMinutes?: unknown }).durationMinutes)))
      : 0;
  }
  return 0;
}

/**
 * 被正線讓渡、被移動占用之後，整備至少要留下的工作時間（秒）。
 *
 * 有設定作業時長就用它；沒有的（充電）至少留一個排班刻度——這只是「不能歸零」的最小表示，
 * 不代表一個刻度就夠充電（白皮書 YARD-05，最低有效工作時間仍待使用者決定）。
 */
export function minimumYardWorkSeconds(
  taskType: string,
  maintenanceBody: Record<string, unknown> | null | undefined,
): number {
  return Math.max(configuredYardWorkSeconds(taskType, maintenanceBody), SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS);
}

/**
 * 整備不能歸零的硬下限（秒）：一個排班刻度，只表示「不是零」。
 *
 * 使用者 2026-09-30：泛用平台的時間模板本來就不會替整備間的移動留時間，移動可以佔用後一段作業的
 * 開頭，工作時間可以低於設定的作業時長（逐筆揭露），但不能是零。所以移動卡（入廠、轉場、出廠）
 * 與最終驗證用這個下限；正線讓渡（手填 H、長整備一輪）仍用 {@link minimumYardWorkSeconds}。
 */
export function nonZeroYardWorkSeconds(): number {
  return SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS;
}
