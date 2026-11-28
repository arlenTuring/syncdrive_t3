/**
 * 車輛輪替的計算。全部是純函式，不碰資料庫；讀寫在 vehicle-rotation.service.ts。
 *
 * <h3>誰該下來</h3>
 * 只看這台車自己：目前里程 ≥ 上次輪替里程 + 輪替基數。不跟別台車比，所以
 * 「某台車比另一台少 1000 公里」不會觸發輪替。沒有「超過就必須換」的上限：
 * 超過只是排得比較前面。
 *
 * <h3>誰能上去</h3>
 * 擔任規則指定的時間線（例如保養線、機動線）的車、車輛清單沒有被鎖住（保留、大保養）。
 * 一條時間線就是一台車：可接替的線是用來接別人工作的，那條線上的車不會被排進「需要被輪替」的隊伍。
 * 先前用「停在哪些格位」判斷，格位只說明車現在停哪，收班剛好停進同一格的線上車也會被當成備用車，
 * 停在別格的備用車反而選不到。電量與休息時間不當門檻，
 * 電量夠不夠撐到下次充電系統判斷不了，所以只在確認報告上寫清楚，由人判斷。
 * 當天剛換下來的車不會被選中，避免換下來馬上又被換回去。
 *
 * <h3>怎麼換</h3>
 * 時間模板不動，兩台車對調角色：換手之後，A 列的班次改由接手車跑，接手車原本
 * 那一列的任務改由被換車接。換手地點來自班表：
 * <ul>
 *   <li>場內：該列本來就進場（充電、待命、行檢），被換車留在場內，接手車去接下一班。</li>
 *   <li>收班後：這一列當天最後一段任務。班表是 24 小時循環，這裡就是換日點：接手車接下最後那段，
 *   當天載客班次都不受影響，下一營運日起這一列由接手車擔任。</li>
 *   <li>收班進場：最後一班載客之後進場停過夜（之後只剩 0 秒的換日占位）。接手車先開進那一格，
 *   被換車下了最後一班直接開去接手車的格位，兩台車不用互搶同一格。</li>
 *   <li>月台空檔：連續兩班之間停得夠久。T3 目前停站接近 0 秒，不會出現在這裡。</li>
 * </ul>
 * 第一版只用收班後換手：白天換手要改派已排定的班次，先不開放。
 * 報告只在規則的時間範圍內找換手點，會略過充電、行檢或保養的換手點不採用。
 */

export type PlanTaskKind = 'passenger' | 'movement' | 'maintenance';

export type PlanTask = {
  order_id: string;
  trip_code: string;
  vehicle_code: string | null;
  timeline_row: number;
  depart_at: number;
  arrive_at: number | null;
  kind: PlanTaskKind;
  origin: string;
  destination: string;
  maintenance?: { maintenance_task_type?: string } | null;
};

export type RotationMode = 'confirm' | 'auto';

export type RotationRules = {
  /** 每多少公里需要接替 */
  intervalKm: number;
  /** 擔任這些時間線（列號）的車才能接替；這些線上的車也不會被排進需要被輪替的隊伍 */
  takeoverRows: number[];
  /** 期望執行時段（HH:mm），可跨午夜 */
  windowStart: string;
  windowEnd: string;
  /** 每日確認，或自動執行 */
  mode: RotationMode;
  /** 每日確認時，幾點前產出待確認報告（HH:mm） */
  reportBy: string;
};

export const DEFAULT_ROTATION_RULES: RotationRules = {
  intervalKm: 1000,
  takeoverRows: [],
  windowStart: '23:00',
  windowEnd: '02:00',
  mode: 'confirm',
  reportBy: '20:00',
};

export type HoldState = 'available' | 'reserved' | 'overhaul';

export type FleetCar = {
  code: string;
  /** 目前擔任的時間線列 */
  row: number;
  /** 這一列今天有沒有載客班次 */
  onLine: boolean;
  currentKm: number;
  /** 上次輪替上場時的里程，不歸零 */
  lastRotationKm: number;
  /** 還沒收到車端遙測時是 null */
  batteryPct: number | null;
  /** 下線時刻；線上的車為 null */
  restSince: number | null;
  /** 車輛清單上的設定：可輪替、保留、大保養 */
  hold: HoldState;
  /** 上次被換下來的時刻；當天剛換下的車不接替 */
  rotatedOutAt?: number | null;
};

export const HOLD_LABEL: Record<HoldState, string> = {
  available: '可輪替',
  reserved: '保留',
  overhaul: '大保養',
};

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
/** 接手車到位後，距離發車至少留的時間 */
const MARGIN_MS = 2 * MINUTE_MS;
/** 月台空檔至少這麼久才算換手點 */
const PLATFORM_GAP_MS = 8 * MINUTE_MS;
/** 比這更短的停留（例如 2 分鐘暫停）不夠當換手點 */
const MIN_DWELL_MS = 5 * MINUTE_MS;
/** 寬裕時間到這個長度才優先建議 */
const COMFORT_SLACK_MS = 10 * MINUTE_MS;

export function nextRotationKm(car: FleetCar, rules: RotationRules): number {
  return car.lastRotationKm + rules.intervalKm;
}

/** 擔任可接替時間線的車：它是接別人工作的那一方，不排進需要被輪替的隊伍 */
export function onTakeoverRow(car: FleetCar, rules: RotationRules): boolean {
  return rules.takeoverRows.includes(car.row);
}

export function isDue(car: FleetCar, rules: RotationRules): boolean {
  return car.onLine && !onTakeoverRow(car, rules) && car.currentKm >= nextRotationKm(car, rules);
}

