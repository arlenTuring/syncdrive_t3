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
  resolveInterTripGapSeconds,
  resolvePassengerRouteOccupancy,
  shouldIncludeRecoveryForRouteSwitch,
} from './schedule-engine/physics';
import {
  projectBlockBerthWindowsSeconds,
  projectProtectedBerthWindowsSeconds,
} from './stationBerthConstraint';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedScheduleTimeline,
} from './schedule-engine/types';
import { minuteToSecond, pushIssue, secondToMinute } from './schedule-engine/types';

/**
 * 整備後的調度營運班次（文件 §10）。
 *
 * 車子做完保養或行前，人車還在場內，離要跑的正線起點站有一段距離。
 * 這段「開過去上工」的路上會經過站點，所以順便載客，不要空車跑。
 *
 * 規則（2026-08-07 更正）：
 * - **不得佔用任何整備的尾巴**。整條串必須在整備串<strong>結束之後</strong>才發車。
 *   （舊版會把班次塞進保養視窗內偷尾巴，已廢除。）
 * - 適用保養（代號 M）與行前（代號 P）；充電、機動不適用——那兩種設施離起點站近。
 * - **不受同方向班距約束**：它的任務是盡快上工，不是補班距缺口。
 *   唯一要讓的是站位——抵達時該站位須已被 A 車淨空（見 resolveBerthClearMinute）。
 * - 計入運能（PPHPD），但不算輪替圈數（真正首班仍是後面那班正線）。
 * - 代號 = 整備區段代號 + 路線代號 + 發車時刻。
 * - 候選串由長到短試（車可能停在較遠設施），取第一條可行者；
 *   都不可行就略過，回報 MAINTENANCE_DISPATCH_UNREACHABLE（警告）。
 */

type RouteHop = {
  route: ShiftScheduleSelectedRoute;
  durationSeconds: number;
};

type PlacedHop = {
  hop: RouteHop;
  startMinute: number;
  endMinute: number;
  /** 這一段抵達站位時查到的站位淨空診斷；沒有別的車佔著就是 null（見文件 §10.3） */
  berthCheck: { arriveStationId: string; berthClearMinute: number } | null;
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

// 註：舊版這裡有 isSafeToInsertDeparture()，用「車隊物理班距下限」擋調度班次插入。
// 已移除——調度營運班次不受同方向班距約束（文件 §10.2），
// 它唯一要讓的是站位，改由 resolveBerthClearMinute() 處理。

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
    placed.unshift({ hop, startMinute, endMinute, berthCheck: null });
    afterStartMinute = startMinute;
    afterRouteId = hop.route.routeId;
    afterRoute = hop.route;
  }
  return placed;
}

/** 站位淨空的安全餘裕：20%（文件 §10.3） */
const BERTH_CLEARANCE_SAFETY_RATIO = 1.2;

/**
 * 目標站位什麼時候空出來（文件 §10.3）。
 *
 * A 車 = 原本停在該站、或即將到站的那一班。它到站之後還要佔用站位一段時間：
 * 停靠秒數 + 停靠緩衝（兩者已含在站位佔用窗內）+ 換線緩衝 + 恢復時間，
 * 全部乘上安全餘裕，才算真正淨空。
 *
 * 這些數字全部屬於 A 車，與 P 車（整備後開過來的調度班次）無關；
 * P 車只貢獻行駛時間，由呼叫端扣除。
 *
 * 站位佔用窗一律走 {@link projectProtectedBerthWindowsSeconds}——
 * 它已經把「A 車滯留在末站等下一個任務」與「碰撞保護時間 ×2」兩件事算進尾端，
 * 這裡不再自己算一遍，全引擎只有那一份定義。
 */
