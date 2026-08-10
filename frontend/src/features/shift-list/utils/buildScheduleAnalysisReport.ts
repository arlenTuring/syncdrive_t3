import {
  parseIntervalEndMinutes,
  parseIntervalStartMinutes,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import {
  resolveInterTripGapSeconds,
  resolvePassengerRouteOccupancy,
} from './schedule-engine/physics';
import type { RouteSuccessorPolicy } from './schedule-engine/routeSuccessorPolicy';
import type { GeneratedSchedulePlan } from './schedule-engine/types';
import { splitIntoDayCycleSegments } from './scheduleDayCycle';
import {
  collectStationBerthOccupancies,
  type StationBerthOccupancy,
} from './stationBerthOccupancy';

/**
 * 班表分析報表
 * ============
 *
 * 目的：把「為什麼會撞、要改什麼」講成使用者看得懂的數字，
 * 而不是丟一堆 issue code 讓人自己推。整份報表只靠一條標準式子：
 *
 * <pre>需求車數 = 一輪往返時間 ÷ 目標班距</pre>
 *
 * 兩個輸入班表本來就有（路線占用推得出往返、時段屬性給班距），
 * 所以<strong>不需要任何硬編碼</strong>——換地圖、換班距、換路線數都成立，
 * 而且「車太多」與「車不夠」兩個方向會用同一條式子講出來。
 *
 * 因果鏈（報表的敘事主線）：
 * <pre>
 * 車比需要的多 → 多出來的車沒有脈衝可接 → 只能停在終點站
 *              → 一個停靠點停不下這麼多台 → 碰撞保護不足
 * </pre>
 */

/** 一個停靠點同時只能停一台車 */
export const STATION_BERTH_CAPACITY = 1;

function routeStartStation(route: ShiftScheduleSelectedRoute): string | null {
  return route.stationIds[0]?.trim() || null;
}

function routeEndStation(route: ShiftScheduleSelectedRoute): string | null {
  const last = route.stationIds[route.stationIds.length - 1];
  return last?.trim() || null;
}

export type FleetSupplyDemandRow = {
  intervalId: string;
  intervalName: string;
  attributeName: string;
  startMinute: number;
  endMinute: number;
  /** 目標班距（秒）；時段屬性沒設就是 null，該列不做供需判斷 */
  targetHeadwaySeconds: number | null;
  /** 一輪往返時間（秒）＝各路線占用 + 銜接間隔 */
  cycleSeconds: number;
  /** 需求車數 = 一輪往返 ÷ 目標班距 */
  requiredVehicles: number | null;
  /**
   * 這個時段<strong>平均同時</strong>有幾台車在跑正線
   * ＝ 正線佔用分鐘 ÷ 時段長度。
   *
   * 要跟「需求車數」比就必須是這個數字——需求 = 一輪往返 ÷ 班距，算的是
   * <strong>同一時刻</strong>要幾台車在線上。先前這裡放的是「這個時段出現過的
   * 時間線列數」，那是<strong>整段時間的聯集</strong>：一台車跑三小時要去充電、
   * 換另一台接手，五小時的時段就數成兩台，跟同時在跑幾台是兩回事
   * （2026-08-10 使用者：「我招呼模式明明就只有設定兩台，他寫四台是什麼意思？」）。
   */
  actualVehicles: number;
  /** 這個時段同時在跑正線的最大台數 */
  peakConcurrentVehicles: number;
  /** 這個時段動用過的時間線列數（含輪替接手的）——供人對照，不用來算供需 */
  distinctRowCount: number;
  /** 實際 − 需求；正值＝車太多，負值＝車不夠 */
  surplusVehicles: number | null;
  /** 這個時段的正線班次數 */
  tripCount: number;
  /** 每台車每小時平均空等分鐘 */
  idleMinutesPerVehicleHour: number;
};

export type BerthCapacityRow = {
  stationId: string;
  stationName: string;
  capacity: number;
  peakConcurrentVehicles: number;
  peakAtMinute: number;
  /** 尖峰時超出容量幾台 */
  overflowVehicles: number;
  /**
   * 關聯圖上「跑完這一段之後，還能改停哪些別的站」的數量。
   * 沒有提供關聯圖時是 <code>null</code>（＝不知道），
   * 不能寫 0——0 是「確定沒有替代」這個很強的斷言。
   */
  alternativeBerthCount: number | null;
  alternativeBerthNames: string[];
  /** 停最久的那台車空等幾分鐘 */
  longestIdleMinutes: number;
};

export type ScheduleAnalysisSuggestion = {
  code:
    | 'FLEET_SURPLUS'
    | 'FLEET_SHORTAGE'
    | 'BERTH_OVERFLOW'
    | 'NO_ALTERNATIVE_BERTH';
  /** 影響的對象（時段名或站名），讓使用者知道要去改哪裡 */
  subject: string;
  message: string;
};

export type ScheduleAnalysisReport = {
  fleet: FleetSupplyDemandRow[];
  berths: BerthCapacityRow[];
  suggestions: ScheduleAnalysisSuggestion[];
  /** 有沒有任何一項偏離；工具列的報表按鈕靠這個決定要不要亮黃燈 */
  hasFindings: boolean;
  summary: {
    timelineCount: number;
    /** 全日正線班次數 */
    totalTrips: number;
    /** 全日載客占用（車·小時） */
    revenueVehicleHours: number;
    /** 各時段過剩車數的最大值（沒有可判斷的時段就是 null） */
    peakSurplusVehicles: number | null;
    /** 停靠點超量最嚴重的那一站超出幾台 */
    peakBerthOverflow: number;
  };
};

function minutesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * 一個區塊落在某個時段裡的分鐘數，<strong>照日循環算</strong>。
 *
 * 跨午夜的區塊記成「開始 23:55、結束 1450」，直接跟 00:00–05:00 的窗口比大小
 * 永遠不重疊——那一段車其實在跑，卻整個從早上那個時段的統計裡消失。
 * 先切成鐘面區段再比，跟班表其他地方同一套算術。
 */
function windowOverlapMinutes(
  blockStartMinute: number,
  blockEndMinute: number,
  windowStartMinute: number,
  windowEndMinute: number,
): number {
  const segments = splitIntoDayCycleSegments(blockStartMinute, blockEndMinute);
  if (segments.length === 0) return 0;
  let total = 0;
  for (const segment of segments) {
    total += minutesOverlap(
      segment.startMinute,
      segment.endMinute,
      windowStartMinute,
      windowEndMinute,
    );
  }
  return total;
}

/**
 * 一輪往返時間：把輪替順序上的每一段占用加起來，再加上段與段之間的銜接間隔。
 * 這是「一台車跑完一整圈回到原點」要花的時間，也是需求車數的分子。
 */
export function resolveRotationCycleSeconds(
  passengerRoutes: ShiftScheduleSelectedRoute[],
  minimumRecoveryTimeSeconds: number,
): number {
  if (passengerRoutes.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < passengerRoutes.length; i += 1) {
    const route = passengerRoutes[i]!;
    const occupancy = resolvePassengerRouteOccupancy(route);
    if (!occupancy) continue;
    total += occupancy.occupancySeconds;
    const nextRoute = passengerRoutes[(i + 1) % passengerRoutes.length]!;
    total += resolveInterTripGapSeconds({
      minimumRecoveryTimeSeconds,
      previousRouteSwitchBufferSeconds: route.switchBufferAfterSeconds,
      isRouteSwitch: route.routeId !== nextRoute.routeId,
      previousRoute: route,
      nextRoute,
    });
  }
  return total;
}

/**
 * 關聯圖上「跑完某一段之後可以改停哪些別的站」。
 * 這一欄是使用者最難自己看出來的——關聯圖畫得再漂亮，
 * 也不會直接告訴你「停在這一站的車沒有第二個選擇」。
 */
function collectAlternativeBerths(
  successorPolicy: RouteSuccessorPolicy | null | undefined,
  stationId: string,
): { count: number | null; names: string[] } {
  if (!successorPolicy) return { count: null, names: [] };
  const alternatives = new Map<string, string>();

  for (const [instanceId, route] of successorPolicy.routesByInstanceId) {
    // 只看「終點停在這一站」的路線——那些車才會佔用這個站位
    if (routeEndStation(route) !== stationId) continue;
    // 這一段的前一段有哪些？前一段的其他後繼就是「可以改停別站」的選項
    for (const [fromId, tos] of successorPolicy.prioritySuccessors) {
      if (!tos.includes(instanceId)) continue;
      const siblings = [
        ...(successorPolicy.prioritySuccessors.get(fromId) ?? []),
        ...(successorPolicy.secondarySuccessors.get(fromId) ?? []),
      ];
      for (const siblingId of siblings) {
        if (siblingId === instanceId) continue;
        const siblingRoute = successorPolicy.routesByInstanceId.get(siblingId);
        if (!siblingRoute) continue;
        const terminal = routeEndStation(siblingRoute);
        if (!terminal || terminal === stationId) continue;
        // 起點要一致，車才開得過去
        if (routeStartStation(siblingRoute) !== routeStartStation(route)) continue;
        alternatives.set(
          terminal,
          siblingRoute.routeName || siblingRoute.routeCode || terminal,
        );
      }
    }
  }
  return { count: alternatives.size, names: [...alternatives.values()] };
}

/** 尖峰同時停放台數；同一列車相接／重疊的占用先合併（車不會跟自己搶位） */
function resolveBerthPeak(spans: StationBerthOccupancy[]): {
  peak: number;
  atMinute: number;
  longestIdleMinutes: number;
} {
  const byRow = new Map<number, Array<{ start: number; end: number }>>();
  let longestIdleMinutes = 0;
  for (const occ of spans) {
    longestIdleMinutes = Math.max(
      longestIdleMinutes,
      occ.actualDepartMinute - occ.startMinute,
    );
    const list = byRow.get(occ.timelineRow) ?? [];
    list.push({ start: occ.startMinute, end: occ.actualDepartMinute });
    byRow.set(occ.timelineRow, list);
  }

  const events: Array<{ minute: number; delta: number }> = [];
  for (const list of byRow.values()) {
    list.sort((a, b) => a.start - b.start || a.end - b.end);
    let merged: { start: number; end: number } | null = null;
    for (const span of list) {
      if (merged && span.start <= merged.end + 1e-9) {
        merged.end = Math.max(merged.end, span.end);
        continue;
      }
      if (merged) {
        events.push({ minute: merged.start, delta: 1 });
        events.push({ minute: merged.end, delta: -1 });
      }
      merged = { ...span };
    }
    if (merged) {
      events.push({ minute: merged.start, delta: 1 });
      events.push({ minute: merged.end, delta: -1 });
    }
  }

  events.sort((a, b) => a.minute - b.minute || b.delta - a.delta);
  let current = 0;
  let peak = 0;
  let atMinute = 0;
  for (const event of events) {
    current += event.delta;
    if (current > peak) {
      peak = current;
      atMinute = event.minute;
    }
  }
  return { peak, atMinute, longestIdleMinutes };
}

function formatClock(minute: number): string {
  const total = Math.max(0, Math.round(minute));
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function buildScheduleAnalysisReport(args: {
  plan: GeneratedSchedulePlan;
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  passengerRoutes: ShiftScheduleSelectedRoute[];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
  collisionProtectionSeconds: number;
  successorPolicy?: RouteSuccessorPolicy | null;
}): ScheduleAnalysisReport {
  const {
    plan,
    intervals,
    attributes,
    passengerRoutes,
    selectedRoutes,
    minimumRecoveryTimeSeconds,
    collisionProtectionSeconds,
    successorPolicy,
  } = args;

  /**
   * 供給端算的是「有幾台車在跑載客」。
   *
   * <code>entry_service</code>（整備後的第一段調度營運班次）一樣載客、一樣佔著車，
   * 只是不算輪、不受班距約束——先前只收 <code>template_bar</code>，那些班次
   * 完全不計入供給，車隊看起來會比實際少。
   */
  const mainlineBlocks = plan.timelines.flatMap((timeline) =>
    timeline.blocks
      .filter(
        (block) =>
          block.taskType === 'passenger'
          && (block.source === 'template_bar' || block.source === 'entry_service'),
      )
      .map((block) => ({ ...block, row: timeline.row })),
  );

  const cycleSeconds = resolveRotationCycleSeconds(
    passengerRoutes,
    minimumRecoveryTimeSeconds,
  );
  const attributeById = new Map(attributes.map((item) => [item.id, item] as const));

  const fleet: FleetSupplyDemandRow[] = [];
  for (const interval of intervals) {
    const startMinute = parseIntervalStartMinutes(interval.startTime);
    const endMinute = parseIntervalEndMinutes(interval.endTime);
    if (startMinute == null || endMinute == null || endMinute <= startMinute) {
      continue;
    }
    const attribute = attributeById.get(interval.attributeId);
    const targetHeadwaySeconds = attribute?.headwaySeconds ?? null;

    const inWindow = mainlineBlocks
      .map((block) => ({
        block,
        overlap: windowOverlapMinutes(
          block.plannedStartMinute,
          block.plannedEndMinute,
          startMinute,
          endMinute,
        ),
      }))
      .filter((item) => item.overlap > 0);
    const rows = new Set(inWindow.map((item) => item.block.row));
    const windowMinutes = endMinute - startMinute;

    let busyMinutes = 0;
    for (const item of inWindow) busyMinutes += item.overlap;
    // 平均同時在跑幾台——這才跟「需求車數」是同一個維度
    const actualVehicles = windowMinutes > 0 ? busyMinutes / windowMinutes : 0;

    // 尖峰同時在跑幾台：掃過每一段正線的起訖，看重疊最多幾層
    const events: Array<{ at: number; delta: number }> = [];
    for (const { block } of inWindow) {
      for (const segment of splitIntoDayCycleSegments(
        block.plannedStartMinute,
        block.plannedEndMinute,
      )) {
        const from = Math.max(segment.startMinute, startMinute);
        const to = Math.min(segment.endMinute, endMinute);
        if (to <= from) continue;
        events.push({ at: from, delta: 1 });
        events.push({ at: to, delta: -1 });
      }
    }
    events.sort((a, b) => (a.at - b.at) || (a.delta - b.delta));
    let concurrent = 0;
    let peakConcurrentVehicles = 0;
    for (const event of events) {
      concurrent += event.delta;
      if (concurrent > peakConcurrentVehicles) peakConcurrentVehicles = concurrent;
    }

    /**
     * 空等 = 這個時段裡「什麼都沒排」的時間，<strong>整備與待命不算</strong>。
     *
     * 先前是拿「列數 × 時段長度 − 正線時間」直接當空等，於是一台車進廠充電
     * 兩小時會被算成空等兩小時，還被描述成「只能停在終點站佔著停靠點」——
     * 車明明在充電樁裡。要扣掉的是那一列在這個時段的<strong>所有</strong>排定工作。
     */
    let idleMinutes = 0;
    for (const row of rows) {
      const timeline = plan.timelines.find((item) => item.row === row);
      if (!timeline) continue;
      let scheduledMinutes = 0;
      for (const block of timeline.blocks) {
        scheduledMinutes += windowOverlapMinutes(
          block.plannedStartMinute,
          block.plannedEndMinute,
          startMinute,
          endMinute,
        );
      }
      idleMinutes += Math.max(0, windowMinutes - scheduledMinutes);
    }
    const idleMinutesPerVehicleHour =
      rows.size > 0 && windowMinutes > 0
        ? (idleMinutes / rows.size) * (60 / windowMinutes)
        : 0;

    const requiredVehicles =
      targetHeadwaySeconds && targetHeadwaySeconds > 0 && cycleSeconds > 0
        ? cycleSeconds / targetHeadwaySeconds
        : null;

    fleet.push({
      intervalId: interval.id,
      intervalName: interval.name || `${interval.startTime}–${interval.endTime}`,
      attributeName: attribute?.name ?? '',
      startMinute,
      endMinute,
      targetHeadwaySeconds,
      cycleSeconds,
      requiredVehicles,
      actualVehicles,
      peakConcurrentVehicles,
      distinctRowCount: rows.size,
      surplusVehicles:
        requiredVehicles == null ? null : actualVehicles - requiredVehicles,
      tripCount: inWindow.length,
      idleMinutesPerVehicleHour,
    });
  }

  const occupancies = collectStationBerthOccupancies(
    plan.timelines,
    selectedRoutes,
    { collisionProtectionSeconds },
  );
  const byStation = new Map<string, StationBerthOccupancy[]>();
  for (const occ of occupancies) {
    const list = byStation.get(occ.stationId) ?? [];
    list.push(occ);
    byStation.set(occ.stationId, list);
  }

  const berths: BerthCapacityRow[] = [];
  for (const [stationId, spans] of byStation) {
    const { peak, atMinute, longestIdleMinutes } = resolveBerthPeak(spans);
    if (peak <= STATION_BERTH_CAPACITY) continue;
    const alternatives = collectAlternativeBerths(successorPolicy, stationId);
    berths.push({
      stationId,
      stationName: spans[0]?.stationName ?? stationId,
      capacity: STATION_BERTH_CAPACITY,
      peakConcurrentVehicles: peak,
      peakAtMinute: atMinute,
      overflowVehicles: peak - STATION_BERTH_CAPACITY,
      alternativeBerthCount: alternatives.count,
      alternativeBerthNames: alternatives.names,
      longestIdleMinutes,
    });
  }
  berths.sort((a, b) => b.overflowVehicles - a.overflowVehicles);

  const suggestions: ScheduleAnalysisSuggestion[] = [];
  for (const row of fleet) {
    if (row.surplusVehicles == null) continue;
    if (row.surplusVehicles >= 1) {
      suggestions.push({
        code: 'FLEET_SURPLUS',
        subject: row.intervalName,
        message:
          `${row.intervalName} ${formatClock(row.startMinute)}–${formatClock(row.endMinute)}：`
          + `班距 ${row.targetHeadwaySeconds} 秒只要 ${row.requiredVehicles!.toFixed(1)} 台同時在線`
          + `（一輪往返 ${(row.cycleSeconds / 60).toFixed(1)} 分 ÷ ${(row.targetHeadwaySeconds! / 60).toFixed(1)} 分）；`
          + `實際平均 ${row.actualVehicles.toFixed(1)} 台、尖峰 ${row.peakConcurrentVehicles} 台，`
          + `多 ${row.surplusVehicles.toFixed(1)} 台。多的車沒班次可跑，`
          + `扣掉整備與待命後每台每小時還空等 ${row.idleMinutesPerVehicleHour.toFixed(0)} 分，佔著停靠點。`,
      });
      continue;
    }
    if (row.surplusVehicles <= -1) {
      suggestions.push({
        code: 'FLEET_SHORTAGE',
        subject: row.intervalName,
        message:
          `${row.intervalName} ${formatClock(row.startMinute)}–${formatClock(row.endMinute)}：`
          + `班距 ${row.targetHeadwaySeconds} 秒要 ${row.requiredVehicles!.toFixed(1)} 台同時在線`
          + `（一輪往返 ${(row.cycleSeconds / 60).toFixed(1)} 分 ÷ ${(row.targetHeadwaySeconds! / 60).toFixed(1)} 分）；`
          + `實際平均 ${row.actualVehicles.toFixed(1)} 台、尖峰 ${row.peakConcurrentVehicles} 台，`
          + `少 ${Math.abs(row.surplusVehicles).toFixed(1)} 台，班距會被拉開。`,
      });
    }
  }
  for (const berth of berths) {
    suggestions.push({
      code: 'BERTH_OVERFLOW',
      subject: berth.stationName,
      message:
        `${berth.stationName}：${formatClock(berth.peakAtMinute)} 同時有 `
        + `${berth.peakConcurrentVehicles} 台車要停，但一個停靠點只能停 `
        + `${berth.capacity} 台，超出 ${berth.overflowVehicles} 台。`
        + `停最久的那台等了 ${berth.longestIdleMinutes.toFixed(0)} 分鐘。`,
    });
    if (berth.alternativeBerthCount === 0) {
      // null＝沒給關聯圖、不知道，不能當成「沒有替代」來建議
      suggestions.push({
        code: 'NO_ALTERNATIVE_BERTH',
        subject: berth.stationName,
        message:
          `${berth.stationName}：關聯圖上沒有任何一條路線能讓車改停別的站，`
          + `所以車一定得擠在這裡。請在關聯圖補一條終點在別站的備用路線。`,
      });
    }
  }

  const totalTrips = mainlineBlocks.length;
  const revenueVehicleHours =
    mainlineBlocks.reduce(
      (sum, block) => sum + (block.plannedEndMinute - block.plannedStartMinute),
      0,
    ) / 60;
  const surpluses = fleet
    .map((row) => row.surplusVehicles)
    .filter((value): value is number => value != null);

  return {
    fleet,
    berths,
    suggestions,
    hasFindings: suggestions.length > 0,
    summary: {
      timelineCount: plan.timelines.length,
      totalTrips,
      revenueVehicleHours,
      peakSurplusVehicles: surpluses.length > 0 ? Math.max(...surpluses) : null,
      peakBerthOverflow: berths.reduce(
        (max, berth) => Math.max(max, berth.overflowVehicles),
        0,
      ),
    },
  };
}
