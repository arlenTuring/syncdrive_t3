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

/**
 * 經過某個點：instant 是到達，until 是離開（停靠、等候）；沒有 until＝一閃而過。
 * 載客班次在月台的停靠、終點折返都是一段區間，不能只當一個瞬間。
 */
export type JunctionPoint = { nodeId: string; instant: number; until?: number };
export type JunctionReservation = {
  nodeId: string;
  instant: number;
  /** 離開這個點的時刻；沒有＝一閃而過 */
  until?: number;
  timelineRow: number;
  /** 呼叫端事先保留、那一列還沒真的排出移動的時刻 */
  reserved?: boolean;
};

/**
 * 會跟這筆經過相撞的預約鍵。點跟自己比；雙向路段（seg:…#f／#r）只跟<strong>反方向</strong>比——
 * 單線防的是對開，同方向跟車由兩端點各自錯開保證先進先出。
 */
export function junctionClashKey(nodeId: string): string {
  if (!nodeId.startsWith('seg:')) return nodeId;
  if (nodeId.endsWith('#f')) return `${nodeId.slice(0, -2)}#r`;
  if (nodeId.endsWith('#r')) return `${nodeId.slice(0, -2)}#f`;
  return nodeId;
}

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

/**
 * 兩段佔用（日循環）是否貼得比 buffer 近：前一台離開到後一台到達至少要差開 buffer。
 * 兩段都是瞬間時，等同 |a − b| < buffer（舊的單點規則）。
 */
export function occupanciesClash(
  aFrom: number,
  aUntil: number,
  bFrom: number,
  bUntil: number,
  bufferSeconds: number,
  daySeconds: number,
): boolean {
  const base = Math.round((aFrom - bFrom) / daySeconds) * daySeconds;
  for (const wrap of [base - daySeconds, base, base + daySeconds]) {
    if (aFrom < bUntil + wrap + bufferSeconds - 1e-9 && bFrom + wrap < aUntil + bufferSeconds - 1e-9) return true;
  }
  return false;
}

function pointIsFree(query: JunctionShiftQuery, point: JunctionPoint, shift: number): boolean {
  const clashKey = junctionClashKey(point.nodeId);
  return !query.bookings.some((booking) =>
    booking.nodeId === clashKey
    && booking.timelineRow !== query.timelineRow
    && occupanciesClash(
      point.instant + shift,
      (point.until ?? point.instant) + shift,
      booking.instant,
      booking.until ?? booking.instant,
      query.bufferSeconds,
      query.daySeconds,
    ));
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
      if (booking.nodeId !== junctionClashKey(point.nodeId) || booking.timelineRow === query.timelineRow) continue;
      // 貼著對方到達前一個緩衝離開，或對方離開後一個緩衝才到
      const edges = [
        booking.instant - query.bufferSeconds - (point.until ?? point.instant),
        (booking.until ?? booking.instant) + query.bufferSeconds - point.instant,
      ];
      for (const edge of edges) {
        for (const wrap of [-query.daySeconds, 0, query.daySeconds]) raw.add(edge + wrap);
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
            booking.nodeId === junctionClashKey(point.nodeId)
            && booking.timelineRow !== query.timelineRow
            && occupanciesClash(center - half, center + half, booking.instant, booking.until ?? booking.instant, 0, query.daySeconds))
          .sort((a, b) => a.instant - b.instant),
      };
    }),
  };
}
