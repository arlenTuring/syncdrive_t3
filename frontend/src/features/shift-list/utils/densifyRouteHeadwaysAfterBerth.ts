/**
 * 站位延後後，同路線跨車發車若被推得過疏（遠超目標班距），
 * 在不踩站位／同列前一班的前提下把後車往前拉回，拉高實際 PPHPD。
 */
import type { ShiftScheduleSelectedRoute } from '../types/create';
import { resolveRouteForBlock } from './buildBlockStationDepartures';
import {
  resolveInterTripGapSeconds,
  shouldIncludeRecoveryForRouteSwitch,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
  snapUpToClockAlignSeconds,
} from './schedule-engine/physics';
import type {
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
} from './schedule-engine/types';
import { minuteToSecond, secondToMinute } from './schedule-engine/types';
import { earliestStartPastBlockerOnDayCycle } from './scheduleDayCycle';
import {
  projectProtectedBerthWindowsSeconds,
  resolveBerthClearDelaySeconds,
  type BerthProtectionContext,
  type BerthWindowSec,
} from './stationBerthConstraint';
import { resolvePairHeadwaySeconds } from './schedule-engine/validate';
import type { TimeSlotAttribute, TimeSlotInterval } from '../../time-templates/types/editor';

const DENSIFY_SLACK_SECONDS = 20;

function occupancySecondsOf(block: GeneratedScheduleBlock): number {
  return Math.max(
    SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
    minuteToSecond(block.plannedEndMinute) - minuteToSecond(block.plannedStartMinute),
  );
}

function bookAllExcept(
  timelines: GeneratedSchedulePlan['timelines'],
  selectedRoutes: ShiftScheduleSelectedRoute[],
  exceptId: string,
  protection: BerthProtectionContext,
): BerthWindowSec[] {
  const booked: BerthWindowSec[] = [];
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'passenger') continue;
      if (block.id === exceptId) continue;
      const route = resolveRouteForBlock(block, selectedRoutes);
      if (!route) continue;
      for (const win of projectProtectedBerthWindowsSeconds(block, route, protection)) {
        booked.push(win);
      }
    }
  }
  return booked;
}

function sameRowPreviousPassenger(
  timelines: GeneratedSchedulePlan['timelines'],
  block: GeneratedScheduleBlock,
): GeneratedScheduleBlock | null {
  const row = timelines.find((t) => t.row === block.timelineRow);
  if (!row) return null;
  const passengers = [...row.blocks]
    .filter((b) => b.taskType === 'passenger')
    .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
  const index = passengers.findIndex((b) => b.id === block.id);
  if (index <= 0) return null;
  return passengers[index - 1] ?? null;
}

function isYardBlock(block: GeneratedScheduleBlock): boolean {
  if (block.source !== 'template_bar') return false;
  return (
    block.taskType === 'charging'
    || block.taskType === 'servicing'
    || block.taskType === 'inspection'
    || block.taskType === 'standby'
  );
}

/** 同列、候選發車時間之前仍未結束的整備，不得把正線往前拉進其尾巴（含跨夜晨段）。 */
export function sameRowPrecedingYardEndSecond(
  timelines: GeneratedSchedulePlan['timelines'],
  block: GeneratedScheduleBlock,
  candidateStartSecond: number,
): number | null {
  const row = timelines.find((t) => t.row === block.timelineRow);
  if (!row) return null;
  const candidateStartMinute = secondToMinute(candidateStartSecond);
  // 用極短占用探測候選發車是否仍坐落整備區間內
  const probeEndMinute = candidateStartMinute + 1 / 60;
  let latestEnd: number | null = null;
  for (const other of row.blocks) {
    if (other.id === block.id) continue;
    if (!isYardBlock(other)) continue;
    const clearMinute = earliestStartPastBlockerOnDayCycle(
      candidateStartMinute,
      probeEndMinute,
      other.plannedStartMinute,
      other.plannedEndMinute,
    );
    if (clearMinute == null) continue;
    const yardEndSecond = minuteToSecond(clearMinute);
    latestEnd =
      latestEnd == null ? yardEndSecond : Math.max(latestEnd, yardEndSecond);
  }
  return latestEnd;
}

/**
 * 把同 routeId、跨時間線的正線發車往目標班距靠攏（只往前拉、不往後推）。
 */
