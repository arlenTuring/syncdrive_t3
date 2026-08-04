import type {
  MaintenanceSectionCodeBySection,
} from './maintenanceSectionCode';
import {
  resolveGeneratedBlockTripCode,
  resolveMaintenanceSectionCodeForTaskType,
} from './maintenanceSectionCode';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type { MaintenanceFirstTripOrigin } from './maintenanceFirstTripOrigins';
import { resolveYardPostTaskPolicy } from './maintenancePostTaskPolicy';
import {
  resolveFleetPhysicalHeadwayFloorSeconds,
  resolveInterTripGapSeconds,
  resolvePassengerRouteOccupancy,
  shouldIncludeRecoveryForRouteSwitch,
} from './schedule-engine/physics';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedScheduleTimeline,
} from './schedule-engine/types';
import { minuteToSecond, pushIssue, secondToMinute } from './schedule-engine/types';

/**
 * 進場載客交路（載客調度）：
 *
 * 以「這台車真正的首班正線」為錨點往回推。保養結束後，車輛不見得停在首班起點站，
 * 因此在保養尾端長出一串「真實路線」的載客短交路，時間對齊成剛好在首班發車前抵達，
 * 佔用（偷）保養尾巴。串越長偷得越多，但不得早於保養開始；偷不過就砍掉最早那幾段。
 *
 * 特性：
 * - 用真實路線的行駛＋停靠時間（可算出最大要多久）。
 * - 計入運能（PPHPD），但不算輪替（真正首班仍是那班正線）。
 * - 代號＝整備代號＋路線代號＋開始時刻；色卡另一色。
 * - 安全插入：已知同路線上一班／下一班，保養尾巴只塞不會追撞的發車；
 *   由最長可達交路往短試，落地第一條「時間夠且安全」的串。
 * - 即使首班起點本身也是出場站，仍以其他出場站的最壞距離往回長交路
 *  （車實際可能停在較遠設施）。
 * - 僅保養（servicing）可被偷尾巴；出場站優先依 maintenance+carWash 設施過濾。
 */

type RouteHop = {
  route: ShiftScheduleSelectedRoute;
  durationSeconds: number;
};

type PlacedHop = {
  hop: RouteHop;
  startMinute: number;
  endMinute: number;
};

function routeStartStation(route: ShiftScheduleSelectedRoute): string | null {
  return route.stationIds[0]?.trim() || null;
}

function routeEndStation(route: ShiftScheduleSelectedRoute): string | null {
  const last = route.stationIds[route.stationIds.length - 1];
  return last?.trim() || null;
}

/** 單趟路線的載客占用（行駛均＋停靠），對齊 10 秒且不大於均。缺資料回 null。 */
function resolveRouteRunSeconds(route: ShiftScheduleSelectedRoute): number | null {
  return resolvePassengerRouteOccupancy(route)?.occupancySeconds ?? null;
}

/**
 * 反向從首班起點站 origin 枚舉所有「起點為出場站」的交路候選。
 * 同站只保留最短跳數；回傳依跳數由多到少排序（最壞情況優先）。
 *
 * 注意：即使 origin 本身也是出場站，仍須枚舉「其他出場站 → origin」的路徑
 * （車實際可能停在較遠設施；最壞情況才是進場載客的意義）。
 */
function listEntryChainCandidates(args: {
  originStationId: string;
  exitStationIds: Set<string>;
  selectedRoutes: ShiftScheduleSelectedRoute[];
}): RouteHop[][] {
  const { originStationId, exitStationIds, selectedRoutes } = args;

  const routesByEnd = new Map<string, RouteHop[]>();
  for (const route of selectedRoutes) {
    const from = routeStartStation(route);
    const to = routeEndStation(route);
    if (!from || !to || from === to) continue;
    const run = resolveRouteRunSeconds(route);
    if (run == null) continue;
    const list = routesByEnd.get(to) ?? [];
    list.push({ route, durationSeconds: run });
    routesByEnd.set(to, list);
  }

  const pathTo = new Map<string, RouteHop[]>([[originStationId, []]]);
  const queue: string[] = [originStationId];
  const candidates: RouteHop[][] = [];

  while (queue.length > 0) {
    const station = queue.shift()!;
    const suffix = pathTo.get(station)!;
    const incoming = routesByEnd.get(station) ?? [];
    for (const hop of incoming) {
      const prev = routeStartStation(hop.route)!;
      if (pathTo.has(prev)) continue;
      const path = [hop, ...suffix];
      pathTo.set(prev, path);
      // 起點須為出場站，且不得是「原地 0 跳」（origin 自己）
      if (exitStationIds.has(prev) && path.length > 0 && prev !== originStationId) {
        candidates.push(path);
      }
      queue.push(prev);
    }
  }

  // 同跳數保留全部；整體由長到短，優先塞最長可安全落地者
  return candidates.sort((a, b) => b.length - a.length);
}

