/**
 * 停靠點站位佔用約束（生成期）：
 * 1) 依發車時刻順序預約各站「到站～離站」
 * 2) 衝突時先延後整趟（10 秒格）
 * 3) 延後超過上限 → 改派該主線槽的備用路線（改停備援點）
 * 4) 仍解不了才留給 validate 的 STATION_BERTH_COLLISION
 */
import {
  isPrimarySelectedRoute,
  resolveSelectedRouteInstanceId,
  type ShiftScheduleSelectedRoute,
} from '../types/create';
import {
  buildBlockStationDepartures,
  resolveRouteForBlock,
} from './buildBlockStationDepartures';
import {
  isStationDwellRequired,
  looksLikeDefaultCrossoverPortalStationId,
  resolveInterTripGapSeconds,
  resolvePassengerRouteOccupancy,
  resolveRouteOriginStationId,
  resolveRouteTerminalStationId,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
  snapUpToClockAlignSeconds,
  shouldIncludeRecoveryForRouteSwitch,
} from './schedule-engine/physics';
import {
  resolveNextInstanceId,
  type RouteSuccessorPolicy,
} from './schedule-engine/routeSuccessorPolicy';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
} from './schedule-engine/types';
import { minuteToSecond, pushIssue, secondToMinute } from './schedule-engine/types';

/** 超過此延後秒數才考慮改派備用（可被同列下一錨點空間再夾緊） */
export const DEFAULT_STATION_BERTH_MAX_DELAY_SECONDS = 120;

export type BerthWindowSec = {
  stationId: string;
  stationName: string;
  startSecond: number;
  endSecond: number;
};

export type StationBerthConstraintResult = {
  timelines: GeneratedSchedulePlan['timelines'];
  delayedCount: number;
  backupSwitchedCount: number;
  unresolvedCount: number;
};

function minPresenceSeconds(): number {
  return SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS;
}

/**
 * 與 collectStationBerthOccupancies 同一套自然在站定義（秒）。
 */
export function projectBlockBerthWindowsSeconds(
  block: GeneratedScheduleBlock,
  route: ShiftScheduleSelectedRoute,
): BerthWindowSec[] {
  if (block.taskType !== 'passenger') return [];
  const stops = buildBlockStationDepartures(block, route);
  if (stops.length === 0) return [];

  const out: BerthWindowSec[] = [];
  const minPresence = minPresenceSeconds();

  for (let si = 0; si < stops.length; si += 1) {
    const stop = stops[si]!;
    const dwellMeta = route.stationDwells.find((d) => d.stationId === stop.stationId);
    const isPortal =
      looksLikeDefaultCrossoverPortalStationId(stop.stationId)
      || (dwellMeta != null && !isStationDwellRequired(dwellMeta));
    const isTerminal = si === stops.length - 1;
    const isOrigin = si === 0;

    let startSecond = minuteToSecond(stop.arrivalMinute);
    let endSecond = minuteToSecond(Math.max(stop.departureMinute, stop.arrivalMinute));

    if (isPortal && !isOrigin && !isTerminal && stop.dwellSeconds <= 0) {
      continue;
    }

    if (endSecond <= startSecond + 1e-9) {
      if (stop.dwellSeconds > 0 || isOrigin || isTerminal) {
        endSecond = startSecond + minPresence;
      } else {
        continue;
      }
    }

    out.push({
      stationId: stop.stationId,
      stationName: stop.stationName,
      startSecond,
      endSecond,
    });
  }

  return out;
}

/**
 * 為了避開已預約站位，整趟需延後的秒數（已對齊 10s）。
 * 以「出發平移」假設：所有站到／離同步 +D。
 */
export function resolveBerthClearDelaySeconds(
  proposed: BerthWindowSec[],
  booked: BerthWindowSec[],
): number {
  if (proposed.length === 0 || booked.length === 0) return 0;

  let delay = 0;
  for (let iter = 0; iter < 24; iter += 1) {
    let bump = 0;
    for (const win of proposed) {
      const a0 = win.startSecond + delay;
      const a1 = win.endSecond + delay;
      for (const prior of booked) {
        if (prior.stationId !== win.stationId) continue;
        if (a0 < prior.endSecond - 1e-9 && a1 > prior.startSecond + 1e-9) {
          bump = Math.max(bump, prior.endSecond - a0);
        }
      }
    }
    if (bump <= 1e-9) break;
    delay = snapUpToClockAlignSeconds(delay + bump);
  }
  return delay;
}

