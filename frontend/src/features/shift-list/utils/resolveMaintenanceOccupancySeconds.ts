import type { TaskTypeKey } from '../../time-templates/types/editor';
import { isPositiveInteger } from '../../maintenance-tasks/utils/numericInput';

function parsePositiveMinutesString(raw: string | undefined): number | null {
  if (!raw || !isPositiveInteger(raw)) return null;
  return Number.parseInt(raw, 10) * 60;
}

/** 從整備任務 body 解析各模板任務類型的預估占用秒數（不含路線行駛）。 */
export function resolveMaintenanceOccupancySeconds(
  taskType: TaskTypeKey,
  maintenanceBody: Record<string, unknown> | null | undefined,
): number | null {
  if (!maintenanceBody) return null;

  if (taskType === 'inspection') {
    const preTrip =
      maintenanceBody.preTrip && typeof maintenanceBody.preTrip === 'object'
        ? (maintenanceBody.preTrip as Record<string, unknown>)
        : null;
    if (!preTrip || preTrip.stepEnabled === false) return null;
    return parsePositiveMinutesString(
      typeof preTrip.operationDurationMinutes === 'string'
        ? preTrip.operationDurationMinutes
        : undefined,
    );
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
