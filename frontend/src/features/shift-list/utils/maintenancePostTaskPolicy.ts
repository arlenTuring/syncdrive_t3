import type { TaskTypeKey } from '../../time-templates/types/editor';
import {
  extractFacilityMapCodes,
  resolvePreferredExitStationId,
  resolveExitStationIdsForFacilityCodes,
  resolveServicingExitStationIds,
  type MaintenanceFirstTripOrigin,
} from './maintenanceFirstTripOrigins';

/**
 * 整備結束後接正線的策略（對齊排班引擎規則 §八／§十一）：
 *
 * | 任務類型 | 出場 | 輪替相位 | 整備後調度營運班次 |
 * |---------|------|---------|-------------------|
 * | 行前 inspection | preTrip 設施→停靠 | 對齊出場站起點路線* | 有，代號 P |
 * | 充電 charging | charging 設施→停靠 | 僅單一出場站時對齊* | 無 |
 * | 機動 standby | mobile 設施→停靠 | 僅單一出場站時對齊* | 無 |
 * | 保養 servicing | maintenance+carWash 設施→停靠 | **對齊出場站**（例 M 系→T3→TN）* | 有，代號 M |
 *
 * 調度營運班次一律在整備<strong>結束之後</strong>才發車（不得佔用整備尾巴），
 * 且不受同方向班距約束；只受站位淨空限制。詳見文件 §10。
 *
 * *出場／相位對齊只在「該列之後還有正線模板視窗」時套用。
 * 純機動、沒有正線時不強制為出場站去跑某方向（例如 TN→N2W）。
 * 機動可派正線同樣僅限「該機動開始後仍有正線視窗」的列。
 *
 * 泛用禁令：保養／行前／充電／機動連成一串整備時，串內不得掛任何正線卡；
 * 只有整備完成後「下一個模板就是正線」才允許調度／進場載客／正線脈衝。
 */

const YARD_TASK_TYPES = new Set([
  'charging',
  'servicing',
  'inspection',
  'standby',
]);

export function isYardTemplateTaskType(taskType: string): boolean {
  return YARD_TASK_TYPES.has(taskType);
}

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
 * 若 atMinute 落在同列一串相接的整備內（或卡在銜接點），回傳該串結束分鐘；
 * 否則 null。例：保養 02:00–09:30 + 行前 09:30–10:00 → at 09:30 得 10:00。
 */
export function resolveContiguousYardBusyUntilMinute(
  tasks: ReadonlyArray<{
    rowIndex: number;
    taskType: string;
    startMinute: number;
    durationMinutes: number;
  }>,
  row: number,
  atMinute: number,
): number | null {
  const yards = tasks
    .filter(
      (task) =>
        task.rowIndex === row
        && isYardTemplateTaskType(task.taskType)
        && task.durationMinutes > 1e-9,
    )
    .map((task) => ({
      start: task.startMinute,
      end: task.startMinute + task.durationMinutes,
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (yards.length === 0) return null;

  let coveringIndex = -1;
  for (let i = 0; i < yards.length; i += 1) {
    const yard = yards[i]!;
    // 落在區間內，或正好卡在結束／下一整備開始的銜接點
    if (
      atMinute + 1e-9 >= yard.start
      && atMinute < yard.end - 1e-9
    ) {
      coveringIndex = i;
      break;
    }
    if (Math.abs(atMinute - yard.end) <= 1e-6) {
      const next = yards[i + 1];
      if (next && Math.abs(next.start - yard.end) <= 1e-6) {
        coveringIndex = i + 1;
        break;
      }
    }
  }
  if (coveringIndex < 0) return null;

  let end = yards[coveringIndex]!.end;
  for (let i = coveringIndex + 1; i < yards.length; i += 1) {
    const next = yards[i]!;
    if (next.start > end + 1e-6) break;
    end = Math.max(end, next.end);
  }
  return end;
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
    // 行前設施同樣離正線起點站有一段距離，做完之後車要開過去才能上工，
    // 因此與保養一樣產生「整備後調度營運班次」（代號 P）。
    const preTripCodes = extractFacilityMapCodes(maintenanceBody, 'preTrip');
    const entryStations = resolveExitStationIdsForFacilityCodes(origins, preTripCodes);
    return {
      rotationExitStationId:
        resolvePreferredExitStationId(origins, preTripCodes)
        ?? (entryStations.length === 1 ? entryStations[0]! : null)
        ?? (entryStations[0] ?? null),
      allowEntryService: true,
      entryServiceExitStationIds: entryStations,
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
    // 保養設施（例 M1–M4）→ 拓樸出場站（例 T3上行）；開輪必須對齊該站起點路線（TN），
    // 不可因「進場載客另有管道」就強制 phase 0（NT／N2W）——車還在場內。
    const entryStations = resolveServicingExitStationIds(origins, maintenanceBody);
    return {
      rotationExitStationId:
        resolvePreferredExitStationId(
          origins,
          [
            ...extractFacilityMapCodes(maintenanceBody, 'maintenance'),
            ...extractFacilityMapCodes(maintenanceBody, 'carWash'),
          ],
        )
        ?? (entryStations.length === 1 ? entryStations[0]! : null)
        ?? (entryStations[0] ?? null),
      allowEntryService: true,
      entryServiceExitStationIds: entryStations,
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
  for (const taskType of [
    'inspection',
    'charging',
    'standby',
    'servicing',
  ] as const) {
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
