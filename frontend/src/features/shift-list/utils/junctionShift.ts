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
 * 此鍵用來查對開；同方向另查同鍵預約以保證先進先出。
 */
export function junctionClashKey(nodeId: string): string {
  if (!nodeId.startsWith('seg:')) return nodeId;
  if (nodeId.endsWith('#f')) return `${nodeId.slice(0, -2)}#r`;
  if (nodeId.endsWith('#r')) return `${nodeId.slice(0, -2)}#f`;
  return nodeId;
}

export function traversalOvertakes(aEnter: number, aExit: number, bEnter: number, bExit: number): boolean {
  return (aEnter < bEnter && aExit > bExit) || (aEnter > bEnter && aExit < bExit);
}

export function junctionOvertakes(
  bookings: JunctionShiftQuery['bookings'], nodeId: string, enter: number, exit: number,
  timelineRow: number, daySeconds: number,
): boolean {
  if (junctionClashKey(nodeId) === nodeId) return false;
  return (bookings.get(nodeId) ?? []).some((booking) => {
    if (booking.timelineRow === timelineRow) return false;
    const wrap = Math.round((enter - booking.instant) / daySeconds) * daySeconds;
    return traversalOvertakes(enter, exit, booking.instant + wrap, (booking.until ?? booking.instant) + wrap);
  });
}

/**
 * 兩段佔用在同一個點要差開幾秒
 * ============================
 *
 * - 純經過的點（入口點、轉線點），或月台上兩台都只是一閃而過：碰撞保護時間（一個 30 秒）。
 * - 月台上後到的車要停靠時，前車須提前兩倍碰撞保護離開；後到車只經過時維持一倍。
 *
 * 移動車在月台掉頭、進出，用的就是那個站位，跟載客車到站停靠是同一件事
 * （2026-11-12 使用者確認）。2026-11-10 實測 s4：入廠車 01:33:10 在月台掉頭、載客車 01:33:40
 * 進同一個月台停 10 分鐘，只差一個 30 秒就放行；號誌先到先放，先後一顛倒入廠車就等 10 分鐘。
 */
export function occupancyGapSeconds(args: {
  /** 這個點是不是月台（停靠點） */
  berth: boolean;
  bStops: boolean;
  /** 經過一個點的間隔（碰撞保護時間） */
  passSeconds: number;
}): number {
  return args.berth && args.bStops ? berthGapSeconds(args.passSeconds) : args.passSeconds;
}

/** 站位規則的間隔：兩倍碰撞保護（跟 stationBerthConstraint 同一個數字） */
export function berthGapSeconds(passSeconds: number): number {
  return passSeconds * 2;
}

/** 一段佔用算不算「停」（有停留時間） */
export function occupancyStops(from: number, until: number | undefined): boolean {
  return until != null && until - from > 1e-6;
}

export type JunctionShiftQuery = {
  /** 已經加上其他位移（例如設施造成的位移）之後的經過時刻 */
  points: ReadonlyArray<JunctionPoint | null>;
  bookings: ReadonlyMap<string, readonly JunctionReservation[]>;
  timelineRow: number;
  minShift: number;
  maxShift: number;
  bufferSeconds: number;
  daySeconds: number;
  /** 時刻刻度（秒）；對齊的位移優先 */
  alignSeconds: number;
  /** 月台（停靠點）的節點 id：有一方在那裡停就套站位規則，見 {@link occupancyGapSeconds} */
  berthNodeIds?: ReadonlySet<string>;
  preferBerthClearance?: boolean;
};

/** 這個點跟這筆預約要差開幾秒 */
function gapFor(query: JunctionShiftQuery, point: JunctionPoint, booking: JunctionReservation, reverse = false, extra = 0): number {
  const berth = query.berthNodeIds?.has(point.nodeId) ?? false;
  const aStops = occupancyStops(point.instant, point.until);
  const bStops = occupancyStops(booking.instant, booking.until);
  return occupancyGapSeconds({
    berth,
    bStops: reverse ? aStops : bStops,
    passSeconds: query.bufferSeconds,
  }) + (berth && (aStops || bStops) ? extra : 0);
}

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
  afterBufferSeconds = bufferSeconds,
): boolean {
  const base = Math.round((aFrom - bFrom) / daySeconds) * daySeconds;
  for (const wrap of [base - daySeconds, base, base + daySeconds]) {
    if (aFrom < bUntil + wrap + afterBufferSeconds - 1e-9 && bFrom + wrap < aUntil + bufferSeconds - 1e-9) return true;
  }
  return false;
}