/** 需要被輪替的隊伍：超過基數最多的排最前面 */
export function rotationQueue(cars: readonly FleetCar[], rules: RotationRules): FleetCar[] {
  return cars
    .filter((car) => isDue(car, rules))
    .sort((a, b) => b.currentKm - nextRotationKm(b, rules) - (a.currentKm - nextRotationKm(a, rules)));
}

/** 不能接替的原因；空陣列代表可以接替 */
export function takeoverBlockers(car: FleetCar, rules: RotationRules, dayStart: number): string[] {
  if (!onTakeoverRow(car, rules)) return [car.onLine ? '線上服務中' : '不在可接替的運用'];
  const reasons: string[] = [];
  if (car.hold !== 'available') reasons.push(HOLD_LABEL[car.hold]);
  if (car.rotatedOutAt != null && car.rotatedOutAt >= dayStart) reasons.push('今天剛換下');
  return reasons;
}

/** 可接替的車：里程低的優先，讓里程平均 */
export function takeoverCandidates(args: {
  cars: readonly FleetCar[];
  rules: RotationRules;
  dayStart: number;
}): FleetCar[] {
  const { cars, rules, dayStart } = args;
  return cars
    .filter((car) => takeoverBlockers(car, rules, dayStart).length === 0)
    .sort((a, b) => a.currentKm - b.currentKm);
}

type HourLoad = { hour: number; startAt: number; departures: number };

/** 每小時載客發車數，用來找班距最寬鬆的時段 */
function hourlyLoad(tasks: readonly PlanTask[], dayStart: number): HourLoad[] {
  const passengers = tasks.filter((task) => task.kind === 'passenger');
  const last = passengers.reduce((max, task) => Math.max(max, task.depart_at), dayStart);
  const hours = Math.floor((last - dayStart) / HOUR_MS) + 1;
  const load: HourLoad[] = Array.from({ length: hours }, (_, hour) => ({
    hour,
    startAt: dayStart + hour * HOUR_MS,
    departures: 0,
  }));
  for (const task of passengers) {
    const bucket = load[Math.floor((task.depart_at - dayStart) / HOUR_MS)];
    if (bucket) bucket.departures += 1;
  }
  return load;
}

const ZONE_LABEL: Record<string, string> = {
  charging: '充電區',
  standby: '待命區',
  maneuver: '機動區',
  inspection: '行檢區',
  servicing: '保養區',
  idle: '暫停區',
};

export function zoneLabel(task: PlanTask): string {
  return ZONE_LABEL[task.maintenance?.maintenance_task_type ?? ''] ?? '場區';
}

export type SwapWindow = {
  id: string;
  type: 'yard' | 'platform';
  row: number;
  /** 換手地點（充電格、待命格或月台） */
  location: string;
  zone: string;
  /** 被換車到位的時刻：場內是進到那一格的時刻，月台是到站時刻 */
  readyAt: number;
  /** 下一班載客發車；收班後窗口則是當天最後一段出場移動 */
  next: PlanTask;
  /** 收班後窗口：當天載客班次都不受影響 */
  endOfDay: boolean;
  /** 接手車要到的地點 */
  meetAt: string;
  /** 被換車會略過的充電、行檢或保養 */
  skippedService: string[];
  /** 被換車本來要開的出場移動，換手後取消 */
  cancelled: PlanTask[];
  /** 這個小時的載客發車數 */
  hourDepartures: number;
  /** 寬裕時間：扣掉接手車移動與預留後還剩多少 */
  slackMs: number;
  /** 接手車從原位開到下一班起點的時間 */
  moveInMs: number;
  moveInEstimated: boolean;
  takeoverDepartAt: number;
  /** 被換車開去接手車格位的時刻（舊資料沒有，照 endOfDay 推算） */
  outAt?: number;
  /** 收班進場窗口：被換車下了最後一班在月台等接替車到位，接替車晚到不能拖 */
  entry?: boolean;
};

const SERVICE_LABEL: Record<string, string> = { charging: '充電', inspection: '行檢', servicing: '保養' };

function skippedService(tasks: readonly PlanTask[]): string[] {
  const labels = tasks.map((task) => SERVICE_LABEL[task.maintenance?.maintenance_task_type ?? '']).filter(Boolean);
  return [...new Set(labels)];
}

const sortByDepart = (tasks: readonly PlanTask[]) =>
  [...tasks].sort((a, b) => a.depart_at - b.depart_at || a.trip_code.localeCompare(b.trip_code));

const taskEnd = (task: PlanTask) => task.arrive_at ?? task.depart_at;

const slotGroup = (name: string) => /^([A-Z]+)\d+$/.exec(name)?.[1] ?? null;

/** 班表沒有這一格的移動時，用同一區相鄰格位的移動代替（M4 → M1） */
function siblingSlot(edges: Map<string, Map<string, number>>, name: string, wantTarget: boolean): string | null {
  const group = slotGroup(name);
  if (!group) return null;
  const nodes = wantTarget ? [...edges.values()].flatMap((targets) => [...targets.keys()]) : [...edges.keys()];
  return nodes.filter((node) => slotGroup(node) === group).sort()[0] ?? null;
}

/**
 * 班表裡每段路的時間（中位數），載客班次也算：接替車走到正線上時，實際車程跟載客車一樣。
 * 先前只用移動單估，那些常是繞場、含等待的長移動，估出來的時間比實際長很多，
 * 車端照計畫到站時刻放慢，就會在正線上慢慢爬、擋住後面的載客車（2026-11-27 23:47 PMS09 M3 → NWD
 * 估 780 秒，實際約 5 分鐘，擋住 PMS06 的 TN2354 晚到 228 秒，連鎖到 00:07 場區互等）。
 */
