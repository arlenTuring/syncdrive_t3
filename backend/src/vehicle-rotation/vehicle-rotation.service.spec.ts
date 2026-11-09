import { buildOrderId, type PlannedDispatch } from '../dispatch/dispatch.plan';
import type { OrderState, ShuntLeg } from './rotation.recovery';
import type { ItemRow, RuntimePatch } from './rotation.store';
import { VehicleRotationService } from './vehicle-rotation.service';

/**
 * 服務層整合測試：監看流程照真實順序跑（決定 → 寫庫 → 取消 → 下單 → 結案），
 * 資料庫、派遣、訂單換成記憶體版本。車端回報由測試直接改訂單狀態模擬。
 */

const DAY = '2026-11-10';
const NEXT = '2026-11-11';
const T0 = Date.parse('2026-11-10T23:30:00+08:00');
const MIN = 60_000;

function point(name: string, kind: 'station' | 'facility' = 'facility') {
  return { id: name, name, kind, arriveAt: null, departAt: null } as unknown as PlannedDispatch['origin'];
}

function task(args: Partial<PlannedDispatch> & { tripCode: string; vehicleCode: string; departAt: number; row: number }): PlannedDispatch {
  const arriveAt = args.arriveAt ?? args.departAt + 5 * MIN;
  return {
    kind: args.kind ?? 'passenger',
    maintenance: null,
    orderId: args.orderId ?? buildOrderId(args.tripCode, args.departAt),
    tripCode: args.tripCode,
    planBlockId: null,
    vehicleCode: args.vehicleCode,
    timelineRow: args.row,
    taskType: 'passenger',
    cardLabel: args.tripCode,
    routeCode: null,
    routeName: args.tripCode,
    transitionPurpose: null,
    servicePurpose: null,
    transitionFacility: null,
    departAt: args.departAt,
    arriveAt,
    origin: args.origin ?? point('M1'),
    destination: args.destination ?? point('T3', 'station'),
    stations: [],
  } as PlannedDispatch;
}

class FakeStore {
  items = new Map<string, ItemRow>();
  orders: OrderState[] = [];
  saves: RuntimePatch[] = [];

