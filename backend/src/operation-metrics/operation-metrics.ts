/**
 * 儀表板營運指標：班次中心、運能趨勢
 * ================================
 *
 * 全部從部署中的班表與當天的訂單算，不讀示範表：
 *
 * <table>
 *   <tr><td>總共班次</td><td>部署班表的正線班次數</td></tr>
 *   <tr><td>完成／延誤</td><td>當天這份班表的正線訂單：END 為完成；結束晚於計畫一分鐘以上、
 *       故障結案、或進行中但已超過計畫結束，都算延誤</td></tr>
 *   <tr><td>目標數值</td><td>時間模板此刻時段的運量（pphpd）</td></tr>
 *   <tr><td>計畫運能</td><td>班表的發車換算 pphpd</td></tr>
 *   <tr><td>即時數值</td><td>實際發車（訂單開始執行的時刻）換算 pphpd</td></tr>
 *   <tr><td>可用數值</td><td>待命中的車投入營運可增加的 pphpd</td></tr>
 *   <tr><td>下段數值</td><td>下一個時段的目標運量與開始時刻</td></tr>
 * </table>
 *
 * 運能換算跟班表編輯器「運能趨勢」同一套：同一服務方向、同一台車連續的不同路線路段
 * （例 NT→TS）只算一趟；過去 60 分鐘內相鄰班距的平均換成 pphpd
 * （載客量 × 3600 ÷ 平均班距），各服務方向取平均。
 */

export const CAPACITY_WINDOW_MINUTES = 60;
/** 低於此值的同向連發視為同一班次的串接偽影，不當作班距 */
export const MIN_CAPACITY_HEADWAY_SECONDS = 60;
export const DAY_MINUTES = 24 * 60;

export type RouteInfo = { routeId: string; routeCode: string | null; directionKey: string };

export type TemplateSegment = { startMinute: number; endMinute: number; label: string; pphpd: number };