export function listBackupRoutesForPrimary(
  routes: ShiftScheduleSelectedRoute[],
  primary: ShiftScheduleSelectedRoute,
): ShiftScheduleSelectedRoute[] {
  const primaryId = resolveSelectedRouteInstanceId(primary);
  return routes.filter((route) => {
    if (isPrimarySelectedRoute(route)) return false;
    if (route.backupForInstanceId?.trim() === primaryId) return true;
    if (
      !route.backupForInstanceId?.trim()
      && route.backupForRouteId?.trim() === primary.routeId
    ) {
      return true;
    }
    return false;
  });
}

/**
 * 改派／候選路線不得拆掉同車交路：前趟終點＝本趟起點、本趟終點＝後趟起點。
 * （TN 末站「N2W下行出發」不能接「[備用]N2W下行」起點的 NTB）
 */
export function routePreservesTurnaroundContinuity(args: {
  route: ShiftScheduleSelectedRoute;
  previousRoute: ShiftScheduleSelectedRoute | null;
  nextRoute: ShiftScheduleSelectedRoute | null;
}): boolean {
  const { route, previousRoute, nextRoute } = args;
  if (previousRoute) {
    const terminal = resolveRouteTerminalStationId(previousRoute);
    const origin = resolveRouteOriginStationId(route);
    if (!terminal || !origin || terminal !== origin) return false;
  }
  if (nextRoute) {
    const terminal = resolveRouteTerminalStationId(route);
    const origin = resolveRouteOriginStationId(nextRoute);
    if (!terminal || !origin || terminal !== origin) return false;
  }
  return true;
}

/**
 * 主線交路 TN→NT 的備援必須成對：TNB→NTB（同站折返接續）。
 * 禁止只留 TN、下一趟改 NTB。
 *
 * 若提供 successorPolicy：nextPrimary 必須等於圖上 resolveNext(thisPrimary)，
 * 否則不成對（關聯圖硬約束）。
 */
export function findContinuousBackupPair(args: {
  selectedRoutes: ShiftScheduleSelectedRoute[];
  thisPrimary: ShiftScheduleSelectedRoute;
  nextPrimary: ShiftScheduleSelectedRoute;
  previousRoute: ShiftScheduleSelectedRoute | null;
  nextNextRoute: ShiftScheduleSelectedRoute | null;
  successorPolicy?: RouteSuccessorPolicy | null;
}): {
  thisBackup: ShiftScheduleSelectedRoute;
  nextBackup: ShiftScheduleSelectedRoute;
} | null {
  if (args.successorPolicy?.valid) {
    const expected = resolveGraphExpectedNextPrimary(
      args.successorPolicy,
      args.thisPrimary,
      args.selectedRoutes,
    );
    if (
      !expected
      || resolveSelectedRouteInstanceId(expected)
        !== resolveSelectedRouteInstanceId(args.nextPrimary)
    ) {
      return null;
    }
  }

  for (const thisBackup of listBackupRoutesForPrimary(
    args.selectedRoutes,
    args.thisPrimary,
  )) {
    for (const nextBackup of listBackupRoutesForPrimary(
      args.selectedRoutes,
      args.nextPrimary,
    )) {
      if (
        !routePreservesTurnaroundContinuity({
          route: thisBackup,
          previousRoute: args.previousRoute,
          nextRoute: nextBackup,
        })
      ) {
        continue;
      }
      if (
        !routePreservesTurnaroundContinuity({
          route: nextBackup,
          previousRoute: thisBackup,
          nextRoute: args.nextNextRoute,
        })
      ) {
        continue;
      }
      return { thisBackup, nextBackup };
    }
  }
  return null;
}

/**
 * 關聯圖／鎖定環：主線 P 的下一主線是誰。
 */
