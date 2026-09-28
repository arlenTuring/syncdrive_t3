/**
 * 轉折點錯開：一趟移動會依序經過幾個轉折點，整趟出發時刻平移 shift 秒，每個經過時刻也等量平移。
 * 找一個落在 [minShift, maxShift] 內、讓每個經過時刻都跟別列車的預約差開至少 bufferSeconds 的
 * 最小位移。
 *
 * 求解與報告共用這裡：先前報告用的是「沒加設施位移」的時刻，求解用的是加過的時刻，兩邊對不上，
 * 使用者看到「可挪 119 秒、需要差開 60 秒」卻排不出，無從判斷（其實是別的預約把剩下的範圍
 * 佔滿了）。現在報告列出搜尋上下界、每個點實際檢查的時刻、落在搜尋窗裡的所有預約。
 *
 * 日循環：兩個時刻的間距取繞一圈的最短距離（23:59:50 與 00:00:10 差 20 秒）。
 */

export type JunctionPoint = { nodeId: string; instant: number };
export type JunctionReservation = {
  nodeId: string;
  instant: number;
  timelineRow: number;
  /** 呼叫端事先保留、那一列還沒真的排出移動的時刻 */
  reserved?: boolean;
};

export type JunctionShiftQuery = {
  /** 已經加上其他位移（例如設施造成的位移）之後的經過時刻 */
  points: ReadonlyArray<JunctionPoint | null>;
  bookings: ReadonlyArray<JunctionReservation>;
  timelineRow: number;
  minShift: number;
  maxShift: number;
  bufferSeconds: number;
  daySeconds: number;
  /** 時刻刻度（秒）；對齊的位移優先 */
  alignSeconds: number;
};

export function cyclicGapSeconds(a: number, b: number, daySeconds: number): number {
  const diff = Math.abs((((a - b) % daySeconds) + daySeconds) % daySeconds);
  return Math.min(diff, daySeconds - diff);
}

function activePoints(points: ReadonlyArray<JunctionPoint | null>): JunctionPoint[] {
  return points.filter((point): point is JunctionPoint => point != null);
}

function pointIsFree(query: JunctionShiftQuery, point: JunctionPoint, shift: number): boolean {
  return !query.bookings.some((booking) =>
    booking.nodeId === point.nodeId
    && booking.timelineRow !== query.timelineRow
    && cyclicGapSeconds(booking.instant, point.instant + shift, query.daySeconds) < query.bufferSeconds - 1e-9);
}

/** 最小可行位移；範圍內找不到回 null。buffer ≤ 0 或沒有點時回 0 */
export function solveJunctionShift(query: JunctionShiftQuery): number | null {
  if (query.bufferSeconds <= 0) return 0;
  const points = activePoints(query.points);
  if (points.length === 0) return 0;
  const inRange = (shift: number) => shift >= query.minShift - 1e-9 && shift <= query.maxShift + 1e-9;
  const allFree = (shift: number) => points.every((point) => pointIsFree(query, point, shift));
  if (inRange(0) && allFree(0)) return 0;

  // 候選：搜尋區間兩端、每筆預約保護區間的前後緣（日循環上的等價位置），以及它們對齊刻度後的值。
  // 可行區間的端點一定是其中之一，所以最小位移不會漏掉。
  const raw = new Set<number>([query.minShift, query.maxShift]);
  for (const point of points) {
    for (const booking of query.bookings) {
      if (booking.nodeId !== point.nodeId || booking.timelineRow === query.timelineRow) continue;
      for (const edge of [booking.instant - query.bufferSeconds, booking.instant + query.bufferSeconds]) {
        for (const wrap of [-query.daySeconds, 0, query.daySeconds]) raw.add(edge + wrap - point.instant);
      }
    }
  }
  const align = query.alignSeconds > 0 ? query.alignSeconds : 1;
  const alignedOf = (value: number) => [Math.ceil(value / align) * align, Math.floor(value / align) * align];
  const aligned = new Set<number>();
  for (const value of raw) for (const snapped of alignedOf(value)) aligned.add(snapped);

  const pick = (values: Iterable<number>): number | null => {
    let best: number | null = null;
    for (const shift of values) {
      if (!inRange(shift) || !allFree(shift)) continue;
      if (best === null || Math.abs(shift) < Math.abs(best) || (Math.abs(shift) === Math.abs(best) && shift > best)) best = shift;
    }
    return best;
  };
  // 對齊刻度的優先；刻度上都不行才用未對齊的邊界值
  return pick(aligned) ?? pick(raw);
}

export type JunctionBlockDiagnosis = {
  minShift: number;
  maxShift: number;
  bufferSeconds: number;
  /** 每個點實際檢查的時刻（已含外部位移），以及搜尋窗內所有別列車預約 */
  points: Array<{ nodeId: string; instant: number; bookingsInWindow: JunctionReservation[] }>;
};

/** 找不到位移時的證據：搜尋上下界、每個點的時刻、落在「時刻＋搜尋範圍±間隔」內的所有預約 */
export function diagnoseJunctionBlock(query: JunctionShiftQuery): JunctionBlockDiagnosis {
  return {
    minShift: query.minShift,
    maxShift: query.maxShift,
    bufferSeconds: query.bufferSeconds,
    points: activePoints(query.points).map((point) => {
      const low = point.instant + query.minShift - query.bufferSeconds;
      const high = point.instant + query.maxShift + query.bufferSeconds;
      const center = (low + high) / 2;
      const half = (high - low) / 2;
      return {
        nodeId: point.nodeId,
        instant: point.instant,
        bookingsInWindow: query.bookings
          .filter((booking) =>
            booking.nodeId === point.nodeId
            && booking.timelineRow !== query.timelineRow
            && cyclicGapSeconds(booking.instant, center, query.daySeconds) <= half + 1e-9)
          .sort((a, b) => a.instant - b.instant),
      };
    }),
  };
}
