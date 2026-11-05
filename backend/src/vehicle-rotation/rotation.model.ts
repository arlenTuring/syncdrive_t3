/**
 * 車輛輪替的計算。全部是純函式，不碰資料庫；讀寫在 vehicle-rotation.service.ts。
 *
 * <h3>誰該下來</h3>
 * 只看這台車自己：目前里程 ≥ 上次輪替里程 + 輪替基數。不跟別台車比，所以
 * 「某台車比另一台少 1000 公里」不會觸發輪替。沒有「超過就必須換」的上限：
 * 超過只是排得比較前面。
 *
 * <h3>誰能上去</h3>
 * 停在規則指定的格位、車輛清單沒有被鎖住（保留、大保養）。電量與休息時間不當門檻，
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
  /** 停在這些格位的車才能接替 */
  takeoverSlots: string[];
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
  takeoverSlots: ['M3', 'M4', 'D4', 'E1'],
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

export function isDue(car: FleetCar, rules: RotationRules): boolean {
  return car.onLine && car.currentKm >= nextRotationKm(car, rules);
}

/** 需要被輪替的隊伍：超過基數最多的排最前面 */
export function rotationQueue(cars: readonly FleetCar[], rules: RotationRules): FleetCar[] {
  return cars
    .filter((car) => isDue(car, rules))
    .sort((a, b) => b.currentKm - nextRotationKm(b, rules) - (a.currentKm - nextRotationKm(a, rules)));
}

/** 不能接替的原因；空陣列代表可以接替 */
export function takeoverBlockers(
  car: FleetCar,
  rules: RotationRules,
  location: string | null,
  dayStart: number,
): string[] {
  if (car.onLine) return ['線上服務中'];
  const reasons: string[] = [];
  if (car.hold !== 'available') reasons.push(HOLD_LABEL[car.hold]);
  if (car.rotatedOutAt != null && car.rotatedOutAt >= dayStart) reasons.push('今天剛換下');
  if (!location || !rules.takeoverSlots.includes(location)) reasons.push('不在可接替格位');
  return reasons;
}

/** 可接替的車：里程低的優先，讓里程平均 */
export function takeoverCandidates(args: {
  tasks: readonly PlanTask[];
  cars: readonly FleetCar[];
  rules: RotationRules;
  now: number;
  dayStart: number;
}): FleetCar[] {
  const { tasks, cars, rules, now, dayStart } = args;
  return cars
    .filter((car) => takeoverBlockers(car, rules, rowLocationAt(tasks, car.row, now), dayStart).length === 0)
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
};

const SERVICE_LABEL: Record<string, string> = { charging: '充電', inspection: '行檢', servicing: '保養' };

function skippedService(tasks: readonly PlanTask[]): string[] {
  const labels = tasks.map((task) => SERVICE_LABEL[task.maintenance?.maintenance_task_type ?? '']).filter(Boolean);
  return [...new Set(labels)];
}

const sortByDepart = (tasks: readonly PlanTask[]) =>
  [...tasks].sort((a, b) => a.depart_at - b.depart_at || a.trip_code.localeCompare(b.trip_code));

const taskEnd = (task: PlanTask) => task.arrive_at ?? task.depart_at;