export function resolveGraphExpectedNextPrimary(
  policy: RouteSuccessorPolicy,
  thisPrimary: ShiftScheduleSelectedRoute,
  selectedRoutes: ShiftScheduleSelectedRoute[],
): ShiftScheduleSelectedRoute | null {
  if (!policy.valid) return null;
  const primary = isPrimarySelectedRoute(thisPrimary)
    ? thisPrimary
    : resolvePrimaryForRoute(selectedRoutes, thisPrimary);
  const currentId = resolveSelectedRouteInstanceId(primary);
  const next = resolveNextInstanceId(policy, currentId);
  if (!next) return null;

  const fromPolicy = policy.routesByInstanceId.get(next.instanceId);
  if (fromPolicy && isPrimarySelectedRoute(fromPolicy)) return fromPolicy;

  return (
    selectedRoutes.find(
      (route) =>
        isPrimarySelectedRoute(route)
        && resolveSelectedRouteInstanceId(route) === next.instanceId,
    ) ?? null
  );
}

function resolvePrimaryForRoute(
  routes: ShiftScheduleSelectedRoute[],
  route: ShiftScheduleSelectedRoute,
): ShiftScheduleSelectedRoute {
  if (isPrimarySelectedRoute(route)) return route;
  const byInstance = route.backupForInstanceId?.trim();
  if (byInstance) {
    const hit = routes.find(
      (item) =>
        isPrimarySelectedRoute(item)
        && resolveSelectedRouteInstanceId(item) === byInstance,
    );
    if (hit) return hit;
  }
  const byRouteId = route.backupForRouteId?.trim();
  if (byRouteId) {
    const hit = routes.find(
      (item) => isPrimarySelectedRoute(item) && item.routeId === byRouteId,
    );
    if (hit) return hit;
  }
  return route;
}

function withProposedStart(
  block: GeneratedScheduleBlock,
  startSecond: number,
  occupancySeconds: number,
  route: ShiftScheduleSelectedRoute,
): GeneratedScheduleBlock {
  const endSecond = startSecond + occupancySeconds;
  return {
    ...block,
    routeInstanceId: resolveSelectedRouteInstanceId(route),
    routeId: route.routeId,
    routeName: route.routeName,
    routeCode: route.routeCode ?? undefined,
    plannedStartMinute: secondToMinute(startSecond),
    plannedEndMinute: secondToMinute(endSecond),
    travelSeconds:
      resolvePassengerRouteOccupancy(route)?.travelSeconds ?? block.travelSeconds,
    dwellSeconds:
      resolvePassengerRouteOccupancy(route)?.dwellSeconds ?? block.dwellSeconds,
  };
}

function occupancySecondsForBlockRoute(
  block: GeneratedScheduleBlock,
  route: ShiftScheduleSelectedRoute,
): number {
  const resolved = resolvePassengerRouteOccupancy(route);
  if (resolved) {
    const current =
      minuteToSecond(block.plannedEndMinute) - minuteToSecond(block.plannedStartMinute);
    // 保留展開時已壓縮的占用（快～均之間），但不低於最快
    if (
      current > 0
      && current >= resolved.minOccupancySeconds - 1e-9
      && current <= resolved.occupancySeconds + 1e-9
      && block.routeId === route.routeId
    ) {
      return snapUpToClockAlignSeconds(current);
    }
    return resolved.occupancySeconds;
  }
  return Math.max(
    SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
    minuteToSecond(block.plannedEndMinute) - minuteToSecond(block.plannedStartMinute),
  );
}

function maxDelayAllowedSeconds(args: {
  preferredStartSecond: number;
  occupancySeconds: number;
  nextSameRowStartSecond: number | null;
  gapBeforeNextSeconds: number;
  maxDelaySeconds: number;
}): number {
  const { preferredStartSecond, occupancySeconds, nextSameRowStartSecond, gapBeforeNextSeconds, maxDelaySeconds } =
    args;
  let cap = Math.max(0, maxDelaySeconds);
  if (nextSameRowStartSecond != null) {
    const latestStart =
      nextSameRowStartSecond - gapBeforeNextSeconds - occupancySeconds;
    cap = Math.min(cap, Math.max(0, latestStart - preferredStartSecond));
  }
  return snapUpToClockAlignSeconds(Math.max(0, cap));
}

