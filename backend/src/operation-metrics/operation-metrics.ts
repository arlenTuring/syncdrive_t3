/**
 * 儀表板營運指標：班次中心、運能趨勢
 * ================================
 *
 * 全部從部署中的班表與當天的訂單算，不讀示範表：
 *
 * 班次中心的規則在 dispatch/daily-plan.ts（營運日＋採用的每日計畫）。
 *
 * <table>
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

export type TemplateSegment = {
  startMinute: number;
  endMinute: number;
  label: string;
  pphpd: number;
  /** 時段屬性設定的目標班距（秒）；模板沒設就是 null */
  headwaySeconds: number | null;
  /** 時段屬性（尖峰、離峰、招呼…）的 ID 與顏色：運能趨勢色帶直接用模板的顏色 */
  attributeId: string | null;
  color: string | null;
};

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
      headwaySeconds: Number(attr?.headwaySeconds) > 0 ? Number(attr?.headwaySeconds) : null,
      attributeId: str(interval.attributeId),
      color: str(attr?.color),
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

/** 班距秒數 → 「MM:SS」；沒有設定時回「—」 */
export function formatHeadway(seconds: number | null): string {
  if (seconds == null || !(seconds > 0)) return '—';
  const total = Math.round(seconds);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}


/* ─────────────────────────── 運能趨勢圖 ─────────────────────────── */

/** 某個營運日的運能資料：該日採用的班表所綁定的時間模板時段，與該日的實際發車 */
export type CapacityDay = {
  /** 營運日零點（Epoch 毫秒） */
  dayStart: number;
  /** 模板時段；模板缺失或無效時為 null（搭配 templateIssue） */
  segments: TemplateSegment[] | null;
  templateIssue: string | null;
};

export type CapacityTrendRow = {
  /** 營運時間（Epoch 毫秒）——圖的 X 軸用它，不用只有時分的字串排序 */
  ts: number;
  /** 顯示用 HH:mm（營運時間） */
  time: string;
  /** 模板此刻時段的預期運能；模板缺失或該時刻沒有時段就是 null */
  forecast_util: number | null;
  /** 實際運能；未來、或沒有實際資料的時段是 null（不補 0） */
  actual_util: number | null;
  segment_id: string | null;
  segment_label: string | null;
  segment_color: string | null;
  /** 這一列是「現在」（跟即時數值同一個時刻、同一個算法） */
  is_now: boolean;
  /** 這份資料的「現在」採樣時刻（營運時間，取到整分鐘，見 capacitySampleMs）；整張圖以它為時間基準 */
  now_ms: number;
  /**
   * 異常標記：只有真實的異常事件才標。目前沒有接到這類資料來源，一律 false／null。
   * （實際運能是過去 60 分鐘的班距換算，時段一切換就必然低於新時段的預期，那不是異常。）
   */
  is_anomaly: boolean;
  anomaly_label: string | null;
  /** 資料問題（模板缺失、沒設載客量…）；有問題時圖上要顯示，不畫假線 */
  data_issue: string | null;
};

/**
 * 運能趨勢：過去 pastMinutes 到未來 futureMinutes，每 bucketMinutes 取樣，另外加上「現在」與每個
 * 時段邊界（邊界前後各一列，灰線照時段階梯呈現，不在兩個時段之間平滑出不存在的數值）。
 *
 * - 灰線（forecast_util）：取樣時刻所屬營運日的模板時段預期運能；跟上方「目標數值」「下段數值」
 *   同一份時段資料。模板合法的 0 照畫；模板缺失／無效就是 null 並回報 data_issue。
 * - 藍線（actual_util）：只到現在；actualAt 回 null（沒有實際資料）的地方斷開，不補 0。
 */
/**
 * 「現在」採樣時刻：營運時間取到整分鐘。
 *
 * 運能摘要（即時數值）與趨勢圖的「現在」那一點是兩個 API、各自輪詢；加速重播時兩次請求差幾秒，
 * 營運時間就差幾十秒，一筆發車剛好落在中間，兩個數字就不一樣（實測摘要 1090、端點 1110）。
 * 兩邊都用同一個採樣時刻算，同一分鐘內一定相同；不同分鐘就回傳各自的採樣時刻，畫面看得出來。
 */