  addOrder(partial: Partial<OrderState> & { orderId: string; vehicle: string }): OrderState {
    const state: OrderState = {
      planOrderId: null,
      status: 'PENDING',
      plannedEnd: null,
      startedAt: null,
      endedAt: null,
      cancelRequestedAt: null,
      closedReason: null,
      createdAt: this.orders.length + 1,
      progressKey: null,
      ...partial,
    };
    this.orders.push(state);
    return state;
  }
  order(id: string): OrderState {
    const found = [...this.orders].reverse().find((o) => o.orderId === id || o.planOrderId === id);
    if (!found) throw new Error(`no order ${id}`);
    return found;
  }
  async openItems() {
    return [...this.items.values()].filter((i) => i.status === 'confirmed' || (i.status === 'aborted' && i.recovery_state === 'running')).map(clone);
  }
  async item(id: string) {
    const row = this.items.get(id);
    return row ? clone(row) : null;
  }
  async ordersFor(ids: readonly string[]) {
    return this.orders.filter((o) => ids.includes(o.orderId) || (o.planOrderId != null && ids.includes(o.planOrderId))).map((o) => ({ ...o }));
  }
  async activeOrders(vehicles: readonly string[]) {
    return this.orders
      .filter((o) => vehicles.includes(o.vehicle) && (o.status === 'PENDING' || o.status === 'PROCESSING') && o.cancelRequestedAt == null)
      .map((o) => ({ orderId: o.orderId, planOrderId: o.planOrderId, vehicle: o.vehicle, status: o.status, plannedStart: 0 }));
  }
  busy = new Set<string>();
  async yardOrdersBefore() {
    return [];
  }
  async busyVehicles(vehicles: readonly string[]) {
    return new Set(vehicles.filter((code) => this.busy.has(code)));
  }
  async save(id: string, patch: RuntimePatch) {
    this.saves.push(patch);
    const row = this.items.get(id)!;
    if (patch.shunts) row.shunts = clone(patch.shunts);
    if (patch.status) row.status = patch.status;
    if (patch.recoveryState) row.recovery_state = patch.recoveryState;
    if (patch.fault !== undefined) row.fault = patch.fault;
    if (patch.cancelledOrderIds) row.cancelled_order_ids = [...patch.cancelledOrderIds];
    if (patch.history?.length) row.history = [...row.history, ...patch.history];
  }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

type Harness = ReturnType<typeof harness>;

function harness(options: { planToday?: PlannedDispatch[]; planNext?: PlannedDispatch[] } = {}) {
  const store = new FakeStore();
  let now = T0;
  const issued: ShuntLeg[] = [];
  const engine = {
    failIssue: 0,
    planToday: options.planToday ?? [],
    planNext: options.planNext ?? [],
    async planForRotation(day: string) {
      return { shiftId: 's', shiftName: 's', planned: day === DAY ? this.planToday : this.planNext, skipped: [] };
    },
    async issueRotationOrder(leg: ShuntLeg) {
      if (this.failIssue > 0) {
        this.failIssue -= 1;
        throw new Error('主系統暫時無法下單');
      }
      if (store.orders.some((o) => o.orderId === leg.orderId)) return; // 冪等
      issued.push(leg);
      store.addOrder({ orderId: leg.orderId, vehicle: leg.vehicleCode, plannedEnd: leg.arriveAt });
    },
  };
  const cancels: Array<{ id: string; resend?: boolean; retireFaulted?: boolean }> = [];
  const orders = {
    async requestCancel(id: string, opts: { resend?: boolean; retireFaulted?: boolean } = {}) {
      cancels.push({ id, ...opts });
      const o = store.orders.find((entry) => entry.orderId === id);
      if (o && o.cancelRequestedAt == null) o.cancelRequestedAt = Date.now();
      return o;
    },
  };
  const clock = { now: () => now, operatingDay: () => DAY };
  const dataSource = { query: jest.fn().mockResolvedValue([]), transaction: jest.fn() };
  const make = () => {
    const service = new VehicleRotationService(dataSource as never, engine as never, clock as never, orders as never, store as never);
    jest.spyOn(service as never as { finish: () => Promise<void> }, 'finish').mockImplementation(async (...args: unknown[]) => {
      const item = args[0] as ItemRow;
      const legs = args[2] as ShuntLeg[];
      const row = store.items.get(item.id)!;
      row.status = 'done';
      row.fault = legs.some((leg) => leg.role === 'out' && leg.gaveUp) ? `輪替已生效；${item.outgoing} 未回格位，原地待命` : null;
    });
    return service;
  };
  const h = {
    store,
    engine,
    cancels,
    issued,
    service: make(),
    restart() {
      h.service = make();
    },
    advance(ms: number) {
      now += ms;
    },
    get now() {
      return now;
    },
    async tick(id = 'r1') {
      const row = await store.item(id);
      if (row) await h.service.monitorItem(row);
    },
  };
  return h;
}

/** 一筆已確認的輪替：PMS02（備用，M3）接替 PMS01 第 1 列 */
function addRotation(h: Harness, overrides: Partial<ItemRow> = {}) {
  const inAt = T0 + 2 * MIN;
  const inLeg: ShuntLeg = {
    ...task({ tripCode: 'RT1110R1A', vehicleCode: 'PMS02', departAt: inAt, arriveAt: inAt + 4 * MIN, row: 5, kind: 'movement', origin: point('M3'), destination: point('M1') }),
    role: 'in', phase: 'planned', attempt: 1,
  };
  const outLeg: ShuntLeg = {
    ...task({ tripCode: 'RT1110R1B', vehicleCode: 'PMS01', departAt: inAt + 4 * MIN, arriveAt: inAt + 8 * MIN, row: 1, kind: 'movement', origin: point('M1'), destination: point('M3') }),
    role: 'out', phase: 'hold', attempt: 1,
  };
  const row: ItemRow = {
    id: 'r1',
    operating_day: DAY,
    effective_day: NEXT,
    outgoing: 'PMS01',
    incoming: 'PMS02',
    status: 'confirmed',
    recovery_state: 'none',
    shunt_order: { window: { row: 1, takeoverDepartAt: inAt, moveInMs: 4 * MIN, meetAt: 'M1', cancelled: [] } } as never,
    shunts: [inLeg, outLeg],
    cancelled_order_ids: [],
    fault: null,
    history: [],
    created_at: String(T0),
    confirmed_at: String(T0),
    confirmed_by: 'test',
    finished_at: null,
    ...overrides,
  };
  h.store.items.set(row.id, row);
  return { inLeg, outLeg, row };
}

const item = (h: Harness) => h.store.items.get('r1')!;
const legs = (h: Harness, role: string) => item(h).shunts.filter((leg) => leg.role === role);
/** 接班時間比較晚：卡住之後還來得及重發 */
const roomy = { shunt_order: { window: { row: 1, takeoverDepartAt: T0 + 30 * MIN, moveInMs: 4 * MIN, meetAt: 'M1', cancelled: [] } } as never };

describe('VehicleRotationService 監看流程', () => {
  it('接替調車卡住：先要求取消，車端沒回覆前不下重發單，逾時重送取消，確認結案後才下單', async () => {
    const h = harness();
    const { inLeg } = addRotation(h, roomy);
    const old = h.store.addOrder({ orderId: inLeg.orderId, vehicle: 'PMS02', status: 'PROCESSING', plannedEnd: inLeg.arriveAt, startedAt: inLeg.departAt });

    h.advance(1 * MIN);
    // 到了計畫結束＋寬限還沒到：卡住
    h.advance(inLeg.arriveAt - h.now + 6 * MIN);
    await h.tick();
    const retry = legs(h, 'in').at(-1)!;
    expect(retry.phase).toBe('queued');
    expect(retry.waitFor).toEqual([old.orderId]);
    expect(h.cancels.map((c) => c.id)).toContain(old.orderId);
    expect(h.issued).toHaveLength(0);

    // 車端遲遲沒回覆：重送取消通知，仍不下單
    old.cancelRequestedAt = Date.now() - 60_000;
    h.advance(10_000);
    await h.tick();
    expect(h.cancels.some((c) => c.id === old.orderId && c.resend)).toBe(true);
    expect(h.issued).toHaveLength(0);

    // 車端確認停下（取消用 FAULTED 結案）：這時才下重發
    old.status = 'FAULTED';
    old.closedReason = 'cancelled_by_center';
    h.advance(10_000);
    await h.tick();
    expect(h.issued.map((leg) => leg.orderId)).toEqual([retry.orderId]);
    expect(legs(h, 'in').at(-1)!.phase).toBe('issued');
    expect(item(h).history.some((entry) => entry.kind === 'retry')).toBe(true);
  });

  it('下單失敗不會遺失：記下原因，下次檢查補送，編號不變', async () => {
    const h = harness();
    const { inLeg } = addRotation(h);
    h.store.addOrder({ orderId: inLeg.orderId, vehicle: 'PMS02', status: 'FAULTED', startedAt: inLeg.departAt });
    h.engine.failIssue = 1;
    h.advance(3 * MIN);
    await h.tick();
    const retry = legs(h, 'in').at(-1)!;
    expect(retry.phase).toBe('queued');
    expect(retry.issueError).toMatch(/無法下單/);
    // 故障中的舊單記取消，不能再復歸
    expect(h.cancels).toContainEqual(expect.objectContaining({ id: inLeg.orderId, retireFaulted: true }));

    h.advance(5_000);
    await h.tick();
    expect(h.issued.map((leg) => leg.orderId)).toEqual([retry.orderId]);
  });

  it('中止寫進資料庫後程序重啟：補救照資料庫繼續，補發被換車任務、接替車回格位', async () => {
    const fallbackTask = task({ tripCode: 'MO1', vehicleCode: 'PMS01', departAt: T0 + 10 * MIN, row: 1, kind: 'movement' });
    const h = harness({ planToday: [fallbackTask] });
    const { inLeg } = addRotation(h, { cancelled_order_ids: [fallbackTask.orderId] });
    const old = h.store.addOrder({ orderId: inLeg.orderId, vehicle: 'PMS02', status: 'PROCESSING', startedAt: inLeg.departAt, plannedEnd: inLeg.arriveAt });
    // 三次都失敗：來不及再重發，中止
    h.advance(20 * MIN);
    h.engine.failIssue = 99; // 中止這次檢查送單全部失敗，模擬送到一半程序停掉
    await h.tick();
    expect(item(h).status).toBe('aborted');
    expect(item(h).recovery_state).toBe('running');
    const recovery = item(h).shunts.filter((leg) => leg.role === 'fallback' || leg.role === 'return');
    expect(recovery.map((leg) => leg.role).sort()).toEqual(['fallback', 'return']);
    expect(recovery.every((leg) => leg.phase === 'queued')).toBe(true);
    // 回格位：從實際位置開回出發的格位，不是交換原調車起終點
    const back = recovery.find((leg) => leg.role === 'return')!;
    expect(back.origin?.name).toBe('M3');
    expect(back.destination?.name).toBe('M3');
    expect(back.waitFor).toEqual([old.orderId]);

    // 重啟：新的服務實例只靠資料庫
    h.restart();
    h.engine.failIssue = 0;
    h.advance(5_000);
    await h.tick();
    // 補發被換車的任務不用等；接替車回格位要等舊單取消確認
    expect(h.issued.map((leg) => leg.orderId)).toEqual([`${fallbackTask.orderId}-RB`]);
    old.status = 'FAULTED';
    old.closedReason = 'cancelled_by_center';
    h.advance(5_000);
    await h.tick();
    expect(h.issued.map((leg) => leg.role)).toEqual(['fallback', 'return']);

    // 補救任務還沒做完不能結案
    expect(item(h).recovery_state).toBe('running');
    for (const leg of h.issued) h.store.order(leg.orderId).status = 'END';
    h.advance(5_000);
    await h.tick();
    expect(item(h).recovery_state).toBe('done');
  });

  it('重播已發給錯車的單：用 plan_order_id 對到計畫，收回並等取消確認後改發計畫上的車', async () => {
    const swapped = task({ tripCode: 'NT0001', vehicleCode: 'PMS01', departAt: T0 + 40 * MIN, row: 1 });
    const h = harness({ planNext: [swapped] });
    addRotation(h, { status: 'aborted', recovery_state: 'running' });
    // 重播照對調後的計畫發給了 PMS02，編號是模擬器自己的
    const wrong = h.store.addOrder({ orderId: 'SIM-PLAN-run1-NT0001', planOrderId: swapped.orderId, vehicle: 'PMS02', status: 'PENDING' });
    await h.tick();
    expect(h.cancels.map((c) => c.id)).toContain(wrong.orderId);
    const rb = item(h).shunts.find((leg) => leg.orderId === `${swapped.orderId}-RB`)!;
    expect(rb.vehicleCode).toBe('PMS01');
    expect(rb.waitFor).toEqual([wrong.orderId]);
    expect(h.issued).toHaveLength(0);
    expect(item(h).cancelled_order_ids).toContain(swapped.orderId);

    // 同一張不會收兩次、也不會補兩張
    await h.tick();
    expect(item(h).shunts.filter((leg) => leg.orderId === rb.orderId)).toHaveLength(1);

    wrong.status = 'FAULTED';
    wrong.closedReason = 'cancelled_by_center';
    await h.tick();
    expect(h.issued.map((leg) => [leg.orderId, leg.vehicleCode])).toEqual([[rb.orderId, 'PMS01']]);
  });

  it('回場一直失敗：要求停止，車端確認停下才算原地待命，輪替生效但不畫成回格位成功', async () => {
    const first = task({ tripCode: 'NT0100', vehicleCode: 'PMS02', departAt: T0 + 60 * MIN, row: 1 });
    const h = harness({ planNext: [first] });
    const { inLeg } = addRotation(h);
    h.store.addOrder({ orderId: inLeg.orderId, vehicle: 'PMS02', status: 'END', startedAt: inLeg.departAt, endedAt: inLeg.arriveAt });
    h.advance(6 * MIN);
    await h.tick(); // 發回場
    for (let attempt = 1; attempt <= 3; attempt++) {
      const out = legs(h, 'out').at(-1)!;
      expect(out.phase).toBe('issued');
      h.store.order(out.orderId).status = 'FAULTED';
      h.advance(MIN);
      await h.tick();
    }
    const last = legs(h, 'out').at(-1)!;
    expect(last.strandAt).toBeDefined();
    expect(last.gaveUp).toBeUndefined();
    // 下一次檢查：單都已結案（車停了）才記原地待命
    h.advance(10_000);
    await h.tick();
    expect(legs(h, 'out').at(-1)!.gaveUp).toBe(true);
    expect(item(h).status).toBe('confirmed'); // 還沒承接

    h.store.addOrder({ orderId: 'SIM-PLAN-run1-NT0100', planOrderId: first.orderId, vehicle: 'PMS02', status: 'PROCESSING' });
    await h.tick();
    expect(item(h).status).toBe('done');
    expect(item(h).fault).toMatch(/原地待命/);
    expect(item(h).history.map((entry) => entry.kind)).toEqual(expect.arrayContaining(['retry', 'strand-request', 'strand']));
  });

  it('承接只認生效日那一列的第一班由接替車開：別列、別天的載客單不算', async () => {
    const first = task({ tripCode: 'NT0100', vehicleCode: 'PMS02', departAt: T0 + 60 * MIN, row: 1 });
    const h = harness({ planNext: [first] });
    const { inLeg } = addRotation(h);
    h.store.addOrder({ orderId: inLeg.orderId, vehicle: 'PMS02', status: 'END' });
    h.advance(6 * MIN);
    await h.tick();
    h.store.order(legs(h, 'out')[0].orderId).status = 'END';
    // 接替車開了別列的載客單
    h.store.addOrder({ orderId: '261111-TS0003', vehicle: 'PMS02', status: 'END' });
    await h.tick();
    expect(item(h).status).toBe('confirmed');
    // 被換車開了那一列的第一班：也不算
    h.store.addOrder({ orderId: 'SIM-PLAN-run1-NT0100', planOrderId: first.orderId, vehicle: 'PMS01', status: 'PROCESSING' });
    await h.tick();
    expect(item(h).status).toBe('confirmed');
    h.store.addOrder({ orderId: 'SIM-PLAN-run2-NT0100', planOrderId: first.orderId, vehicle: 'PMS02', status: 'PROCESSING' });
    await h.tick();
    expect(item(h).status).toBe('done');
  });

  it('接替單原本那張晚到也算到位：還沒發出的重發不再發，已發出的重發收掉、取消確認後才發回場', async () => {
    const h = harness();
    const { inLeg } = addRotation(h, roomy);
    const old = h.store.addOrder({ orderId: inLeg.orderId, vehicle: 'PMS02', status: 'PROCESSING', plannedEnd: inLeg.arriveAt });
    h.advance(inLeg.arriveAt - h.now + 6 * MIN);
    await h.tick(); // 排重發，等舊單取消
    const queued = legs(h, 'in').at(-1)!;
    old.status = 'END'; // 取消之前其實開到了
    await h.tick();
    expect(h.issued.some((leg) => leg.orderId === queued.orderId)).toBe(false);
    expect(legs(h, 'in').at(-1)!.superseded).toBe(true);
    expect(h.issued.some((leg) => leg.role === 'out')).toBe(true);
  });

  it('已發出的重發單還在跑時接替車到位：收掉重發單，確認結案後才發回場', async () => {
    const h = harness();
    const { inLeg } = addRotation(h, roomy);
    const old = h.store.addOrder({ orderId: inLeg.orderId, vehicle: 'PMS02', status: 'FAULTED', plannedEnd: inLeg.arriveAt });
    h.advance(3 * MIN);
    await h.tick(); // 故障：重發馬上下單
    const retry = legs(h, 'in').at(-1)!;
    expect(h.issued.map((leg) => leg.orderId)).toEqual([retry.orderId]);
    // 舊單由車端復歸後跑完（重複、亂序的回報）；重發單還在等
    old.status = 'END';
    await h.tick();
    expect(h.cancels.map((c) => c.id)).toContain(retry.orderId);
    const out = legs(h, 'out')[0];
    expect(out.phase).toBe('queued');
    expect(out.waitFor).toEqual([retry.orderId]);
    expect(h.issued.some((leg) => leg.role === 'out')).toBe(false);
    h.store.order(retry.orderId).status = 'FAULTED';
    await h.tick();
    expect(h.issued.some((leg) => leg.role === 'out')).toBe(true);
  });

  it('執行中的調車比預估慢但一直有進度：不算卡住；停滯超過門檻才重發，重發從目前位置直接去目的地', async () => {
    const first = task({ tripCode: 'NT0100', vehicleCode: 'PMS02', departAt: T0 + 60 * MIN, row: 1 });
    const h = harness({ planNext: [first] });
    const { inLeg } = addRotation(h);
    h.store.addOrder({ orderId: inLeg.orderId, vehicle: 'PMS02', status: 'END' });
    h.advance(6 * MIN);
    await h.tick(); // 發回場
    const out = legs(h, 'out')[0];
    const order = h.store.order(out.orderId);
    order.status = 'PROCESSING';
    order.startedAt = h.now;
    order.plannedEnd = out.arriveAt;
    // 超過計畫結束很久，但每次檢查進度都有變
    for (let i = 0; i < 6; i++) {
      h.advance(5 * MIN);
      order.progressKey = `2:${80 - i * 10}`;
      await h.tick();
    }
    expect(legs(h, 'out')).toHaveLength(1);
    expect(h.cancels.map((c) => c.id)).not.toContain(order.orderId);
    // 停滯 8 分鐘以上：重發
    h.advance(9 * MIN);
    await h.tick();
    const retry = legs(h, 'out').at(-1)!;
    expect(legs(h, 'out')).toHaveLength(2);
    expect(item(h).history.at(-1)?.text).toMatch(/停滯沒有進度/);
    // 車已開動過：起點改成目的地（車端從實際位置開過去），不先開回原起點
    expect(retry.origin?.name).toBe(out.destination?.name);
    // 歷程不重複
    const texts = item(h).history.map((entry) => entry.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('重發單過了發車時間還沒開始（車還在故障、錯過發車）：2 分鐘內就再發一次，不等到計畫結束', async () => {
    const h = harness();
    const { inLeg } = addRotation(h, roomy);
    h.store.addOrder({ orderId: inLeg.orderId, vehicle: 'PMS02', status: 'FAULTED', startedAt: inLeg.departAt });
    h.advance(3 * MIN);
    await h.tick(); // 故障：重發
    const second = legs(h, 'in').at(-1)!;
    expect(h.issued.map((leg) => leg.orderId)).toEqual([second.orderId]);
    // 車還在故障中，重發單一直待發（發車時刻＝重發後 60 秒，再過 2 分鐘）
    h.advance(4 * MIN);
    await h.tick();
    const third = legs(h, 'in').at(-1)!;
    expect(third.orderId).not.toBe(second.orderId);
    expect(item(h).status).toBe('confirmed');
    expect(item(h).history.some((entry) => /過了發車時間沒有開始/.test(entry.text))).toBe(true);
    expect(h.cancels.map((c) => c.id)).toContain(second.orderId);
  });

  it('車手上有別張單在跑：排在後面的重發單不算錯過發車', async () => {
    const h = harness();
    const { inLeg } = addRotation(h, roomy);
    h.store.addOrder({ orderId: inLeg.orderId, vehicle: 'PMS02', status: 'PENDING', plannedEnd: inLeg.arriveAt });
    h.store.busy.add('PMS02');
    h.advance(inLeg.departAt - h.now + 3 * MIN);
    await h.tick();
    expect(legs(h, 'in')).toHaveLength(1);
    h.store.busy.clear();
    await h.tick();
    expect(legs(h, 'in')).toHaveLength(2);
  });

  it('接替車已直接開始那一列的第一班：接替調車視為到位，發回場，不中止', async () => {
    const first = task({ tripCode: 'NT0100', vehicleCode: 'PMS02', departAt: T0 + 3 * MIN, row: 1 });
    const h = harness({ planNext: [first] });
    const { inLeg } = addRotation(h);
    h.store.addOrder({ orderId: inLeg.orderId, vehicle: 'PMS02', status: 'FAULTED' });
    h.store.addOrder({ orderId: 'SIM-PLAN-r-NT0100', planOrderId: first.orderId, vehicle: 'PMS02', status: 'PROCESSING' });
    h.advance(5 * MIN);
    await h.tick();
    expect(item(h).status).toBe('confirmed');
    expect(item(h).history.some((entry) => entry.kind === 'in-by-service')).toBe(true);
    expect(h.issued.some((leg) => leg.role === 'out')).toBe(true);
    expect(h.issued.some((leg) => leg.role === 'in')).toBe(false);
  });

  it('中止後補發同一台車的多段任務：後一段接在前一段之後才發車；錯過發車會重新排時間再發', async () => {
    const exitTask = task({ tripCode: 'OT1', vehicleCode: 'PMS01', departAt: T0 + 10 * MIN, arriveAt: T0 + 15 * MIN, row: 1, kind: 'movement' });
    const firstTrip = task({ tripCode: 'NT0000', vehicleCode: 'PMS01', departAt: T0 + 30 * MIN, row: 1 });
    const h = harness({ planToday: [exitTask], planNext: [firstTrip] });
    addRotation(h, { cancelled_order_ids: [exitTask.orderId] });
    h.advance(20 * MIN); // 接替單沒出現：中止，補發出場
    await h.tick();
    expect(item(h).status).toBe('aborted');
    const exitLeg = item(h).shunts.find((leg) => leg.role === 'fallback')!;
    // 重播照對調後的計畫把第一班發給了接替車
    const wrong = h.store.addOrder({ orderId: 'SIM-PLAN-r-NT0000', planOrderId: firstTrip.orderId, vehicle: 'PMS02', status: 'PENDING' });
    h.advance(10 * MIN);
    h.store.order(exitLeg.orderId).status = 'PROCESSING';
    await h.tick();
    const rb = item(h).shunts.find((leg) => leg.orderId === `${firstTrip.orderId}-RB`)!;
    expect(rb.departAt).toBeGreaterThanOrEqual(exitLeg.arriveAt);
    // 出場還在跑：補發的第一班不算錯過
    wrong.status = 'FAULTED';
    wrong.closedReason = 'cancelled_by_center';
    await h.tick();
    h.store.busy.add('PMS01');
    h.advance(rb.departAt - h.now + 3 * MIN);
    await h.tick();
    expect(item(h).shunts.filter((leg) => leg.orderId.startsWith(`${firstTrip.orderId}-RB`))).toHaveLength(1);
    // 出場做完、車閒著卻沒開：錯過發車，重新排時間再發一次
    h.store.busy.clear();
    h.store.order(exitLeg.orderId).status = 'END';
    await h.tick();
    expect(item(h).shunts.some((leg) => leg.orderId === `${firstTrip.orderId}-RB2`)).toBe(true);
    expect(item(h).recovery_state).toBe('running');
  });

  it('補發的出場還沒做、後面補發的第一班已經開始：出場不用再補，記下原因結案', async () => {
    const exitTask = task({ tripCode: 'OT1', vehicleCode: 'PMS01', departAt: T0 + 10 * MIN, arriveAt: T0 + 11 * MIN, row: 1, kind: 'movement' });
    const firstTrip = task({ tripCode: 'NT0000', vehicleCode: 'PMS01', departAt: T0 + 30 * MIN, row: 1 });
    const h = harness({ planToday: [exitTask], planNext: [firstTrip] });
    addRotation(h, { cancelled_order_ids: [exitTask.orderId] });
    h.advance(20 * MIN);
    await h.tick();
    h.store.addOrder({ orderId: 'SIM-PLAN-r-NT0000', planOrderId: firstTrip.orderId, vehicle: 'PMS02', status: 'FAULTED', closedReason: 'cancelled_by_center' });
    h.store.addOrder({ orderId: 'SIM-PLAN-x-NT0000', planOrderId: firstTrip.orderId, vehicle: 'PMS02', status: 'PENDING' });
    await h.tick();
    const rb = item(h).shunts.find((leg) => leg.orderId === `${firstTrip.orderId}-RB`)!;
    h.store.order('SIM-PLAN-x-NT0000').status = 'FAULTED';
    h.store.order('SIM-PLAN-x-NT0000').closedReason = 'cancelled_by_center';
    await h.tick();
    const rbOrder = h.store.order(rb.orderId);
    rbOrder.status = 'END';
    rbOrder.startedAt = h.now;
    await h.tick();
    const exitLeg = item(h).shunts.find((leg) => leg.orderId === `${exitTask.orderId}-RB`)!;
    expect(exitLeg.result).toBe('done');
    expect(exitLeg.failure).toMatch(/不用補/);
    expect(item(h).recovery_state).toBe('done');
  });

  it('補發的任務失敗：補救結束標成未完成，不當成功', async () => {
    const fallbackTask = task({ tripCode: 'MO1', vehicleCode: 'PMS01', departAt: T0 + 10 * MIN, row: 1, kind: 'movement' });
    const h = harness({ planToday: [fallbackTask] });
    addRotation(h, { cancelled_order_ids: [fallbackTask.orderId] });
    h.advance(20 * MIN); // 接替單一直沒出現：中止
    await h.tick();
    expect(item(h).status).toBe('aborted');
    const fb = h.issued.find((leg) => leg.role === 'fallback')!;
    h.store.order(fb.orderId).status = 'FAULTED';
    h.advance(MIN);
    await h.tick();
    expect(item(h).recovery_state).toBe('incomplete');
    expect(item(h).history.some((entry) => entry.kind === 'recovery-failed')).toBe(true);
  });
});