export type DepartureLead = { directionKey: string; atSecond: number };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function clockToMinute(text: unknown): number | null {
  const match = typeof text === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(text.trim()) : null;
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatClock(minute: number): string {
  const m = ((Math.round(minute) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 部署班表的路線 → 服務方向（沒設服務方向的路線自成一流） */
export function routesFromShift(body: Record<string, unknown>): RouteInfo[] {
  const routes = Array.isArray(body.selectedRoutes) ? body.selectedRoutes : [];
  return routes
    .map((raw) => asRecord(raw))
    .filter((route): route is Record<string, unknown> => route != null && str(route.routeId) != null)
    .map((route) => ({
      routeId: str(route.routeId)!,
      routeCode: str(route.routeCode),
      directionKey: str(route.serviceDirectionId) ? `sdir:${str(route.serviceDirectionId)}` : `route:${str(route.routeId)}`,
    }));
}

/** 時間模板的時段（跨午夜的時段結束 +1440），依開始排序 */
export function templateSegments(templateBody: Record<string, unknown> | null): TemplateSegment[] {
  if (!templateBody) return [];
  const attributes = new Map(
    (Array.isArray(templateBody.attributes) ? templateBody.attributes : [])
      .map((raw) => asRecord(raw))
      .filter((attr): attr is Record<string, unknown> => attr != null && str(attr.id) != null)
      .map((attr) => [str(attr.id)!, attr] as const),
  );
  const segments: TemplateSegment[] = [];
  for (const raw of Array.isArray(templateBody.intervals) ? templateBody.intervals : []) {
    const interval = asRecord(raw);
    if (!interval || interval.isDraft === true) continue;
    const start = clockToMinute(interval.startTime);
    let end = clockToMinute(interval.endTime);
    if (start == null || end == null) continue;
    if (end <= start) end += DAY_MINUTES;
    const attr = attributes.get(str(interval.attributeId) ?? '');
    segments.push({
      startMinute: start,
      endMinute: end,
      label: str(interval.name) ?? str(attr?.name) ?? '',
      pphpd: Number(attr?.capacityPphpd) || 0,
    });
  }
  return segments.sort((a, b) => a.startMinute - b.startMinute);
}

/** 此刻（當日分鐘）落在哪個時段；跨午夜的時段也比對 */
export function segmentAt(segments: TemplateSegment[], minute: number): TemplateSegment | null {
  return segments.find((segment) =>
    [minute, minute + DAY_MINUTES].some((at) => at >= segment.startMinute && at < segment.endMinute)) ?? null;
}

/** 下一個目標運量不同的時段（從此刻往後找一整天） */
export function nextSegment(segments: TemplateSegment[], minute: number): TemplateSegment | null {
  const current = segmentAt(segments, minute);
  const ordered = [...segments, ...segments.map((segment) => ({
    ...segment,
    startMinute: segment.startMinute + DAY_MINUTES,
    endMinute: segment.endMinute + DAY_MINUTES,
  }))].sort((a, b) => a.startMinute - b.startMinute);
  return ordered.find((segment) =>
    segment.startMinute > minute && (!current || segment.pphpd !== current.pphpd)) ?? null;
}

/**
 * 一台車（或一條時間線）的連續正線路段 → 各服務方向的「一趟班次」起點。
 * 同向、不同路線的串接路段併入同一趟；同向又從同一起始路線出發才是下一趟。
 */
export function mergeDepartureLeads(
  segments: Array<{ routeKey: string; atSecond: number }>,
  directionOf: (routeKey: string) => string | null,
): DepartureLead[] {
  const leads: DepartureLead[] = [];
  let runDirection: string | null = null;
  let runStartRoute: string | null = null;
  for (const segment of [...segments].sort((a, b) => a.atSecond - b.atSecond)) {
    const direction = directionOf(segment.routeKey);
    if (!direction) {
      runDirection = null;
      runStartRoute = null;
      continue;
    }
    if (direction === runDirection && segment.routeKey !== runStartRoute) continue;
    leads.push({ directionKey: direction, atSecond: segment.atSecond });
    runDirection = direction;
    runStartRoute = segment.routeKey;
  }
  return leads;
}

/** 過去 60 分鐘內相鄰班距平均 → pphpd；各服務方向取平均（有班距的方向才算） */
export function pphpdAt(leads: DepartureLead[], atSecond: number, vehicleCapacity: number): number {
  if (vehicleCapacity <= 0) return 0;
  const windowStart = atSecond - CAPACITY_WINDOW_MINUTES * 60;
  const byDirection = new Map<string, number[]>();
  for (const lead of leads) {
    const list = byDirection.get(lead.directionKey) ?? [];
    list.push(lead.atSecond);
    byDirection.set(lead.directionKey, list);
  }
  const values: number[] = [];
  for (const seconds of byDirection.values()) {
    const sorted = [...new Set(seconds)].sort((a, b) => a - b);
    let gapSum = 0;
    let gapCount = 0;
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const start = sorted[i]!;
      const end = sorted[i + 1]!;
      const gap = end - start;
      if (gap < MIN_CAPACITY_HEADWAY_SECONDS) continue;
      // 班距跟取樣視窗 [windowStart, atSecond] 有交集才計入
      if (end <= windowStart || start > atSecond) continue;
      gapSum += gap;
      gapCount += 1;
    }
    values.push(gapCount > 0 ? (vehicleCapacity * 3600) / (gapSum / gapCount) : 0);
  }
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 部署班表的計畫發車（秒，當日座標；跨午夜的卡 >86400） */
export function plannedLeadsFromShift(body: Record<string, unknown>, routes: RouteInfo[]): DepartureLead[] {
  const timelines = asRecord(asRecord(body.scheduleOutput)?.plan)?.timelines;
  if (!Array.isArray(timelines)) return [];
  const directionByRoute = new Map(routes.map((route) => [route.routeId, route.directionKey] as const));
  const leads: DepartureLead[] = [];
  for (const raw of timelines) {
    const blocks = asRecord(raw)?.blocks;
    if (!Array.isArray(blocks)) continue;
    const segments = blocks
      .map((item) => asRecord(item))
      .filter((block): block is Record<string, unknown> =>
        block != null
        && block.taskType === 'passenger'
        && str(block.routeId) != null
        && Number.isFinite(Number(block.plannedStartMinute)))
      .map((block) => ({ routeKey: str(block.routeId)!, atSecond: Math.round(Number(block.plannedStartMinute) * 60) }));
    leads.push(...mergeDepartureLeads(segments, (key) => directionByRoute.get(key) ?? null));
  }
  return leads;
}

export function countPlannedPassengerTrips(body: Record<string, unknown>): number {
  const timelines = asRecord(asRecord(body.scheduleOutput)?.plan)?.timelines;
  if (!Array.isArray(timelines)) return 0;
  let count = 0;
  for (const raw of timelines) {
    const blocks = asRecord(raw)?.blocks;
    if (!Array.isArray(blocks)) continue;
    for (const item of blocks) {
      if (asRecord(item)?.taskType === 'passenger') count += 1;
    }
  }
  return count;
}

/** 一台車投入營運一小時、每個服務方向可多開幾趟 → pphpd（用班表偏好的交路一圈秒數） */
export function perVehiclePphpd(body: Record<string, unknown>, vehicleCapacity: number): number {
  const anchors = asRecord(body.throughAnchors);
  const cycles = Array.isArray(anchors?.listedThroughCycles) ? anchors!.listedThroughCycles as unknown[] : [];
  const preferredId = str(anchors?.preferredThroughCycleId);
  const preferred = cycles.map((raw) => asRecord(raw)).find((cycle) => cycle && str(cycle.id) === preferredId)
    ?? asRecord(cycles[0]);
  const cycleSeconds = Number(preferred?.avgCycleSeconds);
  if (!Number.isFinite(cycleSeconds) || cycleSeconds <= 0 || vehicleCapacity <= 0) return 0;
  return (vehicleCapacity * 3600) / cycleSeconds;
}

export type ShiftCenterSummary = {
  total_shifts: number;
  completed_shifts: number;
  delayed_shifts: number;
  achievement_pct: number;
  achievement_line: string;
  remaining_shifts: number;
  remaining_line: string;
  shift_name: string | null;
};

export function buildShiftCenterSummary(args: {
  shiftName: string | null;
  plannedTrips: number;
  orders: Array<{ status: string; plannedEnd: number | null; delayMinutes: number | null }>;
  now: number;
}): ShiftCenterSummary {
  const completed = args.orders.filter((order) => order.status === 'END').length;
  const delayed = args.orders.filter((order) =>
    (order.status === 'END' && (order.delayMinutes ?? 0) > 0)
    || order.status === 'FAULTED'
    || (order.status === 'PROCESSING' && order.plannedEnd != null && args.now > order.plannedEnd + 60_000)).length;
  const total = Math.max(args.plannedTrips, completed);
  const pct = total > 0 ? Math.round((100 * completed) / total) : 0;
  const remaining = Math.max(0, total - completed);
  return {
    total_shifts: total,
    completed_shifts: completed,
    delayed_shifts: delayed,
    achievement_pct: pct,
    achievement_line: `達成了 ${pct}%`,
    remaining_shifts: remaining,
    remaining_line: pct >= 100 ? '' : `剩餘${remaining}班次`,
    shift_name: args.shiftName,
  };
}