/** 該路線目前既有發車秒（template_bar 正線 + 已生進場載客） */
function collectRouteDepartureSeconds(
  timelines: GeneratedScheduleTimeline[],
): Map<string, number[]> {
  const byRoute = new Map<string, number[]>();
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'passenger') continue;
      if (block.source !== 'template_bar' && block.source !== 'entry_service') continue;
      if (!block.routeId) continue;
      const list = byRoute.get(block.routeId) ?? [];
      list.push(minuteToSecond(block.plannedStartMinute));
      byRoute.set(block.routeId, list);
    }
  }
  for (const list of byRoute.values()) {
    list.sort((a, b) => a - b);
  }
  return byRoute;
}

/**
 * 安全插入判定：已知同路線上一班／下一班，新發車與兩側間隔皆不得低於
 * 車隊物理班距下限（否則會追撞或被追）。
 */
function isSafeToInsertDeparture(args: {
  route: ShiftScheduleSelectedRoute;
  departureSecond: number;
  existing: number[] | undefined;
  timelineCount: number;
}): boolean {
  const { route, departureSecond, existing, timelineCount } = args;
  if (!existing || existing.length === 0) return true;

  const floor = resolveFleetPhysicalHeadwayFloorSeconds(route, timelineCount);
  if (floor <= 0) return true;

  let previous: number | null = null;
  let next: number | null = null;
  for (const other of existing) {
    if (other <= departureSecond) {
      previous = other;
      continue;
    }
    next = other;
    break;
  }

  if (previous != null && departureSecond - previous < floor - 1e-6) return false;
  if (next != null && next - departureSecond < floor - 1e-6) return false;
  return true;
}

/** 對齊首班往前排一串 hop；回傳各段起迄分鐘。 */
function placeChainAgainstFirstTrip(args: {
  chain: RouteHop[];
  firstTripStartMinute: number;
  firstTripRouteId: string;
  minimumRecoveryTimeSeconds: number;
  rotationRoutes: ShiftScheduleSelectedRoute[];
}): PlacedHop[] {
  const placed: PlacedHop[] = [];
  let afterStartMinute = args.firstTripStartMinute;
  let afterRoute: ShiftScheduleSelectedRoute | null =
    args.rotationRoutes.find((route) => route.routeId === args.firstTripRouteId) ?? null;
  let afterRouteId = args.firstTripRouteId;
  for (let h = args.chain.length - 1; h >= 0; h -= 1) {
    const hop = args.chain[h]!;
    const isRouteSwitch = hop.route.routeId !== afterRouteId;
    const includeRecovery =
      !isRouteSwitch
      || !afterRoute
      || shouldIncludeRecoveryForRouteSwitch({
        previousRoute: hop.route,
        nextRoute: afterRoute,
        rotationRoutes: args.rotationRoutes,
      });
    const gapSeconds = resolveInterTripGapSeconds({
      minimumRecoveryTimeSeconds: args.minimumRecoveryTimeSeconds,
      previousRouteSwitchBufferSeconds: hop.route.switchBufferAfterSeconds,
      isRouteSwitch,
      includeRecovery,
      previousRoute: hop.route,
      nextRoute: afterRoute ?? undefined,
    });
    const endMinute = afterStartMinute - secondToMinute(gapSeconds);
    const startMinute = endMinute - secondToMinute(hop.durationSeconds);
    placed.unshift({ hop, startMinute, endMinute });
    afterStartMinute = startMinute;
    afterRouteId = hop.route.routeId;
    afterRoute = hop.route;
  }
  return placed;
}

/**
 * 挑選可安全插入的進場載客串：
 * 1. 候選由長到短（最壞出場距離優先）
 * 2. 砍掉早於保養開始的出場側段落
 * 3. 每一段相對同路線上一班／下一班都須安全
 * 4. 取第一條通過者（即最長可安全落地）
 */