/** 班表裡每段移動的時間（中位數），當成場內路網 */
function movementEdges(tasks: readonly PlanTask[]): Map<string, Map<string, number>> {
  const samples = new Map<string, Map<string, number[]>>();
  for (const task of tasks) {
    const ms = taskEnd(task) - task.depart_at;
    if (task.kind !== 'movement' || task.origin === task.destination || ms <= 0) continue;
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

const slotGroup = (name: string) => /^([A-Z]+)\d+$/.exec(name)?.[1] ?? null;

/** 班表沒有這一格的移動時，用同一區相鄰格位的移動代替（M4 → M1） */
function siblingSlot(edges: Map<string, Map<string, number>>, name: string, wantTarget: boolean): string | null {
  const group = slotGroup(name);
  if (!group) return null;
  const nodes = wantTarget ? [...edges.values()].flatMap((targets) => [...targets.keys()]) : [...edges.keys()];
  return nodes.filter((node) => slotGroup(node) === group).sort()[0] ?? null;
}

/** 沿班表出現過的移動找最短時間；班表裡走不到就用預設值，畫面標「預估」 */
function moveEstimate(
  edges: Map<string, Map<string, number>>,
  from: string,
  to: string,
  fallbackMs: number,
): { ms: number; estimated: boolean } {
  if (from === to) return { ms: 0, estimated: false };
  const start = edges.has(from) ? from : siblingSlot(edges, from, false);
  const hasTarget = [...edges.values()].some((targets) => targets.has(to));
  const end = hasTarget ? to : siblingSlot(edges, to, true);
  if (!start || !end) return { ms: fallbackMs, estimated: true };
  const best = new Map<string, number>([[start, 0]]);
  const open = new Set([start]);
  while (open.size) {
    const here = [...open].sort((a, b) => best.get(a)! - best.get(b)!)[0];
    open.delete(here);
    for (const [next, ms] of edges.get(here) ?? []) {
      const total = best.get(here)! + ms;
      if (total < (best.get(next) ?? Infinity)) {
        best.set(next, total);
        open.add(next);
      }
    }
  }
  const found = best.get(end);
  if (found == null) return { ms: fallbackMs, estimated: true };
  return { ms: found, estimated: start !== from || end !== to };
}

/** 某一列在某時刻停在哪：最後一個已開始任務的終點 */
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
}): SwapWindow[] {
  const { tasks, row, takeoverRow, dayStart, notBefore } = args;
  const own = sortByDepart(tasks.filter((task) => task.timeline_row === row));
  const takeoverTasks = sortByDepart(tasks.filter((task) => task.timeline_row === takeoverRow));
  const load = hourlyLoad(tasks, dayStart);
  const edges = movementEdges(tasks);
  const windows: SwapWindow[] = [];

  const lastPassenger = own.findLastIndex((task) => task.kind === 'passenger');

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
    const moveIn = moveEstimate(edges, from, meetAt, fallbackMs);
    const deadline = endOfDay ? taskEnd(next) : next.depart_at;
    // 收班後接替車取代那趟出場，到位時刻照原班表：場區單線上的對向移動都是照這個時間排開的，
    // 提早出場會跟其他車對向卡死
    const arriveBy = deadline - (endOfDay ? 0 : MARGIN_MS);
    const takeoverDepartAt = arriveBy - moveIn.ms;
    const slackMs = takeoverDepartAt - readyAt;
    if (slackMs < 0 || takeoverDepartAt < notBefore) return;
    const busy = takeoverTasks.some(
      (task) => task.kind !== 'maintenance' && task.depart_at < deadline && taskEnd(task) > takeoverDepartAt,
    );
    if (busy) return;

    // 接手車到位前就做完的場內任務照做：被換車手上有任務才不會閒置擋住場區入口
    const dropped = (endOfDay ? [...cancelled, next] : cancelled).filter(
      (task) => task.kind !== 'maintenance' || taskEnd(task) > arriveBy,
    );

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
    });
  });

  const rank = (item: SwapWindow) => {
    if (item.skippedService.length) return 3;
    if (item.endOfDay) return 0;
    return item.slackMs >= COMFORT_SLACK_MS ? 1 : 2;
  };
  return windows.sort((a, b) => rank(a) - rank(b) || a.hourDepartures - b.hourDepartures || b.slackMs - a.slackMs);
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
  const moveOut = moveEstimate(movementEdges(tasks), window.location, pickup, 3 * MINUTE_MS);
  const arrivedAt = window.takeoverDepartAt + window.moveInMs;
  // 接手車承接之後，換下的車才離開；收班後沒有下一班要等，到位就走
  const moveOutAt = window.endOfDay ? arrivedAt : Math.max(arrivedAt, window.next.depart_at);

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

export type DailyReport = {
  orders: ShuntOrder[];
  /** 到了輪替里程但今天排不進去 */
  blocked: { code: string; reason: string }[];
};

const swapSpan = (window: SwapWindow): [number, number] => [window.takeoverDepartAt, Math.max(window.next.depart_at, taskEnd(window.next))];
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
  const spans = kept.filter((item) => item.status !== 'skipped').map((item) => swapSpan(item.order.window));
  const orders: ShuntOrder[] = [];
  const spares = takeoverCandidates({ tasks, cars, rules, now, dayStart }).filter((car) => !used.has(car.code));
  const blocked: DailyReport['blocked'] = [];

  for (const outgoing of rotationQueue(cars, rules)) {
    if (used.has(outgoing.code)) continue;
    if (spares.length === 0) {
      blocked.push({ code: outgoing.code, reason: '沒有可接替車輛' });
      continue;
    }
    const match = spares
      .map((incoming) => ({
        incoming,
        window: findSwapWindows({ tasks, row: outgoing.row, takeoverRow: incoming.row, dayStart, notBefore }).find(
          (window) =>
            window.endOfDay &&
            window.skippedService.length === 0 &&
            inTimeRange(window.takeoverDepartAt, rules.windowStart, rules.windowEnd) &&
            !spans.some((span) => overlaps(span, swapSpan(window))),
        ),
      }))
      .find((candidate) => candidate.window);
    if (!match?.window) {
      blocked.push({ code: outgoing.code, reason: `${rules.windowStart}–${rules.windowEnd} 內找不到可換手的時間` });
      continue;
    }
    orders.push(buildShuntOrder({ tasks, outgoing, incoming: match.incoming, window: match.window }));
    spans.push(swapSpan(match.window));
    spares.splice(spares.indexOf(match.incoming), 1);
  }
  return { orders, blocked };
}
