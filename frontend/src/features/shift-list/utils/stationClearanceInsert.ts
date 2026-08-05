import type {
  ShiftScheduleSelectedRoute,
  ShiftScheduleStationDwell,
} from '../types/create';
import {
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
  applyDwellSlackSeconds,
  normalizeDwellSlackSeconds,
  resolveStationDwellMode,
  snapUpToClockAlignSeconds,
} from './schedule-engine/physics';

/** 調撥／插班預設緩衝：加在「離開餘裕＋遲到佔站」之上 */
export const DEFAULT_STATION_CLEARANCE_BUFFER_PERCENT = 10;

/**
 * 以「上一班離開衝突站」為基準的插班最早作動點——**不用營運班距**。
 *
 * 營運班距是服務目標，拿來當插班門檻會永遠插不進（尤其行前調撥）。
 * 這裡只問：前車何時能騰出該站，再加上離開餘裕、可能遲到佔站、緩衝％。
 *
 * ```
 * baseMargin   = leaveMarginSeconds + overrunHoldSeconds
 * buffered     = baseMargin × (1 + bufferPercent/100)
 * clearance    = previousDepartureSecond + buffered
 * earliest     = snap↑10s(clearance)
 * ```
 */
export type StationClearanceInsertInput = {
  /** 上一班在衝突站的出發秒（靠站完成、可離站；對開輪站常＝該班 plannedStart） */
  previousDepartureSecond: number;
  /**
   * 離開該站所需餘裕（秒）：把月台／股道讓給後車。
   * 基線＝該站靠站／離站（含靠站緩衝）。
   */
  leaveMarginSeconds: number;
  /**
   * 上一班可能比計畫更久才離開（秒）。
   * 例如均勢相對最快的差額、或停靠／首段行駛的保守加值。
   */
  overrunHoldSeconds?: number;
  /** 緩衝百分比；預設 10 → 餘裕再多留 10% */
  bufferPercent?: number;
};

export type StationClearanceInsertResult = {
  previousDepartureSecond: number;
  leaveMarginSeconds: number;
  overrunHoldSeconds: number;
  bufferPercent: number;
  /** 不含 snap 的清除完成秒 */
  clearanceSecond: number;
  /** 插班／調撥最早可開始作動秒（10 秒格） */
  earliestInsertSecond: number;
  /** clearance - previousDeparture（含緩衝後的有效間距） */
  effectiveGapSeconds: number;
};

export function resolveStationClearanceEarliestInsertSecond(
  input: StationClearanceInsertInput,
): StationClearanceInsertResult {
  const previousDepartureSecond = Math.max(0, Math.floor(input.previousDepartureSecond));
  const leaveMarginSeconds = Math.max(0, input.leaveMarginSeconds);
  const overrunHoldSeconds = Math.max(0, input.overrunHoldSeconds ?? 0);
  const bufferPercent = Math.max(
    0,
    input.bufferPercent ?? DEFAULT_STATION_CLEARANCE_BUFFER_PERCENT,
  );

  const baseMargin = leaveMarginSeconds + overrunHoldSeconds;
  const bufferedMargin = baseMargin * (1 + bufferPercent / 100);
  const clearanceSecond = previousDepartureSecond + bufferedMargin;
  const earliestInsertSecond = snapUpToClockAlignSeconds(clearanceSecond);

  return {
    previousDepartureSecond,
    leaveMarginSeconds,
    overrunHoldSeconds,
    bufferPercent,
    clearanceSecond,
    earliestInsertSecond,
    effectiveGapSeconds: Math.max(
      SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
      earliestInsertSecond - previousDepartureSecond,
    ),
  };
}

/**
 * 單站「靠站／離站」秒數（含靠站緩衝）；不停靠／換線視為 0。
 * 與占用計算不同：衝突站可用設定秒數（含首站），不因 dwellRequired=false 歸零。
 */