export function travelEdges(tasks: readonly PlanTask[]): Map<string, Map<string, number>> {
  const samples = new Map<string, Map<string, number[]>>();
  for (const task of tasks) {
    const ms = taskEnd(task) - task.depart_at;
    if (task.kind === 'maintenance' || task.origin === task.destination || ms <= 0) continue;
    const from = samples.get(task.origin) ?? new Map<string, number[]>();
    from.set(task.destination, [...(from.get(task.destination) ?? []), ms]);
    samples.set(task.origin, from);
  }
  const edges = new Map<string, Map<string, number>>();
  for (const [from, targets] of samples) {
    edges.set(from, new Map([...targets].map(([to, list]) => [to, [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]])));
  }
  return edges;
}

export type MoveHop = { from: string; to: string; ms: number };

/** 同一區格位之間換格的時間 */
const IN_PLACE_MS = MINUTE_MS;

/** 沿班表出現過的路段找最短時間，回傳經過哪幾段（檢查會不會跟別的車搶路用）；走不到就用預設值，畫面標「預估」 */
export function movePath(
  edges: Map<string, Map<string, number>>,
  from: string,
  to: string,
  fallbackMs: number,
): { ms: number; estimated: boolean; hops: MoveHop[] } {
  if (from === to) return { ms: 0, estimated: false, hops: [] };
  // 同一區的兩格（M4 → M2）：場區裡原地換格，不上正線；照班表最短路會繞正線一圈，估出十幾分鐘
  if (slotGroup(from) != null && slotGroup(from) === slotGroup(to)) {
    return { ms: IN_PLACE_MS, estimated: false, hops: [{ from, to, ms: IN_PLACE_MS }] };
  }
  const start = edges.has(from) ? from : siblingSlot(edges, from, false);
  const hasTarget = [...edges.values()].some((targets) => targets.has(to));
  const end = hasTarget ? to : siblingSlot(edges, to, true);
  const fallback = { ms: fallbackMs, estimated: true, hops: [{ from, to, ms: fallbackMs }] };
  if (!start || !end) return fallback;
  const best = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([start]);
  while (open.size) {
    const here = [...open].sort((a, b) => best.get(a)! - best.get(b)!)[0];
    open.delete(here);
    for (const [next, ms] of edges.get(here) ?? []) {
      const total = best.get(here)! + ms;
      if (total < (best.get(next) ?? Infinity)) {
        best.set(next, total);
        prev.set(next, here);
        open.add(next);
      }
    }
  }
  const found = best.get(end);
  if (found == null) return fallback;
  const hops: MoveHop[] = [];
  for (let node = end; node !== start; node = prev.get(node)!) {
    const back = prev.get(node)!;
    hops.unshift({ from: back, to: node, ms: edges.get(back)!.get(node)! });
  }
  return { ms: found, estimated: start !== from || end !== to, hops };
}

/** 同一段路前後車至少相隔多久；對向、場區同一區的移動也至少錯開這麼久 */
const SHUNT_HEADWAY_MS = 60 * 1000;

/**
 * 調車照這個時刻出發，會不會跟班表上別的車搶路。回傳衝突的班次代號，沒有衝突回 null。
 *
 * - 同方向同一段：只能排在別的車前面或後面，前後都要隔一個班距，不能在路上被追上或追上別人。
 * - 反方向同一段、或兩頭在同一個場區（M、E、H…）：時間不能重疊。
 * - 到位後在終點等著（holdUntil）：這段時間別的車不能停在或開進那個點。
 * 被換車、接手車自己的任務不算（ignoreRows），換手後取消的任務也不算（ignore）。
 */
export function shuntConflict(args: {
  tasks: readonly PlanTask[];
  ignoreRows: ReadonlySet<number>;
  ignore: ReadonlySet<string>;
  hops: readonly MoveHop[];
  departAt: number;
  holdUntil?: number;
}): string | null {
  const { tasks, ignoreRows, ignore, hops, departAt } = args;
  const others = tasks.filter(
    (task) => task.kind !== 'maintenance' && !ignoreRows.has(task.timeline_row) && !ignore.has(task.order_id),
  );
  const H = SHUNT_HEADWAY_MS;
  let at = departAt;
  for (const hop of hops) {
    const s = at;
    const e = at + hop.ms;
    at = e;
    const groups = new Set([slotGroup(hop.from), slotGroup(hop.to)].filter((group): group is string => group != null));
    for (const task of others) {
      const os = task.depart_at;
      const oe = taskEnd(task);
      if (task.origin === hop.from && task.destination === hop.to) {
        const behind = s >= os + H && e >= oe + H;
        const ahead = s + H <= os && e + H <= oe;
        if (!behind && !ahead) return task.trip_code;
        continue;
      }
      const touchesGroup =
        groups.size > 0 && [slotGroup(task.origin), slotGroup(task.destination)].some((group) => group != null && groups.has(group));
      const reverse = task.origin === hop.to && task.destination === hop.from;
      if ((reverse || touchesGroup) && s < oe + H && os < e + H) return task.trip_code;
    }
  }
  const last = hops.at(-1);
  if (last && args.holdUntil != null && args.holdUntil > at) {
    const point = last.to;
    const rows = new Map<number, PlanTask[]>();
    for (const task of tasks) {
      if (ignoreRows.has(task.timeline_row) || ignore.has(task.order_id)) continue;
      rows.set(task.timeline_row, [...(rows.get(task.timeline_row) ?? []), task]);
    }
    for (const list of rows.values()) {
      const own = sortByDepart(list);
      for (let index = 0; index < own.length; index += 1) {
        const task = own[index];
        if (task.destination !== point) continue;
        const after = own[index + 1];
        const from = task.origin === point ? task.depart_at : taskEnd(task);
        const until = after && after.origin === point ? after.depart_at : taskEnd(task);
        if (from < args.holdUntil + H && at < until + H) return task.trip_code;
      }
    }
  }
  return null;
}