function pickSafeEntryPlacement(args: {
  candidates: RouteHop[][];
  firstTripStartMinute: number;
  firstTripRouteId: string;
  yardStartMinute: number;
  /** 僅偷保養尾巴：進場載客發車須落在保養視窗內 */
  yardEndMinute: number;
  exitStationIds: Set<string>;
  minimumRecoveryTimeSeconds: number;
  rotationRoutes: ShiftScheduleSelectedRoute[];
  departureSecondsByRoute: Map<string, number[]>;
  timelineCount: number;
}): PlacedHop[] | null {
  for (const chain of args.candidates) {
    const placed = placeChainAgainstFirstTrip({
      chain,
      firstTripStartMinute: args.firstTripStartMinute,
      firstTripRouteId: args.firstTripRouteId,
      minimumRecoveryTimeSeconds: args.minimumRecoveryTimeSeconds,
      rotationRoutes: args.rotationRoutes,
    });
    // 發車落在保養視窗內（偷尾巴）；可跑出保養結束之後接到首班
    const fitting = placed.filter(
      (item) =>
        item.startMinute >= args.yardStartMinute - 1e-9
        && item.startMinute < args.yardEndMinute - 1e-9,
    );
    if (fitting.length === 0) continue;

    // 尾端須仍接到首班
    const lastFitting = fitting[fitting.length - 1]!;
    const lastPlaced = placed[placed.length - 1]!;
    if (lastFitting.hop.route.routeId !== lastPlaced.hop.route.routeId) continue;
    if (Math.abs(lastFitting.endMinute - lastPlaced.endMinute) > 1e-9) continue;

    // 砍出場側後，剩餘第一段起點仍須是可出場站（不可憑空出現在中間站）
    const firstStart = routeStartStation(fitting[0]!.hop.route);
    if (!firstStart || !args.exitStationIds.has(firstStart)) continue;

    const allSafe = fitting.every((item) =>
      isSafeToInsertDeparture({
        route: item.hop.route,
        departureSecond: minuteToSecond(item.startMinute),
        existing: args.departureSecondsByRoute.get(item.hop.route.routeId),
        timelineCount: args.timelineCount,
      }),
    );
    if (!allSafe) continue;

    return fitting;
  }
  return null;
}

/** 保養與首班正線之間不得夾其他整備（行前／充電等），否則不算「保養後直接上場」 */
function findImmediatePassengerAfterYard(
  sorted: GeneratedScheduleBlock[],
  yardIndex: number,
): GeneratedScheduleBlock | null {
  for (let j = yardIndex + 1; j < sorted.length; j += 1) {
    const block = sorted[j]!;
    if (block.source === 'entry_service' || block.source === 'transition') continue;
    if (block.taskType === 'idle') continue;
    if (block.taskType === 'passenger' && block.source === 'template_bar') {
      return block;
    }
    // 夾了其他整備任務 → 此保養不直接接正線
    if (block.source === 'template_bar') return null;
  }
  return null;
}

