import type { TaskTypeKey } from '../../time-templates/types/editor';
import {
  extractFacilityMapCodes,
  resolvePreferredExitStationId,
  resolveExitStationIdsForFacilityCodes,
  resolveServicingExitStationIds,
  type MaintenanceFirstTripOrigin,
} from './maintenanceFirstTripOrigins';

/**
 * 整備結束後接正線的策略（對齊排班引擎規則 §八）：
 *
 * | 任務類型 | 出場 | 輪替相位 | 進場載客（偷尾巴） |
 * |---------|------|---------|-------------------|
 * | 行前 inspection | preTrip 設施→停靠 | 對齊出場站起點路線* | 否 |
 * | 充電 charging | charging 設施→停靠 | 僅單一出場站時對齊* | 否 |
 * | 機動 standby | mobile 設施→停靠 | 僅單一出場站時對齊* | 否 |
 * | 保養 servicing | maintenance+carWash 設施 | 否（由進場載客接手） | 是（最壞出場交路） |
 *
 * *出場／相位對齊只在「該列之後還有正線模板視窗」時套用。
 * 純機動、沒有正線時不強制為出場站去跑某方向（例如 TN→N2W）。
 * 機動可派正線同樣僅限「該機動開始後仍有正線視窗」的列。
 */

/** 模板列是否在此分鐘（含）之後還有正線視窗 */
export function rowHasPassengerTemplateAtOrAfter(
  tasks: ReadonlyArray<{
    rowIndex: number;
    taskType: string;
    startMinute: number;
  }>,
  row: number,
  atOrAfterMinute: number,
): boolean {
  return tasks.some(
    (task) =>
      task.rowIndex === row
      && task.taskType === 'passenger'
      && task.startMinute >= atOrAfterMinute - 1e-9,
  );
}

/**
 * 機動可否當正線派車窗：該列在機動開始後仍須有正線模板。
 * （純機動列＝備援待命，不強制跑出場交路。）
 */
export function isStandbyDispatchableForMainline(
  tasks: ReadonlyArray<{
    rowIndex: number;
    taskType: string;
    startMinute: number;
  }>,
  standby: { rowIndex: number; startMinute: number },
): boolean {
  return rowHasPassengerTemplateAtOrAfter(
    tasks,
    standby.rowIndex,
    standby.startMinute,
  );
}

/**
 * 整備出場相位對齊是否啟用：拓樸有出場站，且該列在整備結束後仍有正線。
 */
export function shouldApplyYardExitRotationAlign(args: {
  exitStationId: string | null | undefined;
  templateTasks: ReadonlyArray<{
    rowIndex: number;
    taskType: string;
    startMinute: number;
  }>;
  row: number;
  yardEndMinute: number;
}): boolean {
  if (!args.exitStationId?.trim()) return false;
  return rowHasPassengerTemplateAtOrAfter(
    args.templateTasks,
    args.row,
    args.yardEndMinute,
  );
}

export type YardPostTaskPolicy = {
  /** 結束後輪替相位應對齊的出場站（null＝維持執行順序第 0 條） */
  rotationExitStationId: string | null;
  /** 是否允許在此任務尾端插入進場載客 */
  allowEntryService: boolean;
  /** 進場載客可用的出場站集合（allowEntryService 時有意義） */
  entryServiceExitStationIds: string[];
};

const EMPTY_POLICY: YardPostTaskPolicy = {
  rotationExitStationId: null,
  allowEntryService: false,
  entryServiceExitStationIds: [],
};

function resolveUniqueExitStationId(
  origins: MaintenanceFirstTripOrigin[],
  codes: string[],
): string | null {
  const stations = resolveExitStationIdsForFacilityCodes(origins, codes);
  return stations.length === 1 ? stations[0]! : null;
}

/**
 * 依模板任務類型與整備 body／拓樸，決定「整備結束後怎麼接正線」。
 */
export function resolveYardPostTaskPolicy(args: {
  taskType: TaskTypeKey | string;
  origins: MaintenanceFirstTripOrigin[];
  maintenanceBody: Record<string, unknown> | null | undefined;
}): YardPostTaskPolicy {
  const { taskType, origins, maintenanceBody } = args;
  if (origins.length === 0) return EMPTY_POLICY;

  if (taskType === 'inspection') {
    return {
      rotationExitStationId: resolvePreferredExitStationId(
        origins,
        extractFacilityMapCodes(maintenanceBody, 'preTrip'),
      ),
      allowEntryService: false,
      entryServiceExitStationIds: [],
    };
  }

  if (taskType === 'charging') {
    return {
      rotationExitStationId: resolveUniqueExitStationId(
        origins,
        extractFacilityMapCodes(maintenanceBody, 'charging'),
      ),
      allowEntryService: false,
      entryServiceExitStationIds: [],
    };
  }

  if (taskType === 'standby') {
    return {
      rotationExitStationId: resolveUniqueExitStationId(
        origins,
        extractFacilityMapCodes(maintenanceBody, 'mobile'),
      ),
      allowEntryService: false,
      entryServiceExitStationIds: [],
    };
  }

  if (taskType === 'servicing') {
    return {
      rotationExitStationId: null,
      allowEntryService: true,
      entryServiceExitStationIds: resolveServicingExitStationIds(
        origins,
        maintenanceBody,
      ),
    };
  }

  return EMPTY_POLICY;
}

/**
 * 建立「任務類型 → 輪替出場站」對照，供掛車／指派／週期補完共用。
 * 僅含有明確出場站的類型。
 */
export function buildYardRotationExitByTaskType(args: {
  origins: MaintenanceFirstTripOrigin[];
  maintenanceBody: Record<string, unknown> | null | undefined;
}): Partial<Record<TaskTypeKey, string>> {
  const map: Partial<Record<TaskTypeKey, string>> = {};
  for (const taskType of ['inspection', 'charging', 'standby'] as const) {
    const policy = resolveYardPostTaskPolicy({
      taskType,
      origins: args.origins,
      maintenanceBody: args.maintenanceBody,
    });
    if (policy.rotationExitStationId) {
      map[taskType] = policy.rotationExitStationId;
    }
  }
  return map;
}
