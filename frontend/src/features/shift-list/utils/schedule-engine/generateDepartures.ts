import {
  parseIntervalStartMinutes,
  parseIntervalEndMinutes,
  type ScheduleTask,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../../../time-templates/types/editor';
import { snapUpToClockAlignSeconds, SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS } from './physics';
import { secondToMinute } from './types';

export const TIMETABLE_GENERATION_ALGORITHM = 'periodic-headway-eat-v1' as const;

export type TimetableGenerationAlgorithm = typeof TIMETABLE_GENERATION_ALGORITHM;

export type HeadwayDeparture = {
  startSecond: number;
  headwaySeconds: number;
  intervalId: string;
  intervalName: string;
};

/**
 * 依各營運時段班距生成發車時刻序列（對齊 10 秒格）。
 * 同一時段內以班距遞增；跨時段不強制對齊脈衝，只保證落在時段內。
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
 * 最早可行時間線（Earliest Available Timeline）掛車。
 * 若所有時間線在發車時刻仍占用，則將發車延後到最早可騰出時刻（10 秒格），且不得超出該發車所屬時段末日。
 */
export function assignDeparturesToEarliestTimeline(args: {
  departures: HeadwayDeparture[];
  scheduleRowCount: number;
  /** 預估一趟占用秒數（尚未指派路線前的近似） */
  estimatedOccupancySeconds: number;
  intervalEndSecondByDepartureStart: Map<number, number>;
}): ScheduleTask[] {
  const {
    departures,
    scheduleRowCount,
    estimatedOccupancySeconds,
    intervalEndSecondByDepartureStart,
  } = args;

  if (scheduleRowCount <= 0 || departures.length === 0) return [];

  const occupancy = Math.max(
    SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
    snapUpToClockAlignSeconds(estimatedOccupancySeconds),
  );
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
    freeAt[chosenRow] = endSecond;

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
