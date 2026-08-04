import {
  parseIntervalStartMinutes,
  parseIntervalEndMinutes,
  type ScheduleTask,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../../types/create';
import {
  findEmptyRangeStartingAt,
  listEmptyAttributeMinuteRanges,
} from '../emptyAttributeIntervals';
import { snapUpToClockAlignSeconds, SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS } from './physics';
import { secondToMinute } from './types';

/**
 * 週期班距時刻生成（完整交路起班脈衝）。
 *
 * 一個脈衝代表一台車開始一個完整合法交路，不是每個 route leg 各自一個脈衝。
 * 各服務方向的後續發車由同一交路內的 route chain 自然展開。
 */
export const TIMETABLE_GENERATION_ALGORITHM = 'periodic-cycle-headway-v2' as const;

export type TimetableGenerationAlgorithm = typeof TIMETABLE_GENERATION_ALGORITHM;

export type HeadwayDeparture = {
  startSecond: number;
  headwaySeconds: number;
  intervalId: string;
  intervalName: string;
};

/** 帶交路起始 route 標籤的發車脈衝 */
export type DirectionalHeadwayDeparture = HeadwayDeparture & {
  routeId: string;
  /** 在執行順序中的索引（0 = 第一條路線） */
  routeIndex: number;
};

/**
 * 依各營運時段班距生成「單方向」發車時刻序列（對齊 10 秒格）。
 * 同一時段內以班距遞增；跨時段不強制對齊脈衝，只保證落在時段內。
 *
 * 注意：此函式產出的是未標交路的脈衝骨架；真正排班使用
 * {@link generateDirectionalDeparturesFromHeadway} 綁定交路起始 route。
 */
export function generateDeparturesFromHeadway(args: {
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
}): HeadwayDeparture[] {
  const { intervals, attributes } = args;
  const attrById = new Map(attributes.map((attr) => [attr.id, attr] as const));
  const departures: HeadwayDeparture[] = [];

  const sortedIntervals = [...intervals].sort((a, b) => {
    const aStart = parseIntervalStartMinutes(a.startTime) ?? 0;
    const bStart = parseIntervalStartMinutes(b.startTime) ?? 0;
    return aStart - bStart;
  });

  for (const interval of sortedIntervals) {
    const startMinute = parseIntervalStartMinutes(interval.startTime);
    const endMinute = parseIntervalEndMinutes(interval.endTime);
    if (startMinute == null || endMinute == null || endMinute <= startMinute) continue;

    const attribute = attrById.get(interval.attributeId);
    const headwayRaw = attribute?.headwaySeconds;
    if (headwayRaw == null || headwayRaw <= 0) continue;

    const headwaySeconds = snapUpToClockAlignSeconds(headwayRaw);
    let cursor = snapUpToClockAlignSeconds(Math.round(startMinute * 60));
    const endSecond = Math.round(endMinute * 60);

    while (cursor < endSecond) {
      departures.push({
        startSecond: cursor,
        headwaySeconds,
        intervalId: interval.id,
        intervalName: interval.name,
      });
      cursor += headwaySeconds;
    }
  }

  return departures.sort((a, b) => a.startSecond - b.startSecond);
}

/**
 * 生成完整交路的起班脈衝。
 *
 * 一個完整交路會沿 Step 4 successor chain 依序跑完所有 route legs；
 * 同服務方向的後續 route 不是新班，而是同一班的續行。下一個起班脈衝再由
 * 另一台可用車（或已完成上一輪的車）承接，因此所有方向的實際發車會維持同一
 * 基準班距，且不會把 NT→TS 之類的續行重複當成兩班。
 *
 * 跨時段時，新時段第一脈衝不得短於「上一班 + max(舊班距, 新班距)」。
 */
export function generateDirectionalDeparturesFromHeadway(args: {
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  /** 已依 executionOrder 排序的正線路線 */
  passengerRoutes: ShiftScheduleSelectedRoute[];
  /**
   * 空時段正線讓渡餘裕：只可把班距脈衝向後延伸進「相鄰空時段開頭」
   * （正線結束後收尾），不可提前占用空時段尾端。
   */
  emptyIntervalMainlineSlackSeconds?: number;
}): DirectionalHeadwayDeparture[] {
  const {
    intervals,
    attributes,
    passengerRoutes: routes,
    emptyIntervalMainlineSlackSeconds = 0,
  } = args;
  if (routes.length === 0) return [];

  const attrById = new Map(attributes.map((attr) => [attr.id, attr] as const));
  const sortedIntervals = [...intervals].sort((a, b) => {
    const aStart = parseIntervalStartMinutes(a.startTime) ?? 0;
    const bStart = parseIntervalStartMinutes(b.startTime) ?? 0;
    return aStart - bStart;
  });
  const emptyRanges =
    emptyIntervalMainlineSlackSeconds > 0
      ? listEmptyAttributeMinuteRanges(intervals)
      : [];

  const result: DirectionalHeadwayDeparture[] = [];
  const startRoute = routes[0]!;
  let lastDepartureSecond: number | null = null;
  let lastHeadwaySeconds: number | null = null;

  for (const interval of sortedIntervals) {
    const startMinute = parseIntervalStartMinutes(interval.startTime);
    const endMinute = parseIntervalEndMinutes(interval.endTime);
    if (startMinute == null || endMinute == null || endMinute <= startMinute) continue;

    const attribute = attrById.get(interval.attributeId);
    const headwayRaw = attribute?.headwaySeconds;
    if (headwayRaw == null || headwayRaw <= 0) continue;

    const headwaySeconds = snapUpToClockAlignSeconds(headwayRaw);
    const intervalStart = snapUpToClockAlignSeconds(Math.round(startMinute * 60));
    const intervalEnd = Math.round(endMinute * 60);

    let pulseEnd = intervalEnd;
    if (emptyIntervalMainlineSlackSeconds > 0 && emptyRanges.length > 0) {
      const emptyAfter = findEmptyRangeStartingAt(emptyRanges, endMinute);
      if (emptyAfter) {
        pulseEnd = Math.min(
          Math.round(emptyAfter.end * 60),
          intervalEnd + emptyIntervalMainlineSlackSeconds,
        );
      }
    }

    let cursor = intervalStart;
    if (lastDepartureSecond != null) {
      const transitionGap = Math.max(
        lastHeadwaySeconds ?? headwaySeconds,
        headwaySeconds,
      );
      cursor = Math.max(
        cursor,
        snapUpToClockAlignSeconds(lastDepartureSecond + transitionGap),
      );
    }
    while (cursor < pulseEnd) {
      result.push({
        startSecond: cursor,
        headwaySeconds,
        intervalId: interval.id,
        intervalName: interval.name,
        routeId: startRoute.routeId,
        routeIndex: 0,
      });
      lastDepartureSecond = cursor;
      lastHeadwaySeconds = headwaySeconds;
      cursor += headwaySeconds;
    }
  }

  return result.sort((a, b) => a.startSecond - b.startSecond);
}

/**
 * 最早可行時間線（Earliest Available Timeline）掛車。
 * 若所有時間線在發車時刻仍占用，則將發車延後到最早可騰出時刻（10 秒格），且不得超出該發車所屬時段末日。
 *
 * @deprecated 僅供 headway 模式舊路徑；template 模式改走方向感知掛車。
 */
export function assignDeparturesToEarliestTimeline(args: {
  departures: HeadwayDeparture[];
  scheduleRowCount: number;
  /** 預估一趟占用秒數（尚未指派路線前的近似） */
  estimatedOccupancySeconds: number;
  intervalEndSecondByDepartureStart: Map<number, number>;
  /**
   * 同車下一趟最早可發車＝本趟結束 + 此空檔。
   * 應含最低恢復；多路線時另加換線緩衝近似值。
   */
  interTripGapSeconds?: number;
}): ScheduleTask[] {
  const {
    departures,
    scheduleRowCount,
    estimatedOccupancySeconds,
    intervalEndSecondByDepartureStart,
    interTripGapSeconds = 0,
  } = args;

  if (scheduleRowCount <= 0 || departures.length === 0) return [];

  const occupancy = Math.max(
    SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
    snapUpToClockAlignSeconds(estimatedOccupancySeconds),
  );
  const gapAfterTrip = Math.max(0, Math.round(interTripGapSeconds));
  /** freeAt = 該時間線下一趟最早可發車時刻（已含結束後空檔） */
  const freeAt = Array.from({ length: scheduleRowCount }, () => 0);
  const tasks: ScheduleTask[] = [];

  for (let index = 0; index < departures.length; index += 1) {
    const departure = departures[index]!;
    let startSecond = departure.startSecond;
    const intervalEnd =
      intervalEndSecondByDepartureStart.get(departure.startSecond)
      ?? Number.POSITIVE_INFINITY;

    let chosenRow = -1;
    let bestFree = Number.POSITIVE_INFINITY;

    for (let row = 0; row < scheduleRowCount; row += 1) {
      if (freeAt[row]! <= startSecond && freeAt[row]! < bestFree) {
        bestFree = freeAt[row]!;
        chosenRow = row;
      }
    }

    if (chosenRow < 0) {
      // 局部修復：延後到最早可騰出的時間線
      let earliestFree = Number.POSITIVE_INFINITY;
      let earliestRow = 0;
      for (let row = 0; row < scheduleRowCount; row += 1) {
        if (freeAt[row]! < earliestFree) {
          earliestFree = freeAt[row]!;
          earliestRow = row;
        }
      }
      startSecond = snapUpToClockAlignSeconds(Math.max(startSecond, earliestFree));
      if (startSecond >= intervalEnd) {
        // 無法排進此時段，略過此發車
        continue;
      }
      chosenRow = earliestRow;
    }

    const endSecond = startSecond + occupancy;
    freeAt[chosenRow] = snapUpToClockAlignSeconds(endSecond + gapAfterTrip);

    tasks.push({
      id: `auto-pax-${index + 1}-${startSecond}`,
      rowIndex: chosenRow + 1,
      taskType: 'passenger',
      startMinute: secondToMinute(startSecond),
      durationMinutes: Math.max(1, occupancy / 60),
      label: '正線',
    });
  }

  return tasks;
}

/** 建立「理想發車時刻 → 所屬時段結束秒」對照，供延後時不跨出時段 */
export function buildIntervalEndSecondByDepartureStart(
  departures: HeadwayDeparture[],
  intervals: TimeSlotInterval[],
): Map<number, number> {
  const endByIntervalId = new Map<string, number>();
  for (const interval of intervals) {
    const endMinute = parseIntervalEndMinutes(interval.endTime);
    if (endMinute == null) continue;
    endByIntervalId.set(interval.id, Math.round(endMinute * 60));
  }

  const map = new Map<number, number>();
  for (const departure of departures) {
    map.set(
      departure.startSecond,
      endByIntervalId.get(departure.intervalId) ?? Number.POSITIVE_INFINITY,
    );
  }
  return map;
}
