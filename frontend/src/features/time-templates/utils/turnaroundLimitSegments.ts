import {
  isMainlineTaskType,
  parseIntervalStartMinutes,
  parseIntervalEndMinutes,
  type ScheduleTask,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../types/editor';

export type TurnaroundLimitSegment = {
  startMinute: number;
  endMinute: number;
  activePassengerCount: number;
  headwaySeconds: number | null;
  /** 車輛折返時限（秒）= 同時段載客橫條數 × 班距 */
  turnaroundLimitSeconds: number | null;
};

function resolveHeadwaySecondsAtMinute(
  minute: number,
  intervals: TimeSlotInterval[],
  attributes: TimeSlotAttribute[],
): number | null {
  for (const interval of intervals) {
    const start = parseIntervalStartMinutes(interval.startTime);
    const end = parseIntervalEndMinutes(interval.endTime);
    if (start == null || end == null || end <= start) continue;
    if (minute < start || minute >= end) continue;
    const attribute = attributes.find((item) => item.id === interval.attributeId);
    if (!attribute) return null;
    const headway = attribute.headwaySeconds;
    return headway != null && headway > 0 ? headway : null;
  }
  return null;
}

function collectAllBoundaryMinutes(
  tasks: ScheduleTask[],
  intervals: TimeSlotInterval[],
): number[] {
  const boundaries = new Set<number>();

  // 1. 收集正線任務的起訖邊界
  for (const task of tasks) {
    if (!isMainlineTaskType(task.taskType)) continue;
    boundaries.add(task.startMinute);
    boundaries.add(task.startMinute + task.durationMinutes);
  }

  // 2. 收集時段屬性的起訖邊界
  for (const slot of intervals) {
    if (slot.isDraft) continue;
    const start = parseIntervalStartMinutes(slot.startTime);
    const end = parseIntervalEndMinutes(slot.endTime);
    if (start != null) boundaries.add(start);
    if (end != null) boundaries.add(end);
  }

  return [...boundaries].sort((a, b) => a - b);
}

function countActivePassengerTasks(
  tasks: ScheduleTask[],
  startMinute: number,
  endMinute: number,
): number {
  let count = 0;
  for (const task of tasks) {
    if (!isMainlineTaskType(task.taskType)) continue;
    const taskEnd = task.startMinute + task.durationMinutes;
    if (task.startMinute < endMinute && taskEnd > startMinute) {
      count += 1;
    }
  }
  return count;
}

/**
 * 依正線任務邊界與營運時段區間聯集切割，並計算每段的已排正線車輛數與建議車輛數。
 */
export function computeTurnaroundLimitSegments(
  tasks: ScheduleTask[],
  intervals: TimeSlotInterval[],
  attributes: TimeSlotAttribute[],
): TurnaroundLimitSegment[] {
  const boundaries = collectAllBoundaryMinutes(tasks, intervals);
  if (boundaries.length < 2) return [];

  const segments: TurnaroundLimitSegment[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const startMinute = boundaries[i]!;
    const endMinute = boundaries[i + 1]!;
    if (endMinute <= startMinute) continue;

    const activePassengerCount = countActivePassengerTasks(tasks, startMinute, endMinute);
    if (activePassengerCount <= 0) continue;

    const sampleMinute = startMinute + (endMinute - startMinute) / 2;
    const headwaySeconds = resolveHeadwaySecondsAtMinute(sampleMinute, intervals, attributes);
    const turnaroundLimitSeconds =
      headwaySeconds != null ? activePassengerCount * headwaySeconds : null;

    segments.push({
      startMinute,
      endMinute,
      activePassengerCount,
      headwaySeconds,
      turnaroundLimitSeconds,
    });
  }

  return segments;
}

export function formatTurnaroundLimitLabel(
  seconds: number | null,
  vehicleCount?: number | null,
): string {
  if (seconds == null || seconds <= 0) return '—';
  if (vehicleCount != null && vehicleCount > 0) {
    return `${seconds}秒, ${vehicleCount}台車`;
  }
  return `${seconds}秒`;
}

export function resolveStrictestTurnaroundLimitSeconds(
  tasks: ScheduleTask[],
  intervals: TimeSlotInterval[],
  attributes: TimeSlotAttribute[],
): number | null {
  const segments = computeTurnaroundLimitSegments(tasks, intervals, attributes);
  let min: number | null = null;
  for (const segment of segments) {
    if (segment.turnaroundLimitSeconds == null || segment.turnaroundLimitSeconds <= 0) {
      continue;
    }
    if (min == null || segment.turnaroundLimitSeconds < min) {
      min = segment.turnaroundLimitSeconds;
    }
  }
  return min;
}