export function capacitySampleMs(now: number): number {
  return Math.floor(now / 60_000) * 60_000;
}

export function buildCapacityTrend(args: {
  now: number;
  days: CapacityDay[];
  pastMinutes: number;
  futureMinutes: number;
  bucketMinutes: number;
  /** 某時刻的實際運能；沒有實際資料可算時回 null */
  actualAt: (ts: number) => number | null;
  dataIssue: string | null;
  formatTime: (ts: number) => string;
}): CapacityTrendRow[] {
  const { days, pastMinutes, futureMinutes, bucketMinutes, actualAt, dataIssue, formatTime } = args;
  // 「現在」那一列與摘要的即時數值同一個採樣時刻
  const now = capacitySampleMs(args.now);
  const bucketMs = bucketMinutes * 60_000;
  const from = now - pastMinutes * 60_000;
  const to = now + futureMinutes * 60_000;
  const sortedDays = [...days].sort((a, b) => a.dayStart - b.dayStart);

  const dayOf = (ts: number) => {
    let found: CapacityDay | null = null;
    for (const day of sortedDays) if (day.dayStart <= ts) found = day;
    return found;
  };
  const segmentFor = (ts: number): TemplateSegment | null => {
    const day = dayOf(ts);
    if (!day?.segments) return null;
    return segmentAt(day.segments, (ts - day.dayStart) / 60_000);
  };

  type Sample = { ts: number; segment: TemplateSegment | null; isNow: boolean };
  // 時段邊界：每個營運日的每個時段起點（跨午夜的時段起點在前一天；相鄰兩天算到同一點只留一個）
  const boundaries = new Set<number>();
  for (const day of sortedDays) {
    for (const segment of day.segments ?? []) {
      for (const offsetDay of [0, 1]) {
        const boundary = day.dayStart + (segment.startMinute + offsetDay * DAY_MINUTES) * 60_000;
        if (boundary > from && boundary < to) boundaries.add(boundary);
      }
    }
  }
  const samples: Sample[] = [];
  // 取樣格對齊營運日零點（10 分鐘整除 60，跨午夜也對齊）；落在邊界上的格子由邊界那兩列代表
  const anchor = sortedDays[0]?.dayStart ?? 0;
  for (let ts = anchor + Math.floor((from - anchor) / bucketMs) * bucketMs; ts <= to + bucketMs; ts += bucketMs) {
    if (ts < from - bucketMs || boundaries.has(ts)) continue;
    samples.push({ ts, segment: segmentFor(ts), isNow: false });
  }
  samples.push({ ts: now, segment: segmentFor(now), isNow: true });
  for (const boundary of boundaries) {
    const before = segmentFor(boundary - 1);
    const after = segmentFor(boundary);
    // 前後是同一種時段、預期運能也一樣（例如兩天的招呼模式接在一起）：不是邊界
    if (before?.attributeId === after?.attributeId && before?.pphpd === after?.pphpd) {
      samples.push({ ts: boundary, segment: after, isNow: false });
      continue;
    }
    samples.push({ ts: boundary, segment: before, isNow: false });
    samples.push({ ts: boundary, segment: after, isNow: false });
  }
  // 依時間排序；同一時刻保留插入順序（邊界：舊時段在前、新時段在後）
  const ordered = samples
    .map((sample, index) => ({ sample, index }))
    .sort((a, b) => a.sample.ts - b.sample.ts || a.index - b.index)
    .map(({ sample }) => sample);

  const rows: CapacityTrendRow[] = [];
  for (const sample of ordered) {
    const forecast = sample.segment ? sample.segment.pphpd : null;
    const actual = sample.ts <= now ? actualAt(sample.ts) : null;
    rows.push({
      ts: sample.ts,
      time: formatTime(sample.ts),
      forecast_util: forecast,
      actual_util: actual,
      segment_id: sample.segment?.attributeId ?? null,
      segment_label: sample.segment?.label ?? null,
      segment_color: sample.segment?.color ?? null,
      is_now: sample.isNow,
      now_ms: now,
      is_anomaly: false,
      anomaly_label: null,
      data_issue: dataIssue,
    });
  }
  return rows;
}