/** 找換手出發時刻時，每次往前挪多少 */
const DEPART_STEP_MS = 15 * 1000;
/** 最多比「剛好到」提早多久出發：再早就是在終點乾等，佔著那個點太久 */
const MAX_EARLY_MS = 20 * MINUTE_MS;

/**
 * 某一列在某時刻依計畫的位置。計畫上已開始、還沒抵達的任務回報 moving，不當成已在終點；
 * 這只是計畫推算，不能當成車真的到位的證據（到位看訂單回報）。
 */
export function rowPositionAt(
  tasks: readonly PlanTask[],
  row: number,
  at: number,
): { location: string | null; moving: boolean; headingTo: string | null } {
  const own = sortByDepart(tasks.filter((task) => task.timeline_row === row));
  const passed = own.filter((task) => task.depart_at <= at);
  const last = passed.at(-1);
  if (!last) return { location: own[0]?.origin ?? null, moving: false, headingTo: null };
  if (last.kind !== 'maintenance' && taskEnd(last) > at && last.origin !== last.destination) {
    return { location: null, moving: true, headingTo: last.destination };
  }
  return { location: last.destination, moving: false, headingTo: null };
}

/** 某一列在某時刻停在哪：最後一個已開始任務的終點（排換手時間用的計畫推算） */
export function rowLocationAt(tasks: readonly PlanTask[], row: number, at: number): string | null {
  const own = sortByDepart(tasks.filter((task) => task.timeline_row === row));
  const passed = own.filter((task) => task.depart_at <= at);
  return (passed.at(-1) ?? own[0])?.[passed.length ? 'destination' : 'origin'] ?? null;
}

/**
 * 列出某一列可以換手的窗口。
 *
 * 接手車只在被換車到位之後才動身；接手車那一列若在這段時間有任務也不算窗口，
 * 否則同一台車會同時要做兩件事。排序：收班後最優先，再來是時間夠寬裕的，同級時
 * 班距最寬鬆的時段排前面；會略過充電、行檢或保養的排最後。
 */