export function densifyRouteHeadwaysAfterBerth(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  minimumRecoveryTimeSeconds?: number;
  /** 碰撞保護時間（秒）；預設 0＝維持舊行為 */
  collisionProtectionSeconds?: number;
}): GeneratedSchedulePlan['timelines'] {
  const {
    selectedRoutes,
    intervals,
    attributes,
    minimumRecoveryTimeSeconds = 0,
    collisionProtectionSeconds = 0,
  } = args;
  const timelines = args.timelines.map((timeline) => ({
    ...timeline,
    blocks: timeline.blocks.map((block) => ({ ...block })),
  }));
  const protection: BerthProtectionContext = {
    collisionProtectionSeconds,
    timelines,
  };

  const byRoute = new Map<string, GeneratedScheduleBlock[]>();
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'passenger') continue;
      // 同 repairRouteHeadwaysBelowTarget：整備後的調度營運班次不受班距約束，
      // 不可為了「把班距拉回目標」而把它往前拉或往後推。
      // 它仍以站位預約／同列鄰居身分限制其他班次。
      if (block.source !== 'template_bar') continue;
      const routeId = block.routeId?.trim();
      if (!routeId) continue;
      const list = byRoute.get(routeId) ?? [];
      list.push(block);
      byRoute.set(routeId, list);
    }
  }

  for (const [, blocks] of byRoute) {
    blocks.sort(
      (a, b) =>
        a.plannedStartMinute - b.plannedStartMinute
        || a.timelineRow - b.timelineRow
        || a.id.localeCompare(b.id),
    );
    for (let i = 1; i < blocks.length; i += 1) {
      const earlier = blocks[i - 1]!;
      const later = blocks[i]!;
      const earlierStart = minuteToSecond(earlier.plannedStartMinute);
      const laterStart = minuteToSecond(later.plannedStartMinute);
      const target =
        resolvePairHeadwaySeconds(
          secondToMinute(earlierStart),
          secondToMinute(laterStart),
          intervals,
          attributes,
        )
        ?? null;
      if (target == null || target <= 0) continue;
      const idealStart = snapUpToClockAlignSeconds(earlierStart + target);
      if (laterStart <= idealStart + DENSIFY_SLACK_SECONDS) continue;

      const route = resolveRouteForBlock(later, selectedRoutes);
      if (!route) continue;

      const occupied = occupancySecondsOf(later);
      let candidate = idealStart;

      const prevSameRow = sameRowPreviousPassenger(timelines, later);
      if (prevSameRow) {
        const prevRoute = resolveRouteForBlock(prevSameRow, selectedRoutes);
        if (prevRoute) {
          const gap = resolveInterTripGapSeconds({
            minimumRecoveryTimeSeconds,
            previousRouteSwitchBufferSeconds: prevRoute.switchBufferAfterSeconds,
            isRouteSwitch: prevRoute.routeId !== route.routeId,
            includeRecovery: shouldIncludeRecoveryForRouteSwitch({
              previousRoute: prevRoute,
              nextRoute: route,
              rotationRoutes: selectedRoutes,
            }),
            previousRoute: prevRoute,
            nextRoute: route,
          });
          candidate = Math.max(
            candidate,
            snapUpToClockAlignSeconds(
              minuteToSecond(prevSameRow.plannedEndMinute) + gap,
            ),
          );
        }
      }
      // 不得把正線往前拉進行前／充電／保養／機動尾巴
      const yardEnd = sameRowPrecedingYardEndSecond(timelines, later, candidate);
      if (yardEnd != null) {
        candidate = Math.max(candidate, snapUpToClockAlignSeconds(yardEnd));
      }
      if (candidate >= laterStart - 1e-9) continue;

      const probe = {
        ...later,
        plannedStartMinute: secondToMinute(candidate),
        plannedEndMinute: secondToMinute(candidate + occupied),
      };
      const booked = bookAllExcept(timelines, selectedRoutes, later.id, protection);
      const windows = projectProtectedBerthWindowsSeconds(probe, route, protection);
      const berthDelay = resolveBerthClearDelaySeconds(windows, booked);
      const finalStart = snapUpToClockAlignSeconds(candidate + berthDelay);
      if (finalStart >= laterStart - 1e-9) continue;

      later.plannedStartMinute = secondToMinute(finalStart);
      later.plannedEndMinute = secondToMinute(finalStart + occupied);
    }
  }

  return timelines;
}