function resolveBerthClearMinute(args: {
  stationId: string;
  /** 2026-08-07 更正：之前只傳「這一列」的區塊，看不到其他車輛，抓不出跨車碰撞。
   *  必須查全部時間線——目標站位可能被任何一台車佔著，不是只有同一列。 */
  timelines: GeneratedScheduleTimeline[];
  routeById: Map<string, ShiftScheduleSelectedRoute>;
  minimumRecoveryTimeSeconds: number;
  collisionProtectionSeconds: number;
  /**
   * 這個調度班次要掛在哪一列。同一列＝同一台車，它自己前後的班次不可能跟它撞，
   * 要跳過；不跳過的話車子會被自己的前一趟擋住，白白延後。
   */
  selfTimelineRow: number;
  /** 只看這個時刻之後仍在佔用的車；更早已離站的不算 */
  notBeforeMinute: number;
}): number | null {
  // 調度班次的落點是引擎自己挑的（可換交路、可略過），所以這裡「算得起」滯留佔用
  // ——查得到別台車還停在目標站位，就換一條候選鏈或不插這一趟。
  const protection = {
    collisionProtectionSeconds: args.collisionProtectionSeconds,
    idleOccupancyTimelines: args.timelines,
  };
  let clearMinute: number | null = null;
  for (const timeline of args.timelines) {
    if (timeline.row === args.selfTimelineRow) continue;
    for (const block of timeline.blocks) {
      if (block.taskType !== 'passenger') continue;
      const route = block.routeId ? args.routeById.get(block.routeId) : undefined;
      if (!route) continue;
      // 兩份窗一一對應（受保護的那份是自然窗逐筆加工出來的）：
      // 自然窗＝A 車真正的到離站時刻，20% 安全餘裕只能乘在這上面；
      // 受保護窗的尾端＝滯留＋碰撞保護，是另一條獨立下限。
      const naturalWindows = projectBlockBerthWindowsSeconds(block, route);
      const protectedWindows = projectProtectedBerthWindowsSeconds(
        block,
        route,
        protection,
      );
      for (let wi = 0; wi < naturalWindows.length; wi += 1) {
        const win = naturalWindows[wi]!;
        const protectedWin = protectedWindows[wi] ?? win;
        if (win.stationId !== args.stationId) continue;
        const endMinute = secondToMinute(protectedWin.endSecond);
        if (endMinute <= args.notBeforeMinute - 1e-9) continue;

        // 物理下限：A 車離站後還要換線、恢復才輪到下一台進站
        const extraSeconds =
          Math.max(0, route.switchBufferAfterSeconds ?? 0)
          + Math.max(0, args.minimumRecoveryTimeSeconds);
        const occupancySeconds = Math.max(0, win.endSecond - win.startSecond);
        const physicsEstimateSecond =
          win.startSecond
          + (occupancySeconds + extraSeconds) * BERTH_CLEARANCE_SAFETY_RATIO;

        const clearSecond = Math.max(physicsEstimateSecond, protectedWin.endSecond);
        const candidate = secondToMinute(clearSecond);
        clearMinute = clearMinute == null ? candidate : Math.max(clearMinute, candidate);
      }
    }
  }
  return clearMinute;
}

/**
 * 挑選調度營運班次的落點（文件 §10.3）。
 *
 * 規則：
 * 1. 整條串必須在整備<strong>結束之後</strong>才發車——不得佔用任何整備尾巴。
 * 2. 抵達目標站時，該站位必須已經淨空（A 車走了）。P 車在路上的時間可以抵掉一部分等待。
 * 3. 尾端仍須接得上該車真正的首班正線。
 * 4. <strong>不檢查同方向班距</strong>——調度班次的任務是盡快上工，不受班距約束。
 * 5. 候選由長到短試，取第一條可行者。
 */