export function findSwapWindows(args: {
  tasks: readonly PlanTask[];
  row: number;
  takeoverRow: number;
  dayStart: number;
  notBefore: number;
  /** 接手車可以出發的時刻（規則的換手時段）；不給就不限 */
  allowDepart?: (at: number) => boolean;
}): SwapWindow[] {
  const { tasks, row, takeoverRow, dayStart, notBefore, allowDepart = () => true } = args;
  const own = sortByDepart(tasks.filter((task) => task.timeline_row === row));
  const takeoverTasks = sortByDepart(tasks.filter((task) => task.timeline_row === takeoverRow));
  const load = hourlyLoad(tasks, dayStart);
  const edges = travelEdges(tasks);
  const windows: SwapWindow[] = [];

  const lastPassenger = own.findLastIndex((task) => task.kind === 'passenger');
  /**
   * 接手車在 at 動身之後還有事要做嗎（場內整備不算，動身前會被結束）。
   * 收班換手時看到當天結束：輪替隔天才生效，接手車那一列當天之後的移動、載客還是派給接手車，
   * 它人已經在別列的位置，只能瞬移或卡住。
   */
  const takeoverBusy = (at: number, until: number) =>
    takeoverTasks.some(
      (task) =>
        task.kind !== 'maintenance' && task.origin !== task.destination && task.depart_at < until && taskEnd(task) > at,
    );

  own.forEach((next, index) => {
    const endOfDay = next.kind === 'movement' && index === own.length - 1 && lastPassenger >= 0;
    if (next.kind !== 'passenger' && !endOfDay) return;
    let start = index - 1;
    while (start >= 0 && own[start].kind !== 'passenger') start -= 1;
    const between = own.slice(start + 1, index);
    const previous = start >= 0 ? own[start] : null;
    // 同一段進場可能有充電又有待命：最長的那一格最寬裕，被換車就留在那裡
    const dwell = between
      .filter((task) => task.kind === 'maintenance' && taskEnd(task) - task.depart_at >= MIN_DWELL_MS)
      .reduce<PlanTask | null>(
        (longest, task) =>
          !longest || taskEnd(task) - task.depart_at > taskEnd(longest) - longest.depart_at ? task : longest,
        null,
      );

    let type: SwapWindow['type'];
    let location: string;
    let zone: string;
    let readyAt: number;
    let cancelled: PlanTask[];
    let fallbackMs: number;
    if (dwell) {
      const exits = between.slice(between.indexOf(dwell) + 1);
      type = 'yard';
      location = dwell.origin;
      zone = zoneLabel(dwell);
      readyAt = dwell.depart_at;
      cancelled = exits;
      fallbackMs = exits.reduce((sum, task) => sum + (taskEnd(task) - task.depart_at), 60_000);
    } else {
      if (!previous) return;
      const gapMs = next.depart_at - taskEnd(previous);
      if (gapMs < PLATFORM_GAP_MS) return;
      type = 'platform';
      location = previous.destination;
      zone = '月台空檔';
      readyAt = taskEnd(previous);
      cancelled = [];
      fallbackMs = 5 * MINUTE_MS;
    }

    const from = rowLocationAt(tasks, takeoverRow, readyAt) ?? '';
    const meetAt = endOfDay ? next.destination : next.origin;
    // 收班後車留在原格位（第 5、7 列）：接手車要進的格位正被被換車佔著，實體上換不了
    if (endOfDay && meetAt === location) return;
    // 被換車跟接手車停在同一個入口（白天或收班後都一樣）：接手車出場要經過被換車，
    // 被換車又要等接手車到位才回接手車的格位，兩邊互等，接手車晚到就趕不上第一班
    if (type === 'yard' && slotGroup(location) != null && slotGroup(location) === slotGroup(from)) return;
    const moveIn = movePath(edges, from, meetAt, fallbackMs);
    const moveOut = movePath(edges, location, from, 3 * MINUTE_MS);
    const deadline = endOfDay ? taskEnd(next) : next.depart_at;
    const arriveBy = deadline - (endOfDay ? 0 : MARGIN_MS);
    const ignoreRows = new Set([row, takeoverRow]);
    /*
     * 出發時刻：先試「剛好在要接手時到」，跟班表上別的車搶路（同方向會被追上、對向或同一場區重疊、
     * 終點被佔著）就往前挪，挪到被換車到位或不能出發為止。收班後的窗口也一樣：先前固定照原班表
     * 出場時刻到位，接替車走的路跟原本那趟不同，跟正線載客車搶在一起也不知道。
     */
    let takeoverDepartAt: number | null = null;
    let dropped: PlanTask[] = [];
    let windowOutAt = 0;
    const latest = arriveBy - moveIn.ms;
    const earliest = Math.max(readyAt, notBefore, latest - MAX_EARLY_MS);
    for (let at = latest; at >= earliest; at -= DEPART_STEP_MS) {
      if (!allowDepart(at)) continue;
      const arriveAt = at + moveIn.ms;
      if (takeoverBusy(at, endOfDay ? Infinity : deadline)) continue;
      // 接手車到位前就做完的場內任務照做：被換車手上有任務才不會閒置擋住場區入口
      const drop = (endOfDay ? [...cancelled, next] : cancelled).filter(
        (task) => task.kind !== 'maintenance' || taskEnd(task) > arriveAt,
      );
      const ignore = new Set(drop.map((task) => task.order_id));
      if (shuntConflict({ tasks, ignoreRows, ignore, hops: moveIn.hops, departAt: at, holdUntil: deadline })) continue;
      // 被換車回接手車原本的格位：接手車到位就走（收班後），白天等下一班發車後
      const outAt = endOfDay ? arriveAt : Math.max(arriveAt, next.depart_at);
      if (shuntConflict({ tasks, ignoreRows, ignore, hops: moveOut.hops, departAt: outAt })) continue;
      takeoverDepartAt = at;
      dropped = drop;
      windowOutAt = outAt;
      break;
    }
    if (takeoverDepartAt == null) return;
    const slackMs = takeoverDepartAt - readyAt;

    windows.push({
      id: next.trip_code,
      type,
      row,
      location,
      zone,
      readyAt,
      next,
      endOfDay,
      meetAt,
      skippedService: skippedService(dropped),
      cancelled: dropped,
      hourDepartures: load[Math.floor((next.depart_at - dayStart) / HOUR_MS)]?.departures ?? 0,
      slackMs,
      moveInMs: moveIn.ms,
      moveInEstimated: moveIn.estimated,
      takeoverDepartAt,
      outAt: windowOutAt,
    });
  });

  const entry = entryWindow({ tasks, own, takeoverRow, edges, notBefore, allowDepart, takeoverBusy, load, dayStart });
  if (entry) windows.push(entry);

  const rank = (item: SwapWindow) => {
    if (item.skippedService.length) return 3;
    if (item.endOfDay) return 0;
    return item.slackMs >= COMFORT_SLACK_MS ? 1 : 2;
  };
  return windows.sort((a, b) => rank(a) - rank(b) || a.hourDepartures - b.hourDepartures || b.slackMs - a.slackMs);
}

/**
 * 收班進場的換手窗口：最後一班載客之後進場停過夜，當天之後只剩 0 秒的換日占位。
 *
 * 這類列的最後一段是「停在 E1、E1 → E1 0 秒」，舊做法把換手地點算成被換車自己停的那一格，
 * 接手車進不去就整列放棄（2026-11-28 第 3、6、7、8 列都是這樣，報告寫「找不到可換手的時間」）。
 * 改成在進場那一刻換：被換車下了最後一班不進場，照原本進場的時刻直接從月台開去接手車的格位；
 * 接手車在那之前出發（格位才會空出來），在被換車原本到那一格的時刻前進去。被換車不在月台等接手車
 * 到位：停在月台會擋住後面進站的車。接手車沒出發就中止，被換車還在月台，照原計畫進場即可。
 *
 * 進場之後當天還有真的移動（例如半夜換格）就不用這個窗口：接手車停在進場那一格，
 * 跟這一列隔天開頭的位置對不上。
 */
