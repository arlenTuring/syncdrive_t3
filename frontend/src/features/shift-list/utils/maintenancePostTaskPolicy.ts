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
 * | 行前 inspection | preTrip 設施→停靠 | 對齊出場站起點路線 | 否 |
 * | 充電 charging | charging 設施→停靠 | 僅單一出場站時對齊 | 否 |
 * | 機動 standby | mobile 設施→停靠 | 僅單一出場站時對齊 | 否 |
 * | 保養 servicing | maintenance+carWash 設施 | 否（由進場載客接手） | 是（最壞出場交路） |
 */

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
