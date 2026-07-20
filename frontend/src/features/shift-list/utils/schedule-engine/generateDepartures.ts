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
 * 週期班距時刻生成（每方向獨立脈衝流）。
 * 班距定義：同方向（同路線）相鄰兩班發車間隔。
 */
export const TIMETABLE_GENERATION_ALGORITHM = 'periodic-directional-headway-eat-v1' as const;

export type TimetableGenerationAlgorithm = typeof TIMETABLE_GENERATION_ALGORITHM;

export type HeadwayDeparture = {
  startSecond: number;
  headwaySeconds: number;
  intervalId: string;
  intervalName: string;
};

/** 帶路線（方向）標籤的發車脈衝 */
export type DirectionalHeadwayDeparture = HeadwayDeparture & {
  routeId: string;
  /** 在執行順序中的索引（0 = 第一條路線） */
  routeIndex: number;
};

/**
 * 依各營運時段班距生成「單方向」發車時刻序列（對齊 10 秒格）。
 * 同一時段內以班距遞增；跨時段不強制對齊脈衝，只保證落在時段內。
 *
 * 注意：此函式產出的是**未標方向**的脈衝骨架；真正的班距服務應使用
 * {@link generateDirectionalDeparturesFromHeadway}，為每條正線路線各自複製一份。
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
 * 為每條正線路線（方向）各自生成一條班距脈衝流。
 *
 * 學術定義：班距是**同方向**相鄰兩班的發車間隔。上下行各自獨立維持時段班距，
 * 不可共用一條「全域脈衝」再由車輛輪替決定方向（那會造成 D0030→D0040→D0110 這種跳格）。
 *
 * 各方向脈衝同相位（都從時段起點開始）。跨時段時，新時段第一脈衝不得短於
 * 「上一班同方向 + 新時段班距」，避免 06:56→07:00 這種過渡連發。
 * 開班時若尚無車輛輪到回程方向，該方向的早期脈衝由掛車階段略過。
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
  // 各方向上一班發車秒與當時班距：跨時段銜接用
  const lastDepartureByRouteId = new Map<string, number>();
  const lastHeadwayByRouteId = new Map<string, number>();

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

    for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
      const route = routes[routeIndex]!;
      const last = lastDepartureByRouteId.get(route.routeId);
      // 跨時段：第一脈衝空檔取「舊班距與新班距較大者」，
      // 避免驗證（以上一班時段班距為準）出現 HEADWAY_BELOW_TARGET
      let cursor = intervalStart;
      if (last != null) {
        const prevHeadway = lastHeadwayByRouteId.get(route.routeId) ?? headwaySeconds;
        const transitionGap = Math.max(prevHeadway, headwaySeconds);
        cursor = Math.max(cursor, snapUpToClockAlignSeconds(last + transitionGap));
      }
      while (cursor < pulseEnd) {
        result.push({
          startSecond: cursor,
          headwaySeconds,
          intervalId: interval.id,
          intervalName: interval.name,
          routeId: route.routeId,
          routeIndex,
        });
        lastDepartureByRouteId.set(route.routeId, cursor);
        lastHeadwayByRouteId.set(route.routeId, headwaySeconds);
        cursor += headwaySeconds;
      }
    }
  }

  return result.sort((a, b) => {
    if (a.startSecond !== b.startSecond) return a.startSecond - b.startSecond;
    return a.routeIndex - b.routeIndex;
  });
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