function pointIsFree(query: JunctionShiftQuery, point: JunctionPoint, shift: number, extra = 0): boolean {
  const clashKey = junctionClashKey(point.nodeId);
  return !(query.bookings.get(clashKey) ?? []).some((booking) =>
    booking.timelineRow !== query.timelineRow
    && occupanciesClash(
      point.instant + shift,
      (point.until ?? point.instant) + shift,
      booking.instant,
      booking.until ?? booking.instant,
      gapFor(query, point, booking, false, extra),
      query.daySeconds,
      gapFor(query, point, booking, true, extra),
    )) && !junctionOvertakes(query.bookings, point.nodeId, point.instant + shift,
      (point.until ?? point.instant) + shift, query.timelineRow, query.daySeconds);
}

export function hasPreferredBerthClearance(query: JunctionShiftQuery, shift = 0): boolean {
  return activePoints(query.points).every((point) =>
    !query.berthNodeIds?.has(point.nodeId) || pointIsFree(query, point, shift, query.bufferSeconds));
}

/** 最小可行位移；範圍內找不到回 null。buffer ≤ 0 或沒有點時回 0 */
export function solveJunctionShift(query: JunctionShiftQuery, extra = 0): number | null {
  if (query.preferBerthClearance && query.bufferSeconds > 0) {
    const hardQuery = { ...query, preferBerthClearance: false };
    return solveJunctionShift(hardQuery, query.bufferSeconds)
      ?? solveJunctionShift(hardQuery, query.bufferSeconds / 2)
      ?? solveJunctionShift(hardQuery);
  }
  if (query.bufferSeconds <= 0) return 0;
  const points = activePoints(query.points);
  if (points.length === 0) return 0;
  const inRange = (shift: number) => shift >= query.minShift - 1e-9 && shift <= query.maxShift + 1e-9;
  const allFree = (shift: number) => points.every((point) => pointIsFree(query, point, shift, extra));
  if (inRange(0) && allFree(0)) return 0;

  // 候選：搜尋區間兩端、每筆預約保護區間的前後緣（日循環上的等價位置），以及它們對齊刻度後的值。
  // 可行區間的端點一定是其中之一，所以最小位移不會漏掉。
  const raw = new Set<number>([query.minShift, query.maxShift]);
  for (const point of points) {
    const clashKey = junctionClashKey(point.nodeId);
    for (const booking of query.bookings.get(clashKey) ?? []) {
      if (booking.timelineRow === query.timelineRow) continue;
      // 貼著對方到達前一個緩衝離開，或對方離開後一個緩衝才到
      const edges = [
        booking.instant - gapFor(query, point, booking, false, extra) - (point.until ?? point.instant),
        (booking.until ?? booking.instant) + gapFor(query, point, booking, true, extra) - point.instant,
      ];
      for (const edge of edges) {
        for (const wrap of [-query.daySeconds, 0, query.daySeconds]) raw.add(edge + wrap);
      }
    }
    if (clashKey !== point.nodeId) {
      for (const booking of query.bookings.get(point.nodeId) ?? []) {
        if (booking.timelineRow === query.timelineRow) continue;
        for (const wrap of [-query.daySeconds, 0, query.daySeconds]) {
          raw.add(booking.instant - point.instant + wrap);
          raw.add((booking.until ?? booking.instant) - (point.until ?? point.instant) + wrap);
        }
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
      if (!inRange(shift)) continue;
      if (best !== null && (Math.abs(shift) > Math.abs(best) || (Math.abs(shift) === Math.abs(best) && shift <= best))) continue;
      if (allFree(shift)) best = shift;
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
        bookingsInWindow: (query.bookings.get(junctionClashKey(point.nodeId)) ?? [])
          .filter((booking) =>
            booking.timelineRow !== query.timelineRow
            && occupanciesClash(center - half, center + half, booking.instant, booking.until ?? booking.instant, 0, query.daySeconds))
          .sort((a, b) => a.instant - b.instant),
      };
    }),
  };
}