export function insertMaintenanceEntryServiceTrips(args: {
  timelines: GeneratedScheduleTimeline[];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  firstTripOrigins: MaintenanceFirstTripOrigin[];
  maintenanceBody?: Record<string, unknown> | null;
  sectionCodes: MaintenanceSectionCodeBySection | null | undefined;
  minimumRecoveryTimeSeconds: number;
  warnings: FeasibilityIssue[];
}): GeneratedScheduleTimeline[] {
  const {
    timelines,
    selectedRoutes,
    firstTripOrigins,
    maintenanceBody = null,
    sectionCodes,
    minimumRecoveryTimeSeconds,
    warnings,
  } = args;
  if (firstTripOrigins.length === 0 || selectedRoutes.length === 0) return timelines;

  const servicingPolicy = resolveYardPostTaskPolicy({
    taskType: 'servicing',
    origins: firstTripOrigins,
    maintenanceBody,
  });
  if (!servicingPolicy.allowEntryService) return timelines;

  const exitStationIds = new Set(
    servicingPolicy.entryServiceExitStationIds.length > 0
      ? servicingPolicy.entryServiceExitStationIds
      : firstTripOrigins.map((origin) => origin.stationId),
  );
  const routeById = new Map(selectedRoutes.map((route) => [route.routeId, route] as const));
  const sectionCode = resolveMaintenanceSectionCodeForTaskType('servicing', sectionCodes);
  const timelineCount = Math.max(1, timelines.length);

  // 安全插入基準：含已落地的進場載客，動態更新上一班／下一班
  const departureSecondsByRoute = collectRouteDepartureSeconds(timelines);

  return timelines.map((timeline) => {
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    const extras: GeneratedScheduleBlock[] = [];

    for (let i = 0; i < sorted.length; i += 1) {
      const yard = sorted[i]!;
      const yardPolicy = resolveYardPostTaskPolicy({
        taskType: yard.taskType,
        origins: firstTripOrigins,
        maintenanceBody,
      });
      if (
        yard.source !== 'template_bar'
        || !yardPolicy.allowEntryService
      ) {
        continue;
      }

      const nextPassenger = findImmediatePassengerAfterYard(sorted, i);
      if (!nextPassenger?.routeId) continue;

      const firstRoute = routeById.get(nextPassenger.routeId);
      const originStationId = firstRoute ? routeStartStation(firstRoute) : null;
      if (!originStationId) continue;
      // 即使 origin 也是出場站，仍要試其他出場站 → origin 的最壞交路

      const candidates = listEntryChainCandidates({
        originStationId,
        exitStationIds,
        selectedRoutes,
      });
      if (candidates.length === 0) {
        pushIssue(warnings, {
          code: 'MAINTENANCE_DISPATCH_UNREACHABLE',
          severity: 'warning',
          kind: 'policy',
          message: `時間線 ${timeline.row}：略過「${yard.label}」後的進場載客——沒有路線能從出場接到首班起點`,
          detail: {
            timelineRow: timeline.row,
            yardBlockId: yard.id,
            passengerBlockId: nextPassenger.id,
            originStationId,
            tripCode: resolveGeneratedBlockTripCode(yard, i, sectionCodes),
          },
        });
        continue;
      }

      const fitting = pickSafeEntryPlacement({
        candidates,
        firstTripStartMinute: nextPassenger.plannedStartMinute,
        firstTripRouteId: nextPassenger.routeId,
        yardStartMinute: yard.plannedStartMinute,
        yardEndMinute: yard.plannedEndMinute,
        exitStationIds,
        minimumRecoveryTimeSeconds,
        rotationRoutes: selectedRoutes,
        departureSecondsByRoute,
        timelineCount,
      });

      if (!fitting) {
        pushIssue(warnings, {
          code: 'MAINTENANCE_DISPATCH_UNREACHABLE',
          severity: 'warning',
          kind: 'policy',
          message: `時間線 ${timeline.row}：略過「${yard.label}」後的進場載客——尾巴時間不夠，或會追上同路線前一班`,
          detail: {
            timelineRow: timeline.row,
            yardBlockId: yard.id,
            passengerBlockId: nextPassenger.id,
            originStationId,
            candidateCount: candidates.length,
            tripCode: resolveGeneratedBlockTripCode(yard, i, sectionCodes),
          },
        });
        continue;
      }

      for (const item of fitting) {
        const block: GeneratedScheduleBlock = {
          id: `entry-${yard.id}-${item.hop.route.routeId}-${Math.round(item.startMinute * 60)}`,
          timelineRow: timeline.row,
          taskType: 'passenger',
          label: `進場載客 · ${item.hop.route.routeName || item.hop.route.routeId}`,
          routeId: item.hop.route.routeId,
          routeName: item.hop.route.routeName,
          routeCode: item.hop.route.routeCode ?? undefined,
          anchorStartMinute: item.startMinute,
          plannedStartMinute: item.startMinute,
          plannedEndMinute: item.endMinute,
          travelSeconds: item.hop.durationSeconds,
          dwellSeconds: 0,
          source: 'entry_service',
          firstTripOriginStationId: originStationId,
          entryServiceSectionCode: sectionCode ?? undefined,
        };
        extras.push(block);
        const list = departureSecondsByRoute.get(item.hop.route.routeId) ?? [];
        list.push(minuteToSecond(item.startMinute));
        list.sort((a, b) => a - b);
        departureSecondsByRoute.set(item.hop.route.routeId, list);
      }
    }

    if (extras.length === 0) return timeline;
    return {
      ...timeline,
      blocks: [...timeline.blocks, ...extras].sort(
        (a, b) => a.plannedStartMinute - b.plannedStartMinute,
      ),
    };
  });
}
