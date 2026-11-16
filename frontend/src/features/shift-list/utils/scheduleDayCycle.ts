/**
 * 班表日循環：一整天 00:00–24:00 無限重複。
 * 內部可用 >1440 分鐘表示跨午夜的延續；鐘面一律 `% 24`（不出現 24:xx）。
 *
 * 甘特顯示（跨夜卡）：
 * - 文字維持真實起迄（例 23:58:10 - 00:04:10）
 * - 條帶<strong>頭尾各畫一張</strong>：日尾 23:58:10 → 24:00:00、
 *   日頭 00:00:00 → 00:04:10，兩張內容完全相同——同一張卡被日界切成兩段，
 *   而不是把整張搬到日頭（那會讓日尾那段時間看起來空著）。
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

/**
 * 甘特條帶位置（與鐘面文字可分離）：
 * - 當日內：照 [start, end) 畫
 * - <strong>跨夜（start &lt; 1440 &lt; end）：頭尾各畫一張</strong>——
 *   日尾那張畫 [start, 24:00]、日頭那張畫 [00:00, wrap(end)]，
 *   兩張的內容完全相同（同一張卡被日界切成兩段，不是兩張不同的卡）。
 *   例：23:55:30 → 00:05:30 會得到 [23:55:30, 24:00:00] 與 [00:00:00, 00:05:30]，
 *   文字一律維持真實起迄「23:55:30 - 00:05:30」。
 * - 整段已過日界：畫 [wrap(start), wrap(end)]（結束可為 1440）
 */
export function splitIntoDayCycleSegments(
  startMinute: number,
  endMinute: number,
): DayCycleSegment[] {
  if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute)) return [];
  if (endMinute <= startMinute + 1e-12) return [];

  const day = SCHEDULE_DAY_MINUTES;

  if (endMinute > day + 1e-12) {
    const visualEnd = wrapScheduleMinute(endMinute);
    // 整段都在日界之後：整體平移回鐘面
    if (startMinute >= day - 1e-12) {
      const visualStart = wrapScheduleMinute(startMinute);
      // wrap(1440)=0 → 結束剛好午夜，視為畫到日界右緣
      const clippedEnd = visualEnd <= 1e-12 ? day : visualEnd;
      if (clippedEnd <= visualStart + 1e-12) return [];
      return [{ startMinute: visualStart, endMinute: clippedEnd }];
    }
    // 自日內跨出：日尾一張 + 日頭一張
    const tailStart = Math.max(0, startMinute);
    const segments: DayCycleSegment[] = [];
    if (day > tailStart + 1e-12) {
      segments.push({ startMinute: tailStart, endMinute: day });
    }
    // 結束剛好落在午夜（wrap=0）時沒有日頭段，只有日尾那張
    if (visualEnd > 1e-12) {
      segments.push({ startMinute: 0, endMinute: visualEnd });
    }
    return segments;
  }

  // 當日內
  if (startMinute >= day - 1e-12) return [];
  const clippedStart = Math.max(0, startMinute);
  const clippedEnd = Math.min(endMinute, day);
  if (clippedEnd <= clippedStart + 1e-12) return [];
  return [{ startMinute: clippedStart, endMinute: clippedEnd }];
}

/**
 * 無限捲動格線（好幾份日拷貝左右並排）專用：同一張卡在「第 copyIndex 份拷貝」上要畫哪幾段。
 *
 * 並排之後，日尾和下一份的日頭在畫面上是相鄰的，所以跨午夜的卡<strong>不在日界切開</strong>：
 * 從日尾一路畫進下一份拷貝，是一張完整的卡（回傳的 endMinute 會超過 1440）。
 * 切成兩段的話，像 23:59:30 發車的班次，日尾那段只剩 30 秒寬，卡面什麼都看不到。
 *
 * 只有整條捲動內容的兩端接不起來：
 * - 最左那份沒有「前一份」可以把卡畫過來，所以補畫日頭那一段；
 * - 最右那份後面沒有東西，日尾那段切在日界。
 * 無限捲動會把視窗拉回中間那份，使用者平常看不到這兩端。
 */
export function resolveDayCopySegments(
  startMinute: number,
  endMinute: number,
  copyIndex: number,
  copyCount: number,
): DayCycleSegment[] {
  const segments = splitIntoDayCycleSegments(startMinute, endMinute);
  if (segments.length !== 2) return segments;
  const [tail, head] = segments as [DayCycleSegment, DayCycleSegment];
  const out: DayCycleSegment[] = [];
  if (copyIndex === 0) out.push(head);
  out.push(
    copyIndex < copyCount - 1
      ? { startMinute: tail.startMinute, endMinute: SCHEDULE_DAY_MINUTES + head.endMinute }
      : tail,
  );
  return out;
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