function evaluateCandidate(args: {
  block: GeneratedScheduleBlock;
  route: ShiftScheduleSelectedRoute;
  preferredStartSecond: number;
  booked: BerthWindowSec[];
}): { delaySeconds: number; occupancySeconds: number; windows: BerthWindowSec[] } {
  const occupancySeconds = occupancySecondsForBlockRoute(args.block, args.route);
  const probe = withProposedStart(
    args.block,
    args.preferredStartSecond,
    occupancySeconds,
    args.route,
  );
  const windows = projectBlockBerthWindowsSeconds(probe, args.route);
  const delaySeconds = resolveBerthClearDelaySeconds(windows, args.booked);
  return { delaySeconds, occupancySeconds, windows };
}

/**
 * 生成後約束修復：延後 → 備用；就地改写 timelines。
 * successorPolicy：關聯圖硬約束——成對備用必須鏡像圖上繼任。
 */
export function enforceStationBerthConstraints(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds?: number;
  maxDelaySeconds?: number;
  successorPolicy?: RouteSuccessorPolicy | null;
  warnings?: FeasibilityIssue[];
}): StationBerthConstraintResult {
  const {
    selectedRoutes,
    minimumRecoveryTimeSeconds = 0,
    maxDelaySeconds = DEFAULT_STATION_BERTH_MAX_DELAY_SECONDS,
    successorPolicy = null,
    warnings,
  } = args;

  const timelines = args.timelines.map((timeline) => ({
    ...timeline,
    blocks: timeline.blocks.map((block) => ({ ...block })),
  }));

  const passengerBlocks: GeneratedScheduleBlock[] = [];
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'passenger') continue;
      if (!resolveRouteForBlock(block, selectedRoutes)) continue;
      passengerBlocks.push(block);
    }
  }
  passengerBlocks.sort(
    (a, b) =>
      a.plannedStartMinute - b.plannedStartMinute
      || a.timelineRow - b.timelineRow
      || a.id.localeCompare(b.id),
  );

  const blocksByRow = new Map<number, GeneratedScheduleBlock[]>();
  for (const timeline of timelines) {
    const list = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    blocksByRow.set(timeline.row, list);
  }

  const booked: BerthWindowSec[] = [];
  let delayedCount = 0;
  let backupSwitchedCount = 0;
  let unresolvedCount = 0;

  for (const block of passengerBlocks) {
    const initialRoute = resolveRouteForBlock(block, selectedRoutes);
    if (!initialRoute) continue;

    const preferredStartSecond = minuteToSecond(block.plannedStartMinute);
    const rowBlocks = blocksByRow.get(block.timelineRow) ?? [];
    const blockIndex = rowBlocks.findIndex((item) => item.id === block.id);
    const nextPassenger =
      blockIndex >= 0
        ? rowBlocks.slice(blockIndex + 1).find((item) => item.taskType === 'passenger')
        : undefined;
    const previousPassenger =
      blockIndex > 0
        ? [...rowBlocks.slice(0, blockIndex)].reverse().find(
            (item) => item.taskType === 'passenger',
          )
        : undefined;
    const previousRoute =
      previousPassenger != null
        ? resolveRouteForBlock(previousPassenger, selectedRoutes)
        : null;
    const nextRouteForContinuity =
      nextPassenger != null
        ? resolveRouteForBlock(nextPassenger, selectedRoutes)
        : null;

    const nextNextPassenger =
      nextPassenger != null && blockIndex >= 0
        ? rowBlocks
            .slice(blockIndex + 1)
            .filter((item) => item.taskType === 'passenger')[1]
        : undefined;
    const nextNextRoute =
      nextNextPassenger != null
        ? resolveRouteForBlock(nextNextPassenger, selectedRoutes)
        : null;

    const primary = resolvePrimaryForRoute(selectedRoutes, initialRoute);
    const nextPrimary =
      nextRouteForContinuity != null
        ? resolvePrimaryForRoute(selectedRoutes, nextRouteForContinuity)
        : null;

    // 單腳備用：僅當仍接得上「目前下一趟」（常失敗：TNB 接不住 NT）
    const backups = listBackupRoutesForPrimary(selectedRoutes, primary);
    const candidates: ShiftScheduleSelectedRoute[] = [initialRoute];
    for (const backup of backups) {
      if (
        !routePreservesTurnaroundContinuity({
          route: backup,
          previousRoute,
          nextRoute: nextRouteForContinuity,
        })
      ) {
        continue;
      }
      if (
        !candidates.some(
          (c) =>
            c.routeId === backup.routeId
            && resolveSelectedRouteInstanceId(c)
              === resolveSelectedRouteInstanceId(backup),
        )
      ) {
        candidates.push(backup);
      }
    }

    // 成對備用：TN→TNB 且同列下一主線 NT→NTB（遵守交路，不用 TN→NTB）
    const backupPair =
      nextPrimary && nextPassenger
        ? findContinuousBackupPair({
            selectedRoutes,
            thisPrimary: primary,
            nextPrimary,
            previousRoute,
            nextNextRoute,
            successorPolicy,
          })
        : null;
    if (
      backupPair
      && !candidates.some(
        (c) =>
          resolveSelectedRouteInstanceId(c)
          === resolveSelectedRouteInstanceId(backupPair.thisBackup),
      )
    ) {
      candidates.push(backupPair.thisBackup);
    }

    type Choice = {
      route: ShiftScheduleSelectedRoute;
      delaySeconds: number;
      occupancySeconds: number;
      windows: BerthWindowSec[];
      maxAllowed: number;
      pairedNextRoute: ShiftScheduleSelectedRoute | null;
    };

    const scoreRoute = (
      route: ShiftScheduleSelectedRoute,
      assumedNext: ShiftScheduleSelectedRoute | null,
      pairedNextRoute: ShiftScheduleSelectedRoute | null,
    ): Choice => {
      const evaluated = evaluateCandidate({
        block,
        route,
        preferredStartSecond,
        booked,
      });
      const gapBeforeNext =
        nextPassenger != null && assumedNext
          ? resolveInterTripGapSeconds({
              minimumRecoveryTimeSeconds,
              previousRouteSwitchBufferSeconds: route.switchBufferAfterSeconds,
              isRouteSwitch: route.routeId !== assumedNext.routeId,
              includeRecovery: shouldIncludeRecoveryForRouteSwitch({
                previousRoute: route,
                nextRoute: assumedNext,
                rotationRoutes: selectedRoutes.filter((r) => isPrimarySelectedRoute(r)),
              }),
              previousRoute: route,
              nextRoute: assumedNext,
            })
          : 0;
      const maxAllowed = maxDelayAllowedSeconds({
        preferredStartSecond,
        occupancySeconds: evaluated.occupancySeconds,
        nextSameRowStartSecond:
          nextPassenger != null
            ? minuteToSecond(nextPassenger.plannedStartMinute)
            : null,
        gapBeforeNextSeconds: gapBeforeNext,
        maxDelaySeconds,
      });
      return {
        route,
        delaySeconds: evaluated.delaySeconds,
        occupancySeconds: evaluated.occupancySeconds,
        windows: evaluated.windows,
        maxAllowed,
        pairedNextRoute,
      };
    };

    const scored: Choice[] = [];
    for (const route of candidates) {
      const isPairLead =
        backupPair != null
        && resolveSelectedRouteInstanceId(route)
          === resolveSelectedRouteInstanceId(backupPair.thisBackup);
      const assumedNext = isPairLead
        ? backupPair!.nextBackup
        : nextRouteForContinuity;
      scored.push(
        scoreRoute(route, assumedNext, isPairLead ? backupPair!.nextBackup : null),
      );
    }

    const primaryChoice = scored.find((c) => c.route === initialRoute) ?? scored[0]!;
    let chosen = primaryChoice;

    if (primaryChoice.delaySeconds > primaryChoice.maxAllowed) {
      const backupOk = scored
        .filter((c) => c.route !== initialRoute)
        .filter((c) => c.delaySeconds <= c.maxAllowed)
        .sort((a, b) => {
          // 成對備用優先於殘缺單腳（避免 TN 接到異點 NTB）
          const ap = a.pairedNextRoute ? 0 : 1;
          const bp = b.pairedNextRoute ? 0 : 1;
          if (ap !== bp) return ap - bp;
          return a.delaySeconds - b.delaySeconds || a.occupancySeconds - b.occupancySeconds;
        });
      if (backupOk[0]) {
        chosen = backupOk[0]!;
      } else {
        const backupBetter = scored
          .filter((c) => c.route !== initialRoute)
          .sort((a, b) => a.delaySeconds - b.delaySeconds);
        if (
          backupBetter[0]
          && backupBetter[0].delaySeconds < primaryChoice.delaySeconds
        ) {
          chosen = backupBetter[0]!;
        }
      }
    } else if (primaryChoice.delaySeconds > 0) {
      // 仍以主路線延後為優先；不為了少延幾秒就換備用
      chosen = primaryChoice;
    }

    // 硬閘：前趟主線不得接到異點備用（TN→NTB）
    if (
      previousRoute
      && isPrimarySelectedRoute(previousRoute)
      && !isPrimarySelectedRoute(chosen.route)
      && !routePreservesTurnaroundContinuity({
        route: chosen.route,
        previousRoute,
        nextRoute: null,
      })
    ) {
      chosen = primaryChoice;
    }

    const finalDelay = chosen.delaySeconds;
    const canClear = finalDelay <= chosen.maxAllowed + 1e-9;

    if (!canClear && finalDelay > 0) {
      unresolvedCount += 1;
      // 仍盡力延到上限內，剩餘碰撞留給驗證
      const appliedDelay = Math.min(finalDelay, chosen.maxAllowed);
      const startSecond = preferredStartSecond + appliedDelay;
      const patched = withProposedStart(
        block,
        startSecond,
        chosen.occupancySeconds,
        chosen.route,
      );
      Object.assign(block, patched);
      const windows = projectBlockBerthWindowsSeconds(block, chosen.route);
      for (const win of windows) booked.push(win);
      if (appliedDelay > 0) delayedCount += 1;
      continue;
    }

    const startSecond = preferredStartSecond + finalDelay;
    const patched = withProposedStart(
      block,
      startSecond,
      chosen.occupancySeconds,
      chosen.route,
    );
    Object.assign(block, patched);

    if (chosen.pairedNextRoute && nextPassenger) {
      const nextStart = minuteToSecond(nextPassenger.plannedStartMinute);
      const nextOcc = occupancySecondsForBlockRoute(
        nextPassenger,
        chosen.pairedNextRoute,
      );
      Object.assign(
        nextPassenger,
        withProposedStart(nextPassenger, nextStart, nextOcc, chosen.pairedNextRoute),
      );
      backupSwitchedCount += 1;
      if (warnings) {
        pushIssue(warnings, {
          code: 'STATION_BERTH_BACKUP_USED',
          severity: 'warning',
          message:
            `站位約束改派備用交路 ${chosen.route.routeCode ?? chosen.route.routeName}`
            + ` → ${chosen.pairedNextRoute.routeCode ?? chosen.pairedNextRoute.routeName}`
            + `（取代 ${initialRoute.routeCode ?? initialRoute.routeName}`
            + ` → ${nextRouteForContinuity?.routeCode ?? nextRouteForContinuity?.routeName ?? '下一趟'}）`,
          detail: {
            blockId: block.id,
            pairedBlockId: nextPassenger.id,
            timelineRow: block.timelineRow,
            fromRouteId: initialRoute.routeId,
            toRouteId: chosen.route.routeId,
            pairedToRouteId: chosen.pairedNextRoute.routeId,
            delaySeconds: finalDelay,
          },
        });
      }
    } else if (chosen.route !== initialRoute) {
      backupSwitchedCount += 1;
      if (warnings) {
        pushIssue(warnings, {
          code: 'STATION_BERTH_BACKUP_USED',
          severity: 'warning',
          message: `站位延後超過上限，已改派備用「${chosen.route.routeName}」`,
          detail: {
            blockId: block.id,
            timelineRow: block.timelineRow,
            fromRouteId: initialRoute.routeId,
            toRouteId: chosen.route.routeId,
            delaySeconds: finalDelay,
          },
        });
      }
    }

    if (finalDelay > 0) {
      delayedCount += 1;
      if (warnings) {
        pushIssue(warnings, {
          code: 'STATION_BERTH_DELAYED',
          severity: 'warning',
          message: `為避開站位碰撞，已延後 ${finalDelay} 秒（${chosen.route.routeCode ?? chosen.route.routeName}）`,
          detail: {
            blockId: block.id,
            timelineRow: block.timelineRow,
            delaySeconds: finalDelay,
            routeId: chosen.route.routeId,
          },
        });
      }
    }

    const committed = projectBlockBerthWindowsSeconds(block, chosen.route);
    for (const win of committed) booked.push(win);
  }

  return {
    timelines,
    delayedCount,
    backupSwitchedCount,
    unresolvedCount,
  };
}
