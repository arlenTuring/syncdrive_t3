import {
  getInactiveRangesWithinBar,
  parseIntervalMinuteRanges,
  type MinuteRange,
  type TimeSlotInterval,
} from '../../time-templates/types/editor';

const DAY_START_MINUTE = 0;
const DAY_END_MINUTE = 24 * 60;

/**
 * 全日（00:00–24:00）中未排定任何時間屬性（營運時段）的空時段。
 * 有空時段時，班表 Step 3 需填「空時段正線讓渡餘裕」。
 */
export function listEmptyAttributeMinuteRanges(
  intervals: TimeSlotInterval[],
): MinuteRange[] {
  return getInactiveRangesWithinBar(
    DAY_START_MINUTE,
    DAY_END_MINUTE,
    parseIntervalMinuteRanges(intervals),
  );
}

export function templateHasEmptyAttributePeriods(
  intervals: TimeSlotInterval[],
): boolean {
  return listEmptyAttributeMinuteRanges(intervals).length > 0;
}

/** 緊接正線視窗開始、結束於 windowStartMinute 的空時段（若有） */
export function findEmptyRangeEndingAt(
  emptyRanges: MinuteRange[],
  windowStartMinute: number,
  epsilon = 1e-9,
): MinuteRange | null {
  return (
    emptyRanges.find(
      (range) =>
        range.end >= windowStartMinute - epsilon
        && range.end <= windowStartMinute + epsilon
        && range.start < windowStartMinute,
    ) ?? null
  );
}

/** 緊接正線視窗結束、開始於 windowEndMinute 的空時段（若有） */
export function findEmptyRangeStartingAt(
  emptyRanges: MinuteRange[],
  windowEndMinute: number,
  epsilon = 1e-9,
): MinuteRange | null {
  return (
    emptyRanges.find(
      (range) =>
        range.start >= windowEndMinute - epsilon
        && range.start <= windowEndMinute + epsilon
        && range.end > windowEndMinute,
    ) ?? null
  );
}