function pickSafeEntryPlacement(args: {
  candidates: RouteHop[][];
  firstTripStartMinute: number;
  firstTripRouteId: string;
  /** 整備串結束時刻：調度班次不得早於此發車 */
  yardEndMinute: number;
  exitStationIds: Set<string>;
  minimumRecoveryTimeSeconds: number;
  collisionProtectionSeconds: number;
  rotationRoutes: ShiftScheduleSelectedRoute[];
  /** 全部時間線——站位淨空判定要看<strong>其他</strong>車輛，不是只有這台車自己那一列 */
  timelines: GeneratedScheduleTimeline[];
  /** 這個調度班次要掛在哪一列；同一列是同一台車，不參與碰撞判定 */
  selfTimelineRow: number;
  routeById: Map<string, ShiftScheduleSelectedRoute>;
}): PlacedHop[] | null {
  for (const chain of args.candidates) {
    const placed = placeChainAgainstFirstTrip({
      chain,
      firstTripStartMinute: args.firstTripStartMinute,
      firstTripRouteId: args.firstTripRouteId,
      minimumRecoveryTimeSeconds: args.minimumRecoveryTimeSeconds,
      rotationRoutes: args.rotationRoutes,
    });
    if (placed.length === 0) continue;

    // 規則 1：整條串都必須落在整備結束之後
    if (placed[0]!.startMinute < args.yardEndMinute - 1e-9) continue;

    // 第一段起點必須是合法出場站（車只能從設施出場站冒出來）
    const firstStart = routeStartStation(placed[0]!.hop.route);
    if (!firstStart || !args.exitStationIds.has(firstStart)) continue;

    // 規則 2：每一段抵達下一站時，站位須已淨空。順便把查到的淨空時刻記在
    // item.berthCheck 上——這是唯一算過這件事的地方，UI hover 直接讀，不重算。
    let berthOk = true;
    for (const item of placed) {
      const arriveStation = routeEndStation(item.hop.route);
      if (!arriveStation) continue;
      const clearMinute = resolveBerthClearMinute({
        stationId: arriveStation,
        timelines: args.timelines,
        routeById: args.routeById,
        minimumRecoveryTimeSeconds: args.minimumRecoveryTimeSeconds,
        collisionProtectionSeconds: args.collisionProtectionSeconds,
        selfTimelineRow: args.selfTimelineRow,
        notBeforeMinute: args.yardEndMinute,
      });
      if (clearMinute == null) continue;
      item.berthCheck = { arriveStationId: arriveStation, berthClearMinute: clearMinute };
      if (item.endMinute < clearMinute - 1e-9) {
        berthOk = false;
        break;
      }
    }
    if (!berthOk) continue;

    return placed;
  }
  return null;
}

/** 整備類型：可被「保養後進場」略過、串到保養後的尾巴 */
function isYardTemplateBar(block: GeneratedScheduleBlock): boolean {
  if (block.source !== 'template_bar') return false;
  return (
    block.taskType === 'servicing'
    || block.taskType === 'inspection'
    || block.taskType === 'charging'
    || block.taskType === 'standby'
  );
}

/**
 * 從某整備起點往後找：連續整備串結束後的首班正線。
 * 回傳 passenger 與可偷尾巴的「串尾結束時間」（最後一段整備的 plannedEnd）。
 */
function findPassengerAfterContiguousYard(
  sorted: GeneratedScheduleBlock[],
  yardIndex: number,
): {
  passenger: GeneratedScheduleBlock;
  chainEndMinute: number;
  chainStartMinute: number;
} | null {
  const yard = sorted[yardIndex]!;
  let chainEndMinute = yard.plannedEndMinute;
  let chainStartMinute = yard.plannedStartMinute;
  for (let j = yardIndex + 1; j < sorted.length; j += 1) {
    const block = sorted[j]!;
    if (block.source === 'entry_service' || block.source === 'transition') continue;
    if (block.taskType === 'idle') continue;
    if (block.taskType === 'passenger' && block.source === 'template_bar') {
      return {
        passenger: block,
        chainEndMinute,
        chainStartMinute,
      };
    }
    if (isYardTemplateBar(block)) {
      chainEndMinute = Math.max(chainEndMinute, block.plannedEndMinute);
      chainStartMinute = Math.min(chainStartMinute, block.plannedStartMinute);
      continue;
    }
    return null;
  }
  return null;
}

/** 整備緊鄰前一格已是正線 → 正線中段，不准再插進場載客 */
function isYardPrecededByMainline(
  sorted: GeneratedScheduleBlock[],
  yardIndex: number,
): boolean {
  for (let j = yardIndex - 1; j >= 0; j -= 1) {
    const block = sorted[j]!;
    if (block.source === 'transition' || block.taskType === 'idle') continue;
    return (
      block.taskType === 'passenger'
      && (block.source === 'template_bar' || block.source === 'entry_service')
    );
  }
  return false;
}

