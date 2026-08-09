import type { TaskTypeKey } from '../../time-templates/types/editor';
import { isPositiveInteger } from '../../maintenance-tasks/utils/numericInput';

function parsePositiveMinutesString(raw: string | undefined): number | null {
  if (!raw || !isPositiveInteger(raw)) return null;
  return Number.parseInt(raw, 10) * 60;
}

/**
 * 從整備任務 body 解析各模板任務類型的預估占用秒數（不含路線行駛）。
 *
 * 回傳 null → expand 改用時間模板橫條時長。
 *
 * 行檢／充電／保養：班表占用以模板橫條為準。整備任務裡的「單次作業時長」
 * 僅供任務說明；不可拿來把橫條尾巴砍短（正線讓渡餘裕只可吃「下一段整備開頭」）。
 *
 * 待命：預設跟模板（durationFollowTemplate !== false）；僅手動關閉跟隨時才用作業時長。
 */
export function resolveMaintenanceOccupancySeconds(
  taskType: TaskTypeKey,
  maintenanceBody: Record<string, unknown> | null | undefined,
): number | null {
  if (!maintenanceBody) return null;

  if (taskType === 'inspection') {
    // 一律跟時間模板橫條；勿用 operationDurationMinutes 覆蓋班表長度
    return null;
  }

  if (taskType === 'standby') {
    const mobile =
      maintenanceBody.mobile && typeof maintenanceBody.mobile === 'object'
        ? (maintenanceBody.mobile as Record<string, unknown>)
        : null;
    if (!mobile || mobile.stepEnabled === false) return null;
    if (mobile.durationFollowTemplate !== false) return null;
    return parsePositiveMinutesString(
      typeof mobile.operationDurationMinutes === 'string'
        ? mobile.operationDurationMinutes
        : undefined,
    );
  }

  if (taskType === 'charging' || taskType === 'servicing' || taskType === 'passenger') {
    return null;
  }

  return null;
}