export function resolveStationExitDwellSeconds(
  dwell: ShiftScheduleStationDwell | null | undefined,
  dwellSlackSeconds: number,
): number {
  if (!dwell) return 0;
  const mode = resolveStationDwellMode(dwell);
  if (mode === 'no_stop' || mode === 'line_change') {
    return 0;
  }
  const seconds = dwell.dwellSeconds;
  if (seconds == null || seconds <= 0) return 0;
  return applyDwellSlackSeconds(seconds, normalizeDwellSlackSeconds(dwellSlackSeconds));
}

/**
 * 推估「離開餘裕」：衝突站靠站／離站時間（含靠站緩衝），夾在 [minFloor, maxCap]。
 * 優先指定站；否則用路線首站；首站無設定則用第一個有停靠秒的站。
 */
export function resolveLeaveMarginSeconds(args: {
  stationDwells?: ShiftScheduleStationDwell[];
  dwellSlackSeconds?: number | null;
  conflictStationId?: string | null;
  minFloorSeconds?: number;
  maxCapSeconds?: number;
}): number {
  const minFloor = args.minFloorSeconds ?? SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS;
  const maxCap = args.maxCapSeconds ?? 180;
  const slack = args.dwellSlackSeconds ?? 0;
  const dwells = args.stationDwells ?? [];
  const conflictId = args.conflictStationId?.trim() || '';

  let pick: ShiftScheduleStationDwell | undefined;
  if (conflictId) {
    pick = dwells.find((d) => d.stationId?.trim() === conflictId);
  }
  if (!pick && dwells.length > 0) {
    pick = dwells[0];
  }
  let exitSeconds = resolveStationExitDwellSeconds(pick, slack);
  if (exitSeconds <= 0) {
    for (const dwell of dwells) {
      exitSeconds = resolveStationExitDwellSeconds(dwell, slack);
      if (exitSeconds > 0) break;
    }
  }

  if (exitSeconds <= 0) {
    return minFloor;
  }
  return Math.min(maxCap, Math.max(minFloor, exitSeconds));
}

/**
 * 推估「遲到佔站」：均勢相對最快的差額（保守：該站還可能多佔多久）。
 */
export function resolveOverrunHoldSeconds(args: {
  avgSeconds?: number | null;
  minSeconds?: number | null;
}): number {
  const avg = Math.max(0, args.avgSeconds ?? 0);
  const min = Math.max(0, args.minSeconds ?? 0);
  if (avg <= min) return 0;
  return snapUpToClockAlignSeconds(avg - min);
}

/**
 * 路線開輪調撥：相對前車的車站清除有效間距（秒）。
 * 不用時段目標班距、也不用車隊物理地板。
 */
export function resolveRouteClearanceInsertGapSeconds(
  route: Pick<
    ShiftScheduleSelectedRoute,
    'stationDwells' | 'dwellSlackSeconds' | 'stationIds'
  > & {
    avgTravelTimeSeconds?: number | null;
    minTravelTimeSeconds?: number | null;
  },
  travel?: {
    avgTravelTimeSeconds?: number | null;
    minTravelTimeSeconds?: number | null;
  } | null,
  conflictStationId?: string | null,
): number {
  const leaveMarginSeconds = resolveLeaveMarginSeconds({
    stationDwells: route.stationDwells,
    dwellSlackSeconds: route.dwellSlackSeconds,
    conflictStationId:
      conflictStationId
      ?? route.stationIds?.[0]
      ?? route.stationDwells?.[0]?.stationId
      ?? null,
  });
  const overrunHoldSeconds = resolveOverrunHoldSeconds({
    avgSeconds: travel?.avgTravelTimeSeconds ?? route.avgTravelTimeSeconds,
    minSeconds: travel?.minTravelTimeSeconds ?? route.minTravelTimeSeconds,
  });
  return resolveStationClearanceEarliestInsertSecond({
    previousDepartureSecond: 0,
    leaveMarginSeconds,
    overrunHoldSeconds,
  }).effectiveGapSeconds;
}