export function insertMaintenanceEntryServiceTrips(args: {
  timelines: GeneratedScheduleTimeline[];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  firstTripOrigins: MaintenanceFirstTripOrigin[];
  maintenanceBody?: Record<string, unknown> | null;
  sectionCodes: MaintenanceSectionCodeBySection | null | undefined;
  minimumRecoveryTimeSeconds: number;
  /** 碰撞保護時間（秒）；預設 0＝維持舊行為 */
  collisionProtectionSeconds?: number;
  warnings: FeasibilityIssue[];
}): GeneratedScheduleTimeline[] {
  const {
    timelines,
    selectedRoutes,
    firstTripOrigins,
    maintenanceBody = null,
    sectionCodes,
    minimumRecoveryTimeSeconds,
    collisionProtectionSeconds = 0,
    warnings,
  } = args;
  if (firstTripOrigins.length === 0 || selectedRoutes.length === 0) return timelines;

  // 保養（M）與行前（P）都會產生調度營運班次；只要其中一種可用就往下跑。
  const dispatchCapableTaskTypes = ['servicing', 'inspection'] as const;
  const anyDispatchAllowed = dispatchCapableTaskTypes.some(
    (taskType) =>
      resolveYardPostTaskPolicy({ taskType, origins: firstTripOrigins, maintenanceBody })
        .allowEntryService,
  );
  if (!anyDispatchAllowed) return timelines;

  const routeById = new Map(selectedRoutes.map((route) => [route.routeId, route] as const));

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

      // 出場站與代號都依「這一段整備是哪一種」決定：保養→M、行前→P。
      const sectionCode = resolveMaintenanceSectionCodeForTaskType(
        yard.taskType,
        sectionCodes,
      );

      // 2026-08-08 修正：這裡原本在查不到出場站時退回「全部首班起點站」，
      // 等於認為車可以從路網上任何一站冒出來——實際上車就停在該整備設施的出場站。
      // 行前設施在 M、出來接 T3上行，卻因為這個退路排出「從 N2W 發車」的 PNT 班次，
      // 而那台車根本不在 N2W。查不到就<strong>不排</strong>，回報讓使用者去補設施拓樸。
      if (yardPolicy.entryServiceExitStationIds.length === 0) {
        pushIssue(warnings, {
          code: 'MAINTENANCE_DISPATCH_UNREACHABLE',
          severity: 'warning',
          kind: 'actionable',
          message:
            `時間線 ${timeline.row}：「${yard.label}」查不到出場站，`
            + '無法判斷車做完之後停在哪一站，因此不排整備後的調度營運班次'
            + '（請確認整備任務有設定該區段的設施，且設施在路網拓樸上有對應的停靠點）',
          detail: {
            timelineRow: timeline.row,
            yardBlockId: yard.id,
            yardTaskType: yard.taskType,
            tripCode: resolveGeneratedBlockTripCode(yard, i, sectionCodes),
          },
        });
        continue;
      }
      const exitStationIds = new Set(yardPolicy.entryServiceExitStationIds);

      const afterYard = findPassengerAfterContiguousYard(sorted, i);
      if (!afterYard?.passenger.routeId) continue;
      const nextPassenger = afterYard.passenger;

      // 這一段整備的出場站與下一班正線的起點站——兩者不同就一定要靠外掛把車送過去。
      // 下面每一個 continue 都可能讓外掛沒被插入，所以只要「非插不可」卻跳過，
      // 一律回報，不再靜默（2026-08-08：行前那兩列完全沒插外掛也沒任何警告，查了很久）。

      // 連續整備串（例 充電→行前）只在<strong>串尾</strong>處理一次。
      //
      // 2026-08-08 更正：舊版處理「串首」。車其實是從串尾那一段出來的，
      // 出場站、能不能插外掛都該由串尾決定。串首是充電時
      // （allowEntryService=false）會在上面第一道檢查就被跳掉且不回報，
      // 而串尾的行前又因為「前面是整備」被這裡跳掉——兩邊互推，
      // 整列完全沒有外掛也沒有任何警告，查很久才找到。
      {
        let hasYardAfter = false;
        for (let j = i + 1; j < sorted.length; j += 1) {
          const next = sorted[j]!;
          if (
            next.source === 'transition'
            || next.source === 'entry_service'
            || next.taskType === 'idle'
          ) {
            continue;
          }
          hasYardAfter = isYardTemplateBar(next);
          break;
        }
        if (hasYardAfter) continue;
      }

      const firstRoute = routeById.get(nextPassenger.routeId);
      const originStationId = firstRoute ? routeStartStation(firstRoute) : null;
      if (!originStationId) continue;

      // 整備被 defer／擠在正線中段時，本來就不該再多插一趟外掛。
      // 但這只在「車已經在下一班的起點站」時成立——
      // 2026-08-08 更正：若下一班正線的起點站不是整備出場站，車根本開不了那一班，
      // 外掛就是必要的，不能因為整備前面剛好是正線就靜默跳過
      // （行前夾在日間正線中段時就是這種情況，整整兩列完全沒插外掛也沒任何警告）。
      if (isYardPrecededByMainline(sorted, i) && exitStationIds.has(originStationId)) {
        continue;
      }

      /** 車不在下一班的起點站——外掛非插不可；此時任何跳過都要留下紀錄 */
      const dispatchIsRequired = !exitStationIds.has(originStationId);
      const reportSkip = (reason: string) => {
        if (!dispatchIsRequired) return;
        pushIssue(warnings, {
          code: 'MAINTENANCE_DISPATCH_UNREACHABLE',
          severity: 'warning',
          kind: 'actionable',
          message:
            `時間線 ${timeline.row}：「${yard.label}」做完後車在出場站，`
            + `但下一班正線從別的站發車，需要調度營運班次接過去——${reason}`,
          detail: {
            timelineRow: timeline.row,
            yardBlockId: yard.id,
            yardTaskType: yard.taskType,
            passengerBlockId: nextPassenger.id,
            originStationId,
            reason,
          },
        });
      };

      // 檢查 nextPassenger 前是否有緊鄰的前一班正線
      // 若前一班正線的終點站與 nextPassenger 起點站相同（列車已在正線上運營抵達起點），
      // 則車已經在起點，不需要也不得插入進場載客
      const prevBlockIndex = sorted.findIndex((b) => b.id === nextPassenger.id) - 1;
      if (prevBlockIndex >= 0) {
        const prevBlock = sorted[prevBlockIndex]!;
        if (prevBlock.taskType === 'passenger' && prevBlock.routeId) {
          const prevRoute = routeById.get(prevBlock.routeId);
          const prevEndStation = prevRoute ? routeEndStation(prevRoute) : null;
          if (prevEndStation && prevEndStation === originStationId) {
            // 車輛已由前一班正線載客抵達本班起點站，跳過進場載客。
            // 但若這一段整備的出場站不是那一站，車其實在整備裡待過、人在出場站，
            // 這個跳過就會漏掉必要的外掛——非插不可時留下紀錄。
            reportSkip('前一班正線的終點站與本班起點站相同，判定車已在起點');
            continue;
          }
        }
      }

      const candidates = listEntryChainCandidates({
        originStationId,
        exitStationIds,
        selectedRoutes,
      });

      // 若出場站集合中只有首班起點站本身（設施出場 == 路線首站），車已在起點，
      // 不需要進場載客；直接跳過。
      if (candidates.length === 0 && exitStationIds.has(originStationId)) {
        continue;
      }

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

      // 整備串（保養→行前…）結束之後才發車；不得佔用任何整備尾巴
      const fitting = pickSafeEntryPlacement({
        candidates,
        firstTripStartMinute: nextPassenger.plannedStartMinute,
        firstTripRouteId: nextPassenger.routeId,
        yardEndMinute: afterYard.chainEndMinute,
        exitStationIds,
        minimumRecoveryTimeSeconds,
        collisionProtectionSeconds,
        rotationRoutes: selectedRoutes,
        timelines,
        selfTimelineRow: timeline.row,
        routeById,
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
        // 檢查該時間線上是否已經存在同時間段運行的既有正線班次 (template_bar)
        // 若已有既有正線班次，絕不得插入進場載客覆蓋原有的正線班次
        const overlapsExistingPassenger = sorted.some(
          (b) =>
            b.taskType === 'passenger'
            && b.source === 'template_bar'
            && b.plannedStartMinute < item.endMinute - 1e-9
            && b.plannedEndMinute > item.startMinute + 1e-9,
        );
        if (overlapsExistingPassenger) {
          continue;
        }

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
          entryServiceBerthCheck: item.berthCheck
            ? {
                arriveStationId: item.berthCheck.arriveStationId,
                berthClearMinute: item.berthCheck.berthClearMinute,
                slackSeconds: Math.round(
                  (item.endMinute - item.berthCheck.berthClearMinute) * 60,
                ),
              }
            : undefined,
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
