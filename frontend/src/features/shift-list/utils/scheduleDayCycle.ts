/**
 * 班表日循環：一整天 00:00–24:00 無限重複。
 * 內部可用 >1440 分鐘表示跨午夜的延續；鐘面一律 `% 24`（不出現 24:xx）。
 *
 * 甘特顯示（跨夜卡）：
 * - 文字維持真實起迄（例 23:58:10 - 00:04:10）
 * - 條帶改畫在日頭：00:00 → 實際結束（例畫到 00:04:10），長度不必等於整趟占用
 */

/** 一日長度（分鐘）＝ 24 × 60 */
export const SCHEDULE_DAY_MINUTES = 24 * 60;

export type DayCycleSegment = {
  /** 落在當日甘特上的起點 [0, 1440) */
  startMinute: number;
  /** 落在當日甘特上的終點 (0, 1440]；等於 1440 表示碰到日界右緣 */
  endMinute: number;
};

/** 將任意分鐘對齊到 [0, 1440) 的一日鐘面 */
export function wrapScheduleMinute(minute: number): number {
  const day = SCHEDULE_DAY_MINUTES;
  if (!Number.isFinite(minute)) return 0;
  const m = minute % day;
  return m < 0 ? m + day : m;
}

/**
 * 鐘面顯示 HH:MM:SS（時針 00–23，午夜後顯示 00:xx，不出現 24:xx）。
 */
export function formatScheduleClockHms(minute: number): string {
  const totalSeconds = Math.max(0, Math.round(minute * 60));
  const daySeconds = SCHEDULE_DAY_MINUTES * 60;
  const wrapped = ((totalSeconds % daySeconds) + daySeconds) % daySeconds;
  const hh = Math.floor(wrapped / 3600);
  const mm = Math.floor((wrapped % 3600) / 60);
  const ss = wrapped % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function formatScheduleClockHm(minute: number): string {
  const wrapped = wrapScheduleMinute(Math.floor(minute));
  const hh = Math.floor(wrapped / 60);
  const mm = Math.round(wrapped % 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function formatScheduleClockRangeHms(
  startMinute: number,
  endMinute: number,
): string {
  return `${formatScheduleClockHms(startMinute)} - ${formatScheduleClockHms(endMinute)}`;
}

/** 結束時刻是否跨越（或落在）日界之後 */
export function crossesScheduleDayBoundary(
  startMinute: number,
  endMinute: number,
): boolean {
  return endMinute > SCHEDULE_DAY_MINUTES + 1e-12;
}

/**
 * 甘特條帶位置（與鐘面文字可分離）：
 * - 當日內：照 [start, end) 畫
 * - 跨夜（end > 1440）：一律移到日頭，從 00:00 畫到 wrap(end)
 * - 整段已過日界：畫 [wrap(start), wrap(end)]（結束可為 1440）
 */
export function splitIntoDayCycleSegments(
  startMinute: number,
  endMinute: number,
): DayCycleSegment[] {
  if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute)) return [];
  if (endMinute <= startMinute + 1e-12) return [];

  const day = SCHEDULE_DAY_MINUTES;

  // 跨夜／日界後：條帶改放在 00:00 之後，長度只涵蓋「午夜後到結束」
  if (endMinute > day + 1e-12) {
    const visualEnd = wrapScheduleMinute(endMinute);
    // wrap(1440)=0 → 結束剛好午夜：不畫（無午夜後長度）
    if (visualEnd <= 1e-12) return [];
    if (startMinute >= day - 1e-12) {
      const visualStart = wrapScheduleMinute(startMinute);
      if (visualEnd <= visualStart + 1e-12) return [];
      return [{ startMinute: visualStart, endMinute: visualEnd }];
    }
    // 自日內跨出：從 00:00 畫到結束
    return [{ startMinute: 0, endMinute: visualEnd }];
  }

  // 當日內
  if (startMinute >= day - 1e-12) return [];
  const clippedStart = Math.max(0, startMinute);
  const clippedEnd = Math.min(endMinute, day);
  if (clippedEnd <= clippedStart + 1e-12) return [];
  return [{ startMinute: clippedStart, endMinute: clippedEnd }];
}

/**
 * 引擎占用檢查：把 blocker（通常落在 [0,1440]）貼到 nearMinute 附近 ±1 日，
 * 得到連續時間軸上的拷貝（處理「跨夜保養拆成晚段＋晨段」時，午夜後正線仍撞晨段）。
 */
export function continuousDayCopiesNear(
  startMinute: number,
  endMinute: number,
  nearMinute: number,
): DayCycleSegment[] {
  if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute)) return [];
  if (endMinute <= startMinute + 1e-12) return [];
  const day = SCHEDULE_DAY_MINUTES;
  const baseDayIndex = Math.floor(nearMinute / day);
  const out: DayCycleSegment[] = [];
  for (const offset of [-1, 0, 1]) {
    const dayIndex = baseDayIndex + offset;
    out.push({
      startMinute: startMinute + dayIndex * day,
      endMinute: endMinute + dayIndex * day,
    });
  }
  return out;
}

/** 連續時間軸上兩段是否重疊（半開） */
export function continuousIntervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart + 1e-9 < bEnd && bStart + 1e-9 < aEnd;
}

/**
 * 若 occupant 在連續時間與 blocker 任一 ±1 日拷貝重疊，
 * 回傳必須≥的開始分鐘（blocker 拷貝結束）；無衝突回 null。
 */
export function earliestStartPastBlockerOnDayCycle(
  occupantStartMinute: number,
  occupantEndMinute: number,
  blockerStartMinute: number,
  blockerEndMinute: number,
): number | null {
  let earliest: number | null = null;
  for (const copy of continuousDayCopiesNear(
    blockerStartMinute,
    blockerEndMinute,
    occupantStartMinute,
  )) {
    if (
      !continuousIntervalsOverlap(
        occupantStartMinute,
        occupantEndMinute,
        copy.startMinute,
        copy.endMinute,
      )
    ) {
      continue;
    }
    earliest =
      earliest == null
        ? copy.endMinute
        : Math.max(earliest, copy.endMinute);
  }
  return earliest;
}

/** 兩班在日循環連續時間上是否衝突（供 validate） */
export function blocksConflictOnDayCycle(
  aStartMinute: number,
  aEndMinute: number,
  bStartMinute: number,
  bEndMinute: number,
): boolean {
  if (continuousIntervalsOverlap(aStartMinute, aEndMinute, bStartMinute, bEndMinute)) {
    return true;
  }
  // a 以自身為中心找 b 拷貝；再對稱一次（a 在 [0,360]、b 在 [1440,…]）
  if (
    earliestStartPastBlockerOnDayCycle(
      aStartMinute,
      aEndMinute,
      bStartMinute,
      bEndMinute,
    ) != null
  ) {
    return true;
  }
  return (
    earliestStartPastBlockerOnDayCycle(
      bStartMinute,
      bEndMinute,
      aStartMinute,
      aEndMinute,
    ) != null
  );
}