function entryWindow(args: {
  tasks: readonly PlanTask[];
  own: readonly PlanTask[];
  takeoverRow: number;
  edges: Map<string, Map<string, number>>;
  notBefore: number;
  allowDepart: (at: number) => boolean;
  takeoverBusy: (at: number, until: number) => boolean;
  load: HourLoad[];
  dayStart: number;
}): SwapWindow | null {
  const { tasks, own, takeoverRow, edges, notBefore, allowDepart, takeoverBusy, load, dayStart } = args;
  const lastPassenger = own.findLastIndex((task) => task.kind === 'passenger');
  if (lastPassenger < 0) return null;
  const after = own.slice(lastPassenger + 1);
  const parkIndex = after.findIndex(
    (task) => task.kind === 'maintenance' && taskEnd(task) - task.depart_at >= MIN_DWELL_MS,
  );
  if (parkIndex < 0) return null;
  const park = after[parkIndex];
  const slot = park.origin;
  const entry = [...after.slice(0, parkIndex)]
    .reverse()
    .find((task) => task.kind === 'movement' && task.destination === slot && task.origin !== slot);
  if (!entry) return null;
  if (after.slice(parkIndex).some((task) => task.kind !== 'maintenance' && task.origin !== task.destination)) return null;

  const last = own[lastPassenger];
  const readyAt = taskEnd(last);
  const platform = entry.origin;
  const from = rowLocationAt(tasks, takeoverRow, readyAt);
  if (!from || from === slot || from === platform) return null;
  const moveIn = movePath(edges, from, slot, 5 * MINUTE_MS);
  const moveOut = movePath(edges, platform, from, 5 * MINUTE_MS);
  // 被換車照原本進場的時刻離開月台；接手車要在那之前出發，在被換車原本進到那一格的時刻前到
  const outAt = entry.depart_at;
  const arriveBy = taskEnd(entry);
  const dropIds = new Set(after.map((task) => task.order_id));
  const takeoverIds = tasks.filter((task) => task.timeline_row === takeoverRow).map((task) => task.order_id);
  const ownPastIds = own.filter((task) => taskEnd(task) <= outAt).map((task) => task.order_id);
  const latest = arriveBy - moveIn.ms;
  const earliest = Math.max(notBefore, latest - MAX_EARLY_MS);
  for (let at = latest; at >= earliest; at -= DEPART_STEP_MS) {
    if (at > outAt || !allowDepart(at) || takeoverBusy(at, Infinity)) continue;
    // 被換車最後一班之前的載客、空車照常跑，接手車不能跟它們搶路
    const inIgnore = new Set([...dropIds, ...takeoverIds]);
    if (shuntConflict({ tasks, ignoreRows: new Set(), ignore: inIgnore, hops: moveIn.hops, departAt: at, holdUntil: taskEnd(entry) })) continue;
    // 被換車回格位：接手車那趟也要算進去（兩趟可能在同一段路上對向）
    let hopAt = at;
    const incomingHops: PlanTask[] = moveIn.hops.map((hop, index) => {
      const departAt = hopAt;
      hopAt += hop.ms;
      return {
        order_id: `rotation-in-${index}`,
        trip_code: '輪替接替',
        vehicle_code: null,
        timeline_row: -1,
        depart_at: departAt,
        arrive_at: hopAt,
        kind: 'movement',
        origin: hop.from,
        destination: hop.to,
      };
    });
    const outIgnore = new Set([...dropIds, ...ownPastIds, ...takeoverIds]);
    if (shuntConflict({ tasks: [...tasks, ...incomingHops], ignoreRows: new Set(), ignore: outIgnore, hops: moveOut.hops, departAt: outAt })) continue;
    return {
      id: entry.trip_code,
      type: 'yard',
      row: entry.timeline_row,
      location: platform,
      zone: '收班進場',
      readyAt,
      next: entry,
      endOfDay: true,
      meetAt: slot,
      // 被換車下線休息，不會因為沒做到這些整備而撐不下去；進場後的整備改由接手車在那一格做
      skippedService: [],
      cancelled: after,
      hourDepartures: load[Math.floor((entry.depart_at - dayStart) / HOUR_MS)]?.departures ?? 0,
      slackMs: arriveBy - (at + moveIn.ms),
      moveInMs: moveIn.ms,
      moveInEstimated: moveIn.estimated,
      takeoverDepartAt: at,
      outAt,
      entry: true,
    };
  }
  return null;
}

export type ChangeKind = 'add' | 'cancel' | 'reassign';

export type ShuntChange = {
  key: string;
  at: number;
  kind: ChangeKind;
  taskKind: PlanTaskKind;
  tripCode: string | null;
  route: string;
  before: string | null;
  after: string | null;
  estimated?: boolean;
  /** 加開的調車預估要開多久 */
  durationMs?: number;
};

export type ShuntOrder = {
  code: string;
  outgoing: string;
  incoming: string;
  window: SwapWindow;
  /** 只有受影響的任務 */
  changes: ShuntChange[];
  /** 換手前後的任務，畫面用低顯示度帶出前後文 */
  context: PlanTask[];
  counts: { add: number; cancel: number; reassign: number; passenger: number; unaffected: number };
};

const routeOf = (task: PlanTask) => `${task.origin} → ${task.destination}`;

/** 組調車單。班次時刻都不變，只變「誰來開」，以及為了換手多出來的移動 */
export function buildShuntOrder(args: {
  tasks: readonly PlanTask[];
  outgoing: FleetCar;
  incoming: FleetCar;
  window: SwapWindow;
}): ShuntOrder {
  const { tasks, outgoing, incoming, window } = args;
  const pickup = rowLocationAt(tasks, incoming.row, window.readyAt) ?? '原停放位置';
  const moveOut = movePath(travelEdges(tasks), window.location, pickup, 3 * MINUTE_MS);
  const arrivedAt = window.takeoverDepartAt + window.moveInMs;
  // 接手車承接之後，換下的車才離開；收班後沒有下一班要等，到位就走（收班進場則照原本進場時刻離開月台）
  const moveOutAt = window.outAt || (window.endOfDay ? arrivedAt : Math.max(arrivedAt, window.next.depart_at));

  const changes: ShuntChange[] = [
    {
      key: 'add-incoming',
      at: window.takeoverDepartAt,
      kind: 'add',
      taskKind: 'movement',
      tripCode: null,
      route: `${pickup} → ${window.meetAt}`,
      before: null,
      after: incoming.code,
      estimated: window.moveInEstimated,
      durationMs: window.moveInMs,
    },
    {
      key: 'add-outgoing',
      at: moveOutAt,
      kind: 'add',
      taskKind: 'movement',
      tripCode: null,
      route: `${window.location} → ${pickup}`,
      before: null,
      after: outgoing.code,
      estimated: moveOut.estimated,
      durationMs: Math.max(MINUTE_MS, moveOut.ms),
    },
  ];
  for (const task of window.cancelled) {
    changes.push({
      key: `cancel-${task.trip_code}`,
      at: task.depart_at,
      kind: 'cancel',
      taskKind: task.kind,
      tripCode: task.trip_code,
      route: routeOf(task),
      before: outgoing.code,
      after: null,
    });
  }
  for (const task of tasks) {
    const fromOutgoingRow =
      task.timeline_row === outgoing.row && !window.endOfDay && task.depart_at >= window.next.depart_at;
    const fromIncomingRow = task.timeline_row === incoming.row && task.depart_at >= moveOutAt;
    if (!fromOutgoingRow && !fromIncomingRow) continue;
    changes.push({
      key: `reassign-${task.trip_code}`,
      at: task.depart_at,
      kind: 'reassign',
      taskKind: task.kind,
      tripCode: task.trip_code,
      route: routeOf(task),
      before: fromOutgoingRow ? outgoing.code : incoming.code,
      after: fromOutgoingRow ? incoming.code : outgoing.code,
    });
  }
  changes.sort((a, b) => a.at - b.at);

  const contextFrom = window.readyAt - 30 * MINUTE_MS;
  const contextTo = window.next.depart_at + 30 * MINUTE_MS;
  const touched = new Set(changes.map((change) => change.tripCode));
  const context = sortByDepart(tasks).filter(
    (task) => task.depart_at >= contextFrom && task.depart_at <= contextTo && !touched.has(task.trip_code),
  );

  const count = (kind: ChangeKind) => changes.filter((change) => change.kind === kind).length;
  const existing = changes.filter((change) => change.tripCode != null).length;
  return {
    code: `調車-${outgoing.code}-${incoming.code}-${window.id}`,
    outgoing: outgoing.code,
    incoming: incoming.code,
    window,
    changes,
    context,
    counts: {
      add: count('add'),
      cancel: count('cancel'),
      reassign: count('reassign'),
      passenger: changes.filter((change) => change.kind === 'reassign' && change.taskKind === 'passenger').length,
      unaffected: tasks.length - existing,
    },
  };
}

/** 某一列此刻的運營狀態 */
export function rowStateAt(tasks: readonly PlanTask[], row: number, at: number): string {
  const running = tasks.find(
    (task) => task.timeline_row === row && task.depart_at <= at && taskEnd(task) > at,
  );
  if (!running) return '停放中';
  if (running.kind === 'passenger') return '載客中';
  if (running.kind === 'movement') return '空車移動';
  return zoneLabel(running).replace(/區$/, '中');
}

const minuteOfDay = (ms: number) => {
  const date = new Date(ms);
  return date.getHours() * 60 + date.getMinutes();
};
const parseHm = (value: string) => {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};

/** 時間範圍可跨午夜，例如 23:00–02:00 */
export function inTimeRange(at: number, start: string, end: string): boolean {
  const minute = minuteOfDay(at);
  const from = parseHm(start);
  const to = parseHm(end);
  return from <= to ? minute >= from && minute <= to : minute >= from || minute <= to;
}

const hm = (ms: number) => {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/** 排不進去的原因，盡量講出這一列在時段內實際在做什麼 */
export function noWindowReason(tasks: readonly PlanTask[], row: number, rules: RotationRules): string {
  const range = `${rules.windowStart}–${rules.windowEnd}`;
  const generic = `${range} 內找不到可換手的時間`;
  const inWindow = (at: number) => inTimeRange(at, rules.windowStart, rules.windowEnd);
  const own = sortByDepart(tasks.filter((task) => task.timeline_row === row));
  // 時段內停著的那一段（過夜停放）；一天開頭延續前一晚的那段不算
  const park = [...own].reverse().find((task) => {
    if (task.kind !== 'maintenance' || taskEnd(task) - task.depart_at < MIN_DWELL_MS) return false;
    for (let at = task.depart_at; at <= taskEnd(task); at += 5 * MINUTE_MS) if (inWindow(at)) return true;
    return inWindow(taskEnd(task));
  });
  if (!park) return generic;
  const before = own.filter((task) => task.depart_at <= park.depart_at);
  const entry = [...before].reverse().find((task) => task.kind === 'movement' && task.destination === park.origin && task.origin !== park.origin);
  if (!entry || inWindow(entry.depart_at)) return generic;
  const move = own.find(
    (task) => task.kind === 'movement' && task.origin !== task.destination && task.depart_at >= taskEnd(park) && inWindow(task.depart_at),
  );
  const head = `收班進場 ${hm(entry.depart_at)}（${park.origin}）`;
  if (!move) return `${head}，${range} 內一直停在場內，沒有換手的時機`;
  const carriesPassengers = own.some((task) => task.kind === 'passenger' && task.depart_at >= taskEnd(move));
  return carriesPassengers
    ? `${head}，${range} 內下一次移動是 ${hm(move.depart_at)} ${move.origin} → ${move.destination} 出場接載客；在那裡換手要改派當天班次，第一版不做`
    : generic;
}

/**
 * 這一列時段內其實有換手的時機，但可接替的車都不能用時，講出是哪台車、還有什麼任務。
 * 輪替隔天才生效，接替車那一列當天之後的移動、載客還是派給它，所以那一列當天還要出車就不能去接別人。
 */
function blockedReason(
  tasks: readonly PlanTask[],
  outgoing: FleetCar,
  spares: readonly FleetCar[],
  rules: RotationRules,
  dayStart: number,
): string {
  const base = noWindowReason(tasks, outgoing.row, rules);
  if (!base.endsWith('找不到可換手的時間')) return base;
  const from = dayStart + parseHm(rules.windowStart) * MINUTE_MS;
  const notes = spares.flatMap((spare) => {
    const next = sortByDepart(tasks.filter((task) => task.timeline_row === spare.row)).find(
      (task) => task.kind !== 'maintenance' && task.origin !== task.destination && task.depart_at >= from,
    );
    return next ? [`${spare.code}（第 ${spare.row} 運用）${hm(next.depart_at)} 還要出車`] : [];
  });
  return notes.length === spares.length && notes.length > 0
    ? `${rules.windowStart}–${rules.windowEnd} 的可接替車今天都還有任務：${notes.join('、')}`
    : base;
}

export type DailyReport = {
  orders: ShuntOrder[];
  /** 到了輪替里程但今天排不進去 */
  blocked: { code: string; reason: string }[];
};

/** 輪替之間至少隔這麼久，前一組的車放掉場區資源後下一組才進來 */
export const ROTATION_RESOURCE_BUFFER_MS = 2 * MINUTE_MS;

/**
 * 一組輪替占用場區的時間：接替車出發、接班，到換下的車開回格位為止，再加緩衝。
 * 只看到接班那一刻的話，回場期間下一組就可能進場（兩組車在單線場區對向）。
 */
export function orderSpan(order: ShuntOrder): [number, number] {
  const { window } = order;
  const out = order.changes.find((change) => change.key === 'add-outgoing');
  const outEnd = out ? out.at + (out.durationMs ?? MINUTE_MS) : 0;
  return [
    window.takeoverDepartAt,
    Math.max(window.next.depart_at, taskEnd(window.next), outEnd) + ROTATION_RESOURCE_BUFFER_MS,
  ];
}
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

/**
 * 產出輪替報告。已確認、略過、完成的項目不動，只排還沒處理的車。
 * 隊伍最前面的車先配里程最低的接替車；同一時間只做一組，場區才不會兩組同時進出。
 */
export function buildDailyReport(args: {
  tasks: readonly PlanTask[];
  cars: readonly FleetCar[];
  rules: RotationRules;
  now: number;
  dayStart: number;
  /** 不早於這個時刻才算換手點 */
  notBefore: number;
  /** 已確認、略過或完成的項目：這些車今天不再排，時間也不重疊 */
  keep?: readonly { order: ShuntOrder; status: string }[];
}): DailyReport {
  const { tasks, cars, rules, now, dayStart, notBefore, keep = [] } = args;
  const kept = keep.filter((item) => item.status !== 'pending');
  const used = new Set(kept.flatMap((item) => [item.order.outgoing, item.order.incoming]));
  const spans = kept.filter((item) => item.status !== 'skipped').map((item) => orderSpan(item.order));
  const orders: ShuntOrder[] = [];
  const spares = takeoverCandidates({ cars, rules, dayStart }).filter((car) => !used.has(car.code));
  const blocked: DailyReport['blocked'] = [];

  for (const outgoing of rotationQueue(cars, rules)) {
    if (used.has(outgoing.code)) continue;
    if (spares.length === 0) {
      blocked.push({ code: outgoing.code, reason: '沒有可接替車輛' });
      continue;
    }
    let match: { incoming: FleetCar; order: ShuntOrder } | null = null;
    for (const incoming of spares) {
      const windows = findSwapWindows({
        tasks,
        row: outgoing.row,
        takeoverRow: incoming.row,
        dayStart,
        notBefore,
        allowDepart: (at) => inTimeRange(at, rules.windowStart, rules.windowEnd),
      }).filter(
        (window) =>
          window.endOfDay &&
          window.skippedService.length === 0 &&
          inTimeRange(window.takeoverDepartAt, rules.windowStart, rules.windowEnd),
      );
      for (const window of windows) {
        // 占用時間要含回場，所以先組出調車單才知道整段要多久
        const order = buildShuntOrder({ tasks, outgoing, incoming, window });
        if (spans.some((span) => overlaps(span, orderSpan(order)))) continue;
        match = { incoming, order };
        break;
      }
      if (match) break;
    }
    if (!match) {
      blocked.push({ code: outgoing.code, reason: blockedReason(tasks, outgoing, spares, rules, dayStart) });
      continue;
    }
    orders.push(match.order);
    spans.push(orderSpan(match.order));
    spares.splice(spares.indexOf(match.incoming), 1);
  }
  return { orders, blocked };
}
