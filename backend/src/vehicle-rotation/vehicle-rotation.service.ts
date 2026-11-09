import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { monitorEventLoopDelay, type IntervalHistogram } from 'perf_hooks';
import { DataSource } from 'typeorm';
import { DispatchEngineService } from '../dispatch/dispatch-engine.service';
import { buildOrderId, type DispatchPoint, type PlannedDispatch } from '../dispatch/dispatch.plan';
import { OperatingClockService } from '../operating-day/operating-clock.service';
import { OrderService } from '../order/order.service';
import {
  isOperatingDay,
  localMidnight,
  operatingDayOf,
  operatingDayStart,
} from '../operating-day/operating-day';
import {
  buildDailyReport,
  DEFAULT_ROTATION_RULES,
  nextRotationKm,
  rowPositionAt,
  rowStateAt,
  takeoverBlockers,
  type FleetCar,
  type HoldState,
  type PlanTask,
  type RotationRules,
  type ShuntOrder,
} from './rotation.model';
import {
  isActive,
  isClosed,
  legFailure,
  normalizeLegs,
  pendingBlockers,
  type HistoryEntry,
  type LegRole,
  type OrderState,
  type ShuntLeg,
} from './rotation.recovery';
import { indexStates, RotationRuntimeStore, type ItemRow, type RuntimePatch } from './rotation.store';

export type { ShuntLeg } from './rotation.recovery';

type StepStatus = 'waiting' | 'running' | 'done' | 'fault' | 'warn';

export type MonitorStep = {
  key: 'depart' | 'arrive' | 'takeover' | 'return';
  label: string;
  detail: string;
  /** 時刻；timeKind 說明是車端回報的實際時刻，還是計畫時刻 */
  at: number | null;
  timeKind: 'actual' | 'planned' | 'none';
  status: StepStatus;
};

const RULES_KEY = 'vehicle_rotation.rules';
const TICK_MS = 5_000;
/** 接替車調車開始前多久結束它手上的待命、保養單（營運時間） */
const RELEASE_LEAD_MS = 5 * 60_000;
/** 每一段調車最多下幾次（第一次加重發） */
const MAX_ATTEMPTS = 3;
/** 系統補發的單在幾秒後發車 */
/**
 * 系統補發的單在幾秒後發車（營運時間）。車剛從故障恢復、或手上的單剛結案時要一點時間接單；
 * 車端晚超過 30 秒就不發車，提前量太短會讓重發單一下就被錯過。
 */
const ISSUE_LEAD_MS = 60_000;
/** 接替車可以比原定到位晚多久，再晚就改由被換車照原計畫出場 */
const IN_LATE_OK_MS = 5 * 60_000;
/** 中止時這段時間內要開始的被換車任務由輪替補發，更晚的照計畫由派遣發 */
const REISSUE_WINDOW_MS = 10 * 60_000;
/** 已要求取消、車端多久（實際時間）還沒結案就重送取消通知 */
const CANCEL_RESEND_MS = 30_000;
/** 計畫重建很重：同一個營運日的計畫在這段時間（實際時間）內重用 */
const PLAN_CACHE_MS = 15_000;
/** 一次檢查超過這麼久（實際時間）就記一筆，供效能定位 */
const SLOW_TICK_MS = 1_000;
const DAY_MS = 86_400_000;

const nextDay = (day: string) => operatingDayOf((operatingDayStart(day) ?? 0) + DAY_MS + 3_600_000);

/** 調車訂單的班次代號：同一列同一天唯一（只是顯示用，監看一律用訂單編號對應） */
export const shuntTripCode = (day: string, row: number, side: 'A' | 'B') =>
  `RT${day.slice(5).replace('-', '')}R${row}${side}`;

function toPlanTask(item: PlannedDispatch): PlanTask {
  return {
    order_id: item.orderId,
    trip_code: item.tripCode,
    vehicle_code: item.vehicleCode,
    timeline_row: item.timelineRow,
    depart_at: item.departAt,
    arrive_at: item.arriveAt,
    kind: item.kind,
    origin: item.origin?.name ?? '',
    destination: item.destination?.name ?? '',
    maintenance: item.maintenance ? { maintenance_task_type: item.maintenance.taskType } : null,
  };
}

/** 這個名字在計畫裡的點位（站或設施），調車訂單的起訖點要用完整資料 */
function pointNamed(planned: readonly PlannedDispatch[], name: string): DispatchPoint | null {
  for (const item of planned) {
    if (item.origin?.name === name) return item.origin;
    if (item.destination?.name === name) return item.destination;
  }
  return null;
}

function shuntDispatch(args: {
  planned: readonly PlannedDispatch[];
  tripCode: string;
  vehicleCode: string;
  row: number;
  from: string;
  to: string;
  departAt: number;
  arriveAt: number;
  label: string;
}): PlannedDispatch {
  const { planned, tripCode, vehicleCode, row, from, to, departAt, arriveAt, label } = args;
  const origin = pointNamed(planned, from);
  const destination = pointNamed(planned, to);
  if (!origin || !destination) throw new Error(`班表裡找不到調車點位：${from} → ${to}`);
  const yardEnd = origin.kind === 'facility' ? origin : destination;
  return {
    kind: 'movement',
    maintenance: {
      yardSlotId: yardEnd.kind === 'facility' ? yardEnd.name.toUpperCase() : '',
      typeLabel: '調度',
      typeBg: '#422006',
      typeColor: '#FD9A00',
      taskType: 'dispatch',
      charging: null,
    },
    orderId: buildOrderId(tripCode, departAt),
    tripCode,
    planBlockId: null,
    vehicleCode,
    timelineRow: row,
    taskType: 'dispatch',
    cardLabel: label,
    routeCode: null,
    routeName: label,
    transitionPurpose: destination.kind === 'station' ? 'yard_exit' : 'yard_entry',
    servicePurpose: null,
    transitionFacility: yardEnd.name,
    departAt,
    arriveAt,
    origin: { ...origin, arriveAt: null, departAt },
    destination: { ...destination, arriveAt, departAt: null },
    stations: [],
  };
}

/**
 * 班表是 24 小時循環：下一營運日備用列 00:00 就有任務，被換車那時可能還在做尾段、還沒回到格位。
 * 開頭的場內任務（待命、保養）取消就好，車回到格位本來就是停著；移動或載客不能取消，當天就不換。
 */
function nextDayConflicts(
  nextPlanned: readonly PlannedDispatch[],
  order: ShuntOrder,
  back: PlannedDispatch,
  planned: readonly PlannedDispatch[],
): { cancelled: string[]; blocking: string | null } {
  const spareRow = planned.find((item) => item.vehicleCode === order.incoming)?.timelineRow;
  const early = nextPlanned.filter((item) => item.timelineRow === spareRow && item.departAt < back.arriveAt);
  const blocking = early.find((item) => item.kind !== 'maintenance');
  return {
    cancelled: early.filter((item) => item.kind === 'maintenance').map((item) => item.orderId),
    blocking: blocking?.tripCode ?? null,
  };
}

function retimed(leg: PlannedDispatch, departAt: number): Pick<PlannedDispatch, 'departAt' | 'arriveAt' | 'origin' | 'destination'> {
  const arriveAt = departAt + (leg.arriveAt - leg.departAt);
  return {
    departAt,
    arriveAt,
    origin: leg.origin && { ...leg.origin, departAt },
    destination: leg.destination && { ...leg.destination, arriveAt },
  };
}

/** served＝真的看到接替車開始那一班（不是因為那一列沒有任務而不用等） */
type Takeover = { done: boolean; detail: string; at: number | null; served?: boolean };

/**
 * 一次檢查裡對一筆輪替的改動。先在記憶體裡決定，寫進資料庫之後才送單、取消，
 * 程序在中間停掉，下次檢查照資料庫的內容接著做（訂單編號固定，重送不會多一張）。
 */
class Run {
  readonly legs: ShuntLeg[];
  status: ItemRow['status'];
  recoveryState: ItemRow['recovery_state'];
  fault: string | null;
  cancelledOrderIds: string[];
  readonly history: HistoryEntry[] = [];
  /** 寫庫之後才送出的取消（retire＝故障中的單也記取消，不能再復歸） */
  readonly cancels = new Map<string, { retire: boolean }>();
  release = false;
  finish: Takeover | null = null;
  finishedAt: number | null = null;
  dirty = false;

  constructor(readonly item: ItemRow, private readonly clockNow: () => number) {
    this.legs = normalizeLegs(item.shunts);
    this.status = item.status;
    this.recoveryState = item.recovery_state ?? 'none';
    this.fault = item.fault;
    this.cancelledOrderIds = [...(item.cancelled_order_ids ?? [])];
  }

  role(role: LegRole): ShuntLeg[] {
    return this.legs.filter((leg) => leg.role === role);
  }

  note(kind: string, text: string, fault = true): void {
    this.history.push({ at: this.clockNow(), kind, text });
    if (fault) this.fault = text;
    this.dirty = true;
  }

  cancel(orderId: string, retire = false): void {
    const current = this.cancels.get(orderId);
    this.cancels.set(orderId, { retire: retire || Boolean(current?.retire) });
  }

  patch(): RuntimePatch {
    return {
      shunts: this.legs,
      status: this.status !== this.item.status ? this.status : undefined,
      recoveryState: this.recoveryState !== (this.item.recovery_state ?? 'none') ? this.recoveryState : undefined,
      fault: this.fault !== this.item.fault ? this.fault : undefined,
      cancelledOrderIds: this.cancelledOrderIds,
      history: this.history,
      finishedAt: this.finishedAt ?? undefined,
    };
  }
}

/**
 * 車輛輪替。
 *
 * 規則部署後，每天到「報告產出時間」就列出到達里程的車與接替車。每日確認模式由人確認，
 * 自動執行模式直接確認。確認之後的影響全部經過派遣計畫（見 dispatch/rotation.overlay.ts）：
 * 當天多兩趟調車、取消被換車的最後一段，下一營運日起兩台車對調列。
 *
 * 接替車的調車訂單異常時中止這筆輪替：計畫回到原本的樣子，被換車照常開，不對調。
 * 中止只是「不對調」的決定；補救任務（補發、回格位、收回發錯車的單）另外監看到做完為止。
 */
@Injectable()
export class VehicleRotationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VehicleRotationService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly planCache = new Map<string, { at: number; plan: Awaited<ReturnType<DispatchEngineService['planForRotation']>> }>();
  /** 最近一次檢查花了多久（實際時間，毫秒）：效能定位用 */
  private lastTickMs: { total: number; mileage: number; monitor: number; at: number } | null = null;
  private slowestTickMs = 0;
  /** 事件迴圈延遲：同步 CPU 工作卡住整個後端時看得出來 */
  private loopDelay: IntervalHistogram | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly engine: DispatchEngineService,
    private readonly clock: OperatingClockService,
    private readonly orders: OrderService,
    private readonly store: RotationRuntimeStore,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    this.loopDelay = monitorEventLoopDelay({ resolution: 20 });
    this.loopDelay.enable();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.loopDelay?.disable();
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    const started = Date.now();
    let mileage = 0;
    let monitor = 0;
    try {
      await this.refreshMileage();
      mileage = Date.now() - started;
      await this.autoGenerate();
      await this.expireUnconfirmed();
      const monitorStart = Date.now();
      await this.monitorOpenItems();
      monitor = Date.now() - monitorStart;
    } catch (error) {
      this.logger.error(`車輛輪替檢查失敗：${(error as Error).message}`);
    } finally {
      const total = Date.now() - started;
      this.lastTickMs = { total, mileage, monitor, at: Date.now() };
      this.slowestTickMs = Math.max(this.slowestTickMs, total);
      if (total > SLOW_TICK_MS) this.logger.warn(`車輛輪替檢查花了 ${total} ms（里程 ${mileage} ms、監看 ${monitor} ms）`);
      this.ticking = false;
    }
  }

  /** 效能定位用：最近一次檢查各段花的時間、上次讀取以來最慢的一次，以及事件迴圈延遲（毫秒） */
  timings() {
    const loop = this.loopDelay;
    const ms = (ns: number) => Math.round(ns / 1e5) / 10;
    const result = {
      last_tick: this.lastTickMs,
      slowest_tick_ms: this.slowestTickMs,
      event_loop_delay: loop
        ? { p50: ms(loop.percentile(50)), p99: ms(loop.percentile(99)), max: ms(loop.max), samples: loop.count }
        : null,
    };
    this.slowestTickMs = 0;
    loop?.reset();
    return result;
  }

  private now(): number {
    return this.clock.now();
  }

  private day(): string {
    return this.clock.operatingDay();
  }

  /** 計畫重建很重，畫面與監看在短時間內重用同一份；輪替狀態一改就作廢 */
  private async planFor(day: string, fresh = false) {
    const cached = this.planCache.get(day);
    if (!fresh && cached && Date.now() - cached.at < PLAN_CACHE_MS) return cached.plan;
    const plan = await this.engine.planForRotation(day);
    this.planCache.set(day, { at: Date.now(), plan });
    return plan;
  }

  private invalidatePlans(): void {
    this.planCache.clear();
  }

  async rules(): Promise<{ rules: RotationRules; deployedAt: number | null }> {
    const rows: Array<{ setting_value: { rules?: Partial<RotationRules>; deployedAt?: number } }> =
      await this.dataSource.query('SELECT setting_value FROM system_settings WHERE setting_key = $1', [RULES_KEY]);
    const saved = rows[0]?.setting_value;
    return { rules: { ...DEFAULT_ROTATION_RULES, ...saved?.rules }, deployedAt: saved?.deployedAt ?? null };
  }

  /** 部署規則。今天還沒確認的項目依新規則重排 */
  async deployRules(input: unknown, by: string): Promise<{ rules: RotationRules; deployedAt: number }> {
    const rules = parseRules(input);
    const deployedAt = Date.now();
    await this.dataSource.query(
      `INSERT INTO system_settings (setting_key, setting_value, value_type, description, updated_by, created_at, updated_at)
       VALUES ($1, $2::jsonb, 'json', '車輛輪替規則', $3, $4, $4)
       ON CONFLICT (setting_key) DO UPDATE SET
         setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      [RULES_KEY, JSON.stringify({ rules, deployedAt }), by, deployedAt],
    );
    const day = this.day();
    if (await this.hasReport(day)) await this.generate(day);
    return { rules, deployedAt };
  }

  private async hasReport(day: string): Promise<boolean> {
    const rows = await this.dataSource.query('SELECT 1 FROM vehicle_rotation_reports WHERE operating_day = $1', [day]);
    return rows.length > 0;
  }

  /** 到了報告產出時間就產一次。還沒部署規則就什麼都不做 */
  private async autoGenerate(): Promise<void> {
    const { rules, deployedAt } = await this.rules();
    if (deployedAt == null) return;
    const day = this.day();
    if (await this.hasReport(day)) return;
    const start = operatingDayStart(day);
    if (start == null) return;
    const [hour, minute] = rules.reportBy.split(':').map(Number);
    // 「幾點前產出」：提早 15 分鐘開始，確保在那個時間之前就看得到
    const dueAt = start + (hour * 60 + minute - 15) * 60_000;
    if (this.now() < dueAt) return;
    await this.generate(day);
  }

  /**
   * 累計里程：初始里程＋已完成訂單各段走過的距離。
   *
   * 每張完成的訂單登記在里程帳（訂單編號唯一）才加進 driven_km，同一條 SQL 裡完成：
   * 兩個呼叫端同時在算，第二個登記不進去就不會再加一次；回頭看 10 分鐘，完成時刻
   * 跟上次一樣、但比較晚才寫進來的單也算得到。訂單之後被清理也不會少算。
   */
  private async refreshMileage(): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO vehicle_rotation_vehicles (vehicle_code)
       SELECT vehicle_code FROM vehicles WHERE is_active = true AND service_enabled = true
       ON CONFLICT DO NOTHING`,
    );
    await this.dataSource.query(
      `WITH counted AS (
         INSERT INTO vehicle_rotation_mileage_ledger (order_id, vehicle_code, km, completed_at, counted_at)
         SELECT o.order_id, o.vehicle_code,
                COALESCE((SELECT SUM(v::numeric) FROM jsonb_each_text(o.payload->'leg_distance_max_m') e(k, v)), 0) / 1000,
                o.completed_at, $1
         FROM operation_orders o
         JOIN vehicle_rotation_vehicles c ON c.vehicle_code = o.vehicle_code
         WHERE o.status = 'END' AND o.completed_at IS NOT NULL AND o.completed_at >= c.counted_until - 600000
         ON CONFLICT (order_id) DO NOTHING
         RETURNING vehicle_code, km, completed_at
       )
       UPDATE vehicle_rotation_vehicles r SET
         driven_km = r.driven_km + t.km,
         counted_until = GREATEST(r.counted_until, t.until)
       FROM (SELECT vehicle_code, SUM(km) AS km, MAX(completed_at) AS until FROM counted GROUP BY vehicle_code) t
       WHERE r.vehicle_code = t.vehicle_code`,
      [Date.now()],
    );
  }

  /** 目前的車隊狀態：里程、列、設定都是真實資料 */
  private async fleet(tasks: readonly PlanTask[], refresh = true): Promise<FleetCar[]> {
    // 畫面查詢不寫資料庫：里程由每 5 秒的檢查和產報告時更新
    if (refresh) await this.refreshMileage();
    const rows: Array<Record<string, string | null>> = await this.dataSource.query(
      `SELECT v.vehicle_code, v.initial_mileage_km, r.hold, r.last_rotation_km, r.driven_km,
              (SELECT MAX(i.operating_day) FROM vehicle_rotation_items i
                WHERE i.outgoing = v.vehicle_code AND i.status IN ('confirmed', 'done')) AS rotated_out_day,
              m.telemetry_payload->'energy'->>'battery_level' AS battery,
              (SELECT MAX(o.completed_at) FROM operation_orders o
                WHERE o.vehicle_code = v.vehicle_code AND o.line_kind = 'MAINLINE' AND o.status = 'END') AS last_service_at
       FROM vehicles v
       JOIN vehicle_rotation_vehicles r ON r.vehicle_code = v.vehicle_code
       LEFT JOIN vehicle_monitor_demo m ON m.vehicle_code = v.vehicle_code
       WHERE v.is_active = true AND v.service_enabled = true
       ORDER BY v.vehicle_code`,
    );
    const rowOf = new Map<string, { row: number; passenger: boolean }>();
    for (const task of tasks) {
      if (!task.vehicle_code) continue;
      const entry = rowOf.get(task.vehicle_code) ?? { row: task.timeline_row, passenger: false };
      entry.passenger ||= task.kind === 'passenger';
      rowOf.set(task.vehicle_code, entry);
    }
    return rows.flatMap((row) => {
      const code = row.vehicle_code!;
      const position = rowOf.get(code);
      if (!position) return [];
      const initial = Number(row.initial_mileage_km ?? 0);
      const restSince = position.passenger ? null : row.last_service_at == null ? null : Number(row.last_service_at);
      return [{
        code,
        row: position.row,
        onLine: position.passenger,
        currentKm: Math.round((initial + Number(row.driven_km ?? 0)) * 10) / 10,
        lastRotationKm: row.last_rotation_km == null ? initial : Number(row.last_rotation_km),
        batteryPct: row.battery == null ? null : Number(row.battery),
        restSince,
        hold: (row.hold ?? 'available') as HoldState,
        // 換下算在調車那個營運日：接替車隔天過午夜才接班結案，不能讓被換車隔天也被當成剛換下
        rotatedOutAt: row.rotated_out_day == null ? null : operatingDayStart(row.rotated_out_day),
      }];
    });
  }

  private async items(where: string, params: unknown[]): Promise<ItemRow[]> {
    return this.dataSource.query(`SELECT * FROM vehicle_rotation_items WHERE ${where} ORDER BY created_at`, params);
  }

  /** 產出（或重排）某營運日的報告。確認過的項目不動 */
  async generate(day = this.day()): Promise<void> {
    if (!isOperatingDay(day)) throw new BadRequestException(`營運日格式不對：${day}`);
    const plan = await this.planFor(day, true);
    const start = operatingDayStart(day);
    if (!plan || start == null) throw new ConflictException(`${day} 沒有可用的班表`);
    const { rules } = await this.rules();
    const tasks = plan.planned.map(toPlanTask);
    const cars = await this.fleet(tasks);
    const [hour, minute] = rules.windowStart.split(':').map(Number);
    const at = start + (hour * 60 + minute) * 60_000;

    const existing = await this.items('operating_day = $1', [day]);
    // 還在進行中的別天項目：車還沒換完，不能再排
    const open = await this.items(`status = 'confirmed' AND operating_day <> $1`, [day]);
    const keep = [...existing, ...open].map((row) => ({ order: row.shunt_order, status: row.status }));
    const nextPlan = await this.planFor(nextDay(day), true);
    const report = buildDailyReport({
      tasks,
      cars,
      rules,
      now: at,
      dayStart: start,
      notBefore: 0,
      keep,
    });

    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM vehicle_rotation_items WHERE operating_day = $1 AND status = 'pending'`, [day]);
      const now = Date.now();
      for (const order of report.orders) {
        const shunts = this.shuntsFor(day, order, plan.planned);
        const spareTasks = nextDayConflicts(nextPlan?.planned ?? [], order, shunts[1], plan.planned);
        if (spareTasks.blocking) {
          report.blocked.push({ code: order.outgoing, reason: `${spareTasks.blocking} 在回到格位之前就要開始，今天不換` });
          continue;
        }
        const confirmed = rules.mode === 'auto';
        await manager.query(
          `INSERT INTO vehicle_rotation_items
             (id, operating_day, effective_day, outgoing, incoming, status, shunt_order, shunts,
              cancelled_order_ids, created_at, confirmed_at, confirmed_by, history)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13::jsonb)`,
          [
            randomUUID(), day, nextDay(day), order.outgoing, order.incoming,
            confirmed ? 'confirmed' : 'pending',
            JSON.stringify(order), JSON.stringify(shunts),
            JSON.stringify([...order.window.cancelled.map((task) => task.order_id), ...spareTasks.cancelled]),
            now, confirmed ? now : null, confirmed ? '自動執行' : null,
            JSON.stringify(confirmed ? [{ at: this.now(), kind: 'confirm', text: '自動執行確認' }] : []),
          ],
        );
      }
      await manager.query(
        `INSERT INTO vehicle_rotation_reports (operating_day, blocked, generated_at) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (operating_day) DO UPDATE SET blocked = EXCLUDED.blocked, generated_at = EXCLUDED.generated_at`,
        [day, JSON.stringify(report.blocked), now],
      );
    });
    this.invalidatePlans();
    this.logger.log(`${day} 輪替報告：${report.orders.length} 組，${report.blocked.length} 台排不進去`);
  }

  /** 訂單的兩趟調車，跟畫面上的調車單同一份時間 */
  private shuntsFor(day: string, order: ShuntOrder, planned: readonly PlannedDispatch[]): ShuntLeg[] {
    const row = order.window.row;
    const change = (key: string) => order.changes.find((item) => item.key === key)!;
    const [inFrom, inTo] = change('add-incoming').route.split(' → ');
    const [outFrom, outTo] = change('add-outgoing').route.split(' → ');
    const inAt = change('add-incoming').at;
    const outAt = change('add-outgoing').at;
    const incomingRow = planned.find((item) => item.vehicleCode === order.incoming)?.timelineRow ?? row;
    return [
      {
        ...shuntDispatch({
          planned, tripCode: shuntTripCode(day, row, 'A'), vehicleCode: order.incoming, row: incomingRow,
          from: inFrom, to: inTo, departAt: inAt, arriveAt: inAt + order.window.moveInMs, label: '輪替接替',
        }),
        role: 'in',
        phase: 'planned',
        attempt: 1,
      },
      {
        ...shuntDispatch({
          planned, tripCode: shuntTripCode(day, row, 'B'), vehicleCode: order.outgoing, row,
          from: outFrom, to: outTo, departAt: outAt,
          arriveAt: outAt + (change('add-outgoing').durationMs ?? Math.max(60_000, order.window.moveInMs)), label: '輪替回場',
        }),
        role: 'out',
        phase: 'hold',
        attempt: 1,
      },
    ];
  }

  private async findItem(id: string): Promise<ItemRow> {
    const row = await this.store.item(id);
    if (!row) throw new NotFoundException('找不到這筆輪替');
    return row;
  }

  async confirm(id: string, by: string): Promise<void> {
    const item = await this.findItem(id);
    if (item.status !== 'pending') throw new ConflictException('這筆輪替已經處理過了');
    // 被換車要取消的任務一開始就來不及了：確認會取消它收班的路，調車單卻已經過時發不出去
    const { window } = item.shunt_order;
    const startsAt = Math.min(window.takeoverDepartAt, ...window.cancelled.map((task) => task.depart_at));
    if (this.now() >= startsAt) throw new ConflictException('已經過了換手開始時間，今天不能再確認');
    await this.dataSource.query(
      `UPDATE vehicle_rotation_items SET status = 'confirmed', confirmed_at = $2, confirmed_by = $3,
         history = history || $4::jsonb
       WHERE id = $1 AND status = 'pending'`,
      [id, Date.now(), by, JSON.stringify([{ at: this.now(), kind: 'confirm', text: `${by} 確認` }])],
    );
    this.invalidatePlans();
  }

  /** 過了換手開始時間還沒確認的項目再也不能確認，系統自動略過，不留給人處理 */
  private async expireUnconfirmed(): Promise<void> {
    const rows: ItemRow[] = await this.dataSource.query(`SELECT * FROM vehicle_rotation_items WHERE status = 'pending'`);
    const now = this.now();
    const today = this.day();
    for (const item of rows) {
      const window = item.shunt_order?.window;
      const startsAt = window
        ? Math.min(window.takeoverDepartAt, ...window.cancelled.map((task) => task.depart_at))
        : Number.POSITIVE_INFINITY;
      if (item.operating_day >= today && now < startsAt) continue;
      const text = '換手開始前沒有確認，系統已自動略過';
      await this.dataSource.query(
        `UPDATE vehicle_rotation_items SET status = 'skipped', fault = $2, confirmed_at = $3, confirmed_by = 'system', finished_at = $3,
           history = history || $4::jsonb
         WHERE id = $1 AND status = 'pending'`,
        [item.id, text, Date.now(), JSON.stringify([{ at: now, kind: 'skip', text }])],
      );
      this.logger.log(`輪替 ${item.operating_day} ${item.outgoing}->${item.incoming} 未確認且已過換手時間，自動略過`);
    }
  }

  async skip(id: string, by: string): Promise<void> {
    const item = await this.findItem(id);
    if (item.status !== 'pending') throw new ConflictException('這筆輪替已經處理過了');
    await this.dataSource.query(
      `UPDATE vehicle_rotation_items SET status = 'skipped', confirmed_at = $2, confirmed_by = $3, finished_at = $2,
         history = history || $4::jsonb
       WHERE id = $1 AND status = 'pending'`,
      [id, Date.now(), by, JSON.stringify([{ at: this.now(), kind: 'skip', text: `${by} 略過` }])],
    );
  }

  /** 這筆輪替所有調車段與等待中的舊單的最新狀態 */
  private async loadStates(run: Run): Promise<Map<string, OrderState>> {
    const ids = run.legs.flatMap((leg) => [leg.orderId, ...(leg.waitFor ?? [])]);
    return indexStates(await this.store.ordersFor(ids));
  }

  /**
   * 監看所有未結案的輪替，所有狀況都由系統處理，不留給人：
   * - 接替車調車失敗（故障、卡住、單沒發出來）：來得及就重發，來不及或重發也失敗就中止。
   * - 接替車到位後才發回場調車，避免被換車開進還被佔著的格位。
   * - 回場失敗就重發；重發也失敗，等車端確認停下，被換車停在原地當備用車，輪替照樣生效。
   * - 中止後補發被換車的任務、接替車開回格位、收回發錯車的單，直到補救全部有結果。
   * 重發前一律先要求取消舊單，等車端確認結案才下新單。
   */
  private async monitorOpenItems(): Promise<void> {
    const open = await this.store.openItems();
    for (const item of open) {
      try {
        await this.monitorItem(item);
      } catch (error) {
        this.logger.error(`輪替 ${item.outgoing} → ${item.incoming} 處理失敗：${(error as Error).message}`);
      }
    }
  }

  /** 測試與排程共用：處理一筆輪替一次 */
  async monitorItem(item: ItemRow): Promise<void> {
    const now = this.now();
    const run = new Run(item, () => this.now());
    let states = await this.loadStates(run);
    this.markRan(run, states);

    if (run.status === 'confirmed') await this.advanceConfirmed(run, states, now, await this.planFor(item.operating_day));
    else if (run.status === 'aborted' && run.recoveryState === 'running') await this.advanceRecovery(run, states, now);

    // 1. 先把決定寫進資料庫（歷程寫過就清掉，後面的寫入只附加新的）
    await this.store.save(item.id, run.patch());
    run.history.splice(0);
    if (run.status !== item.status) this.invalidatePlans();
    // 2. 再送取消、結束接替車手上的場內單
    await this.sendCancels(run);
    if (run.release) await this.releaseIncoming(run, now);
    // 3. 舊單都結案的就真的下單
    states = await this.loadStates(run);
    if (await this.drive(run, states, now)) await this.store.save(item.id, { shunts: run.legs, history: run.history.splice(0) });
    // 4. 全部做完才結案
    if (run.finish) await this.finish(run.item, run.finish, run.legs);
  }

  /** 記下車真的開動過的調車段：中止時只有開動過的接替車要開回格位 */
  private markRan(run: Run, states: ReadonlyMap<string, OrderState>): void {
    const now = this.now();
    for (const leg of run.legs) {
      const state = states.get(leg.orderId);
      // 進度有變（段序或剩餘百分比）＝車還在前進
      if (state?.status === 'PROCESSING' && state.progressKey != null && state.progressKey !== leg.progressKey) {
        leg.progressKey = state.progressKey;
        leg.progressAt = now;
        run.dirty = true;
      }
      if (leg.ran) continue;
      const status = states.get(leg.orderId)?.status;
      if (status === 'PROCESSING' || status === 'END' || (status === 'FAULTED' && states.get(leg.orderId)?.startedAt != null)) {
        leg.ran = true;
        run.dirty = true;
      }
    }
  }

  private async advanceConfirmed(
    run: Run,
    states: ReadonlyMap<string, OrderState>,
    now: number,
    dayPlan: Awaited<ReturnType<DispatchEngineService['planForRotation']>>,
  ): Promise<void> {
    const { item } = run;
    const st = (leg: ShuntLeg) => states.get(leg.orderId) ?? null;
    const ins = run.role('in');
    const lastIn = ins.at(-1)!;
    let inDone = ins.some((leg) => st(leg)?.status === 'END');
    const { window } = item.shunt_order;

    if (!inDone && now >= window.takeoverDepartAt) {
      // 接替車已經開始那一列的第一班：它從目前位置自己開到了接續點（車端會先接駁到起點），
      // 等於已經到位。收掉還沒做完的接替調車，接著發回場，不能再判失敗而中止。
      const takeover = await this.takeover(item);
      if (takeover.served) {
        inDone = true;
        if (!item.history?.some((entry) => entry.kind === 'in-by-service')) run.note('in-by-service', `${item.incoming} 已直接開始接班（${takeover.detail}），接替調車視為到位`, false);
      }
    }

    if (!inDone) {
      const deadline = window.takeoverDepartAt + window.moveInMs + IN_LATE_OK_MS;
      if (lastIn.phase === 'queued') {
        // 重發單還在等舊單結案：等到來不及就中止
        if (now + window.moveInMs > deadline) this.abort(run, states, '重發的接替調車等不到舊單取消', now, dayPlan);
        return;
      }
      // 只排除接替調車自己的單：車手上其他在跑的單（例如先做完的待命）才算忙
      const busy = await this.store.busyVehicles([item.incoming], ins.map((leg) => leg.orderId));
      const failure = legFailure(lastIn, st(lastIn), now, busy.has(item.incoming));
      if (!failure) {
        run.release = true;
        return;
      }
      if (ins.length < MAX_ATTEMPTS && now + ISSUE_LEAD_MS + window.moveInMs <= deadline) {
        this.queueRetry(run, states, 'in', now);
        run.note('retry', `${item.incoming} 接替調車${failure}，系統重發第 ${ins.length} 次`);
      } else {
        this.abort(run, states, failure, now, dayPlan);
      }
      return;
    }

    // 接替車到位（原本那張晚到也算）：還在排隊的重發單收掉
    for (const leg of ins) {
      if (isActive(st(leg))) {
        run.cancel(st(leg)!.orderId);
        leg.superseded = true;
      } else if (leg.phase === 'queued' && !st(leg)) {
        // 還沒發出去的重發不用再發
        leg.superseded = true;
      }
    }
    const outs = run.role('out');
    const lastOut = outs.at(-1)!;
    if (lastOut.phase === 'hold') {
      // 接替車到位、原格位空出來才發回場；接替車的重發單要先確認結案
      Object.assign(lastOut, retimed(lastOut, Math.max(now + ISSUE_LEAD_MS, lastOut.departAt)), {
        phase: 'queued',
        queuedAt: now,
        waitFor: ins.map(st).filter(isActive).map((state) => state!.orderId),
      });
      run.note('out', `${item.incoming} 已到位，發出 ${item.outgoing} 回場調車`, false);
    } else if (!outs.some((leg) => st(leg)?.status === 'END') && !lastOut.gaveUp) {
      if (lastOut.strandAt != null) {
        // 已放棄回場：車端確認停下（單都結案）才算原地待命，不能把還在動的車當成已放掉入口
        if (outs.every((leg) => isClosed(st(leg)))) {
          lastOut.gaveUp = true;
          run.note('strand', `${item.outgoing} 回場未完成，車端已確認停車，原地待命；輪替已生效，之後的任務從目前位置出發`);
        }
      } else if (lastOut.phase !== 'queued') {
        const busy = await this.store.busyVehicles([item.outgoing], outs.map((leg) => leg.orderId));
        const failure = legFailure(lastOut, st(lastOut), now, busy.has(item.outgoing));
        if (failure && outs.length < MAX_ATTEMPTS) {
          this.queueRetry(run, states, 'out', now);
          run.note('retry', `${item.outgoing} 回場調車${failure}，系統重發第 ${outs.length} 次`);
        } else if (failure) {
          for (const leg of outs) {
            const state = st(leg);
            if (state && (isActive(state) || (state.status === 'FAULTED' && !state.cancelRequestedAt))) run.cancel(state.orderId, true);
          }
          lastOut.strandAt = now;
          run.note('strand-request', `${item.outgoing} 回場調車重發後仍${failure}，系統停止回場，等車端確認停車`);
        }
      }
    }

    const outSettled = outs.some((leg) => st(leg)?.status === 'END') || outs.some((leg) => leg.gaveUp);
    if (!outSettled) return;
    const takeover = await this.takeover(item);
    if (takeover.done) run.finish = takeover;
  }

  /** 排一張重發：舊單要先取消（故障的單也記取消，不能再復歸），確認結案後才下新單 */
  private queueRetry(run: Run, states: ReadonlyMap<string, OrderState>, role: 'in' | 'out', now: number): void {
    const group = run.role(role);
    const last = group.at(-1)!;
    const waitFor: string[] = [];
    for (const leg of group) {
      const state = states.get(leg.orderId);
      if (state && isActive(state)) {
        run.cancel(state.orderId);
        waitFor.push(state.orderId);
      } else if (state?.status === 'FAULTED' && !state.cancelRequestedAt) {
        run.cancel(state.orderId, true);
      }
      leg.superseded = true;
    }
    const attempt = group.length + 1;
    const tripCode = `${group[0].tripCode}${attempt}`;
    const timing = retimed(last, now + ISSUE_LEAD_MS);
    // 前一次車已經開動過：車停在半路，重發從目前位置直接去目的地（起點設成目的地，
    // 車端從實際位置開過去），不要先開回原起點
    const moved = group.some((leg) => leg.ran) && last.destination
      ? { origin: { ...last.destination, departAt: timing.departAt, arriveAt: null } }
      : {};
    run.legs.push({
      ...last,
      ...timing,
      ...moved,
      role,
      attempt,
      tripCode,
      orderId: buildOrderId(tripCode, timing.departAt),
      phase: 'queued',
      waitFor,
      queuedAt: now,
      issuedAt: undefined,
      issueError: null,
      issueTries: 0,
      ran: false,
      superseded: false,
      strandAt: undefined,
      progressKey: null,
      progressAt: undefined,
    });
    run.dirty = true;
  }

  /**
   * 接替車到不了：中止輪替。被換車還在原地（回場要等接替車到位才發），
   * 它原本收班、出場的任務由系統補發，接替車開動過就開回自己的格位。
   * 補救的每一段都先寫庫（queued），之後每次檢查照資料庫補送、確認完成。
   */
  private abort(
    run: Run,
    states: ReadonlyMap<string, OrderState>,
    failure: string,
    now: number,
    dayPlan: Awaited<ReturnType<DispatchEngineService['planForRotation']>>,
  ): void {
    const { item } = run;
    const ins = run.role('in');
    const activeIn: string[] = [];
    for (const leg of ins) {
      const state = states.get(leg.orderId);
      if (state && isActive(state)) {
        run.cancel(state.orderId);
        activeIn.push(state.orderId);
      } else if (state?.status === 'FAULTED' && !state.cancelRequestedAt) {
        run.cancel(state.orderId, true);
      }
      leg.superseded = true;
    }
    // 被換車原本被取消的任務：計畫裡還找得到的，到時間的由這裡補發（時間整段往後挪），更晚的照計畫由派遣發
    // 換手當天的計畫只有當天的任務；生效日備用列被取消的任務不在裡面，中止後照計畫恢復
    const overdue = (dayPlan?.planned ?? [])
      .filter((task) => run.cancelledOrderIds.includes(task.orderId) && task.departAt <= now + REISSUE_WINDOW_MS)
      .sort((a, b) => a.departAt - b.departAt);
    const shift = overdue.length ? Math.max(0, now + ISSUE_LEAD_MS - overdue[0].departAt) : 0;
    for (const task of overdue) {
      run.legs.push({
        ...task,
        ...retimed(task, task.departAt + shift),
        orderId: `${task.orderId}-RB`,
        role: 'fallback',
        planDepartAt: task.departAt,
        attempt: 1,
        phase: 'queued',
        waitFor: [],
        queuedAt: now,
      });
    }
    // 接替車開動過：從目前位置開回出發的格位。起點設成格位本身，車端從實際位置開過去，
    // 不會先開到原目的地再折回，也不會被放到原目的地
    const first = ins[0];
    if (ins.some((leg) => leg.ran) && first.origin) {
      const departAt = now + ISSUE_LEAD_MS;
      const home = first.origin;
      run.legs.push({
        ...first,
        departAt,
        arriveAt: departAt + (first.arriveAt - first.departAt),
        tripCode: `${first.tripCode}R`,
        orderId: buildOrderId(`${first.tripCode}R`, departAt),
        origin: { ...home, departAt, arriveAt: null },
        destination: { ...home, arriveAt: departAt + (first.arriveAt - first.departAt), departAt: null },
        transitionPurpose: 'yard_entry',
        cardLabel: '輪替中止回格位',
        routeName: '輪替中止回格位',
        role: 'return',
        attempt: 1,
        phase: 'queued',
        waitFor: activeIn,
        queuedAt: now,
        issuedAt: undefined,
        ran: false,
        superseded: false,
      });
    }
    // 派遣不要再發的：只剩這裡補發的那幾張（更晚的照原計畫）
    run.cancelledOrderIds = overdue.map((task) => task.orderId);
    run.status = 'aborted';
    run.recoveryState = 'running';
    run.finishedAt = Date.now();
    run.note('abort', `${item.incoming} 接替調車${failure}，已中止輪替，${item.outgoing} 照原計畫繼續；系統補救中`);
    this.logger.warn(`輪替中止：${item.outgoing} → ${item.incoming}（${failure}），補發 ${overdue.length} 段`);
  }

  /**
   * 中止後的補救：收回發錯車的單、補發的單逐段確認完成。每次檢查都重新比對，
   * 重播或派遣晚一點才發出的錯車單也收得到。全部有結果才結案（done／incomplete）。
   */
  private async advanceRecovery(run: Run, states: ReadonlyMap<string, OrderState>, now: number): Promise<void> {
    const { item } = run;
    const moved = await this.reassignMisassigned(run, now);
    const st = (leg: ShuntLeg) => states.get(leg.orderId) ?? null;
    const recovery = run.legs.filter((leg) => (leg.role === 'fallback' || leg.role === 'return') && !leg.superseded);
    for (const leg of recovery) {
      if (leg.result || leg.phase === 'queued') continue;
      const state = st(leg);
      // 同一台車原計畫在這一段之後的補發任務已經開始：車已從目前位置自己開過去接了後面的班，
      // 這一段（多半是出場移動）已經沒有意義，不再重發，記下原因結案
      if (leg.role === 'fallback' && state?.status !== 'END' && leg.planDepartAt != null) {
        const later = run.legs.find((other) => other !== leg && other.role === 'fallback' && other.vehicleCode === leg.vehicleCode
          && (other.planDepartAt ?? 0) > leg.planDepartAt!
          && (states.get(other.orderId)?.startedAt != null || states.get(other.orderId)?.status === 'END'));
        if (later) {
          if (state && isActive(state)) run.cancel(state.orderId);
          leg.result = 'done';
          leg.failure = `後續的 ${later.tripCode} 已開始，這一段不用補`;
          run.note('recovered', `${leg.vehicleCode} 的 ${leg.tripCode} 不用補：後續的 ${later.tripCode} 已開始`, false);
          continue;
        }
      }
      if (state?.status === 'END') {
        leg.result = 'done';
        run.note('recovered', `${leg.vehicleCode} ${leg.cardLabel ?? leg.tripCode} 補救完成`, false);
        continue;
      }
      // 同一筆補救的前一段（例如先出場）還在跑，也算忙：排在後面的單本來就要等
      const busy = await this.store.busyVehicles([leg.vehicleCode], [leg.orderId]);
      const failure = legFailure(leg, state, now, busy.has(leg.vehicleCode));
      if (!failure) continue;
      const tries = leg.role === 'fallback'
        ? run.legs.filter((entry) => entry.role === 'fallback' && entry.orderId.replace(/-RB\d*$/, '') === leg.orderId.replace(/-RB\d*$/, '')).length
        : run.legs.filter((entry) => entry.role === leg.role && entry.tripCode.replace(/\d+$/, '') === leg.tripCode.replace(/\d+$/, '')).length;
      const missed = failure === '過了發車時間沒有開始' || failure === '沒有發出';
      if ((leg.role === 'return' || (leg.role === 'fallback' && missed)) && tries < MAX_ATTEMPTS) {
        // 回格位失敗就重發，舊單先取消
        if (state && isActive(state)) run.cancel(state.orderId);
        else if (state?.status === 'FAULTED' && !state.cancelRequestedAt) run.cancel(state.orderId, true);
        leg.superseded = true;
        const departAt = Math.max(now + ISSUE_LEAD_MS, this.chainEnd(run, leg.vehicleCode, leg.orderId));
        const tripCode = leg.role === 'return' ? `${leg.tripCode.replace(/\d+$/, '')}${tries + 1}` : leg.tripCode;
        // 補發的被換車任務沿用班次代號，訂單編號加上第幾次（-RB2、-RB3）
        const orderId = leg.role === 'return'
          ? buildOrderId(tripCode, departAt)
          : `${leg.orderId.replace(/-RB\d*$/, '')}-RB${tries + 1}`;
        run.legs.push({
          ...leg,
          ...retimed(leg, departAt),
          tripCode,
          orderId,
          attempt: tries + 1,
          phase: 'queued',
          waitFor: state && isActive(state) ? [state.orderId] : [],
          queuedAt: now,
          issuedAt: undefined,
          ran: false,
          superseded: false,
          result: undefined,
        });
        run.note('retry', `${leg.vehicleCode} ${leg.role === 'return' ? '回格位' : `補發的 ${leg.tripCode} `}${failure}，系統重發第 ${tries} 次`);
        continue;
      }
      if (state && isActive(state)) run.cancel(state.orderId);
      leg.result = 'failed';
      leg.failure = failure;
      run.note(
        'recovery-failed',
        leg.role === 'return'
          ? `${leg.vehicleCode} 回格位重發後仍${failure}，停在原地待命，之後的任務從目前位置出發`
          : `${leg.vehicleCode} 補發的 ${leg.tripCode} ${failure}`,
      );
    }
    const open = run.legs.filter((leg) => (leg.role === 'fallback' || leg.role === 'return') && !leg.superseded && !leg.result);
    if (open.length === 0 && moved === 0) {
      const failed = run.legs.filter((leg) => leg.result === 'failed');
      run.recoveryState = failed.length ? 'incomplete' : 'done';
      run.note(
        'recovery-closed',
        failed.length
          ? `補救結束：${failed.length} 段沒有完成（${failed.map((leg) => `${leg.vehicleCode} ${leg.tripCode}`).join('、')}）`
          : `補救完成：${item.outgoing} 照原計畫、${item.incoming} 回到原本的任務`,
      );
    }
  }

  /**
   * 中止前派遣（或重播）是照對調後的計畫發單的：生效日開頭的任務可能已經發給另一台車。
   * 用計畫編號比對（重播的單看 payload.plan_order_id），發錯車的單收回，
   * 等車端確認結案後以新編號發給計畫上的車。回傳這次新收回幾張。
   */
  private async reassignMisassigned(run: Run, now: number): Promise<number> {
    const { item } = run;
    const pair = [item.outgoing, item.incoming];
    const since = operatingDayStart(item.operating_day) ?? 0;
    const active = await this.store.activeOrders(pair, since);
    if (active.length === 0) return 0;
    const tasks = new Map<string, { task: PlannedDispatch; day: string }>();
    for (const day of [item.operating_day, item.effective_day]) {
      for (const task of (await this.planFor(day))?.planned ?? []) tasks.set(task.orderId, { task, day });
    }
    const own = new Set(run.legs.map((leg) => leg.orderId));
    let moved = 0;
    for (const order of [...active].sort((a, b) => a.plannedStart - b.plannedStart)) {
      if (own.has(order.orderId)) continue;
      const key = order.planOrderId ?? order.orderId;
      const found = tasks.get(key);
      if (!found || found.task.vehicleCode === order.vehicle || !pair.includes(found.task.vehicleCode)) continue;
      run.cancel(order.orderId);
      const rbId = `${key}-RB`;
      moved += 1;
      if (own.has(rbId)) continue;
      const { task, day } = found;
      // 同一台車還有補救中的單（例如先補發的出場）：接在它後面才發車，不然還沒輪到就過了發車時間
      const departAt = Math.max(task.departAt, now + ISSUE_LEAD_MS, this.chainEnd(run, task.vehicleCode));
      // 待命、保養這類場內任務只是晚一點開始，結束時間照計畫，才不會壓到下一段
      const timing = task.kind === 'maintenance' && task.arriveAt - departAt > 60_000
        ? { departAt, arriveAt: task.arriveAt, origin: task.origin && { ...task.origin, departAt }, destination: task.destination }
        : retimed(task, departAt);
      run.legs.push({
        ...task,
        ...timing,
        orderId: rbId,
        role: 'fallback',
        planDepartAt: task.departAt,
        attempt: 1,
        phase: 'queued',
        waitFor: [order.orderId],
        queuedAt: now,
        planDay: day,
      });
      own.add(rbId);
      if (!run.cancelledOrderIds.includes(key)) run.cancelledOrderIds.push(key);
      run.note('reassign', `${order.vehicle} 的 ${task.tripCode} 發錯車，收回改由 ${task.vehicleCode} 執行`, false);
    }
    return moved;
  }

  /** 這台車在這筆補救裡最後一段還沒完成的單預計結束的時刻（營運時間）；沒有就是 0 */
  private chainEnd(run: Run, vehicle: string, exceptOrderId?: string): number {
    return run.legs
      .filter((leg) => (leg.role === 'fallback' || leg.role === 'return') && !leg.superseded && !leg.result
        && leg.vehicleCode === vehicle && leg.orderId !== exceptOrderId)
      .reduce((latest, leg) => Math.max(latest, leg.arriveAt), 0);
  }

  /** 送出取消；已要求過、車端太久沒結案就重送通知 */
  private async sendCancels(run: Run): Promise<void> {
    for (const [orderId, { retire }] of run.cancels) {
      try {
        await this.orders.requestCancel(orderId, { retireFaulted: retire });
      } catch (error) {
        this.logger.warn(`要求取消 ${orderId} 失敗（下次檢查再試）：${(error as Error).message}`);
      }
    }
  }

  /**
   * 真的下單：queued 的段，等待的舊單都由車端確認結案了才發；發車時間已過就往後挪（編號不變）。
   * 舊單還沒結案就去追：已要求取消太久沒回覆就重送通知。下單失敗記下原因，下次檢查再試。
   */
  private async drive(run: Run, states: ReadonlyMap<string, OrderState>, now: number): Promise<boolean> {
    let changed = false;
    for (const leg of run.legs) {
      if (leg.phase !== 'queued' || leg.superseded) continue;
      const blockers = pendingBlockers(leg, states);
      if (blockers.length) {
        for (const blocker of blockers) {
          const waited = blocker.cancelRequestedAt == null ? null : Date.now() - blocker.cancelRequestedAt;
          if (waited == null || waited > CANCEL_RESEND_MS) {
            await this.orders
              .requestCancel(blocker.orderId, { resend: waited != null })
              .catch((error: Error) => this.logger.warn(`追取消 ${blocker.orderId} 失敗：${error.message}`));
          }
        }
        continue;
      }
      if (leg.departAt < now + ISSUE_LEAD_MS) Object.assign(leg, retimed(leg, now + ISSUE_LEAD_MS));
      try {
        await this.engine.issueRotationOrder(leg, leg.planDay ?? run.item.operating_day);
        leg.phase = 'issued';
        leg.issuedAt = now;
        leg.issueError = null;
        run.history.push({ at: now, kind: 'issue', text: `下單 ${leg.orderId}（${leg.vehicleCode}）` });
      } catch (error) {
        leg.issueError = (error as Error).message;
        leg.issueTries = (leg.issueTries ?? 0) + 1;
        if (leg.issueTries === 1) run.history.push({ at: now, kind: 'issue-failed', text: `下單 ${leg.orderId} 失敗：${leg.issueError}` });
        this.logger.warn(`輪替下單 ${leg.orderId} 失敗（下次檢查再試）：${leg.issueError}`);
      }
      changed = true;
    }
    return changed;
  }

  /**
   * 接替車承接了嗎：生效日那一列計畫上的第一個任務，要由接替車本人開始或做完。
   * 別天、別列的單不算。那一列生效日沒有任務就不用等。
   */
  private async takeover(item: ItemRow): Promise<Takeover> {
    const plan = await this.planFor(item.effective_day);
    if (!plan) return { done: false, detail: `${item.effective_day} 還沒有計畫`, at: null };
    const row = item.shunt_order.window.row;
    // 那一列在生效日的第一個任務（不分載客、整備或移動；不算輪替調車本身）：
    // 接替車開始做它，就是接下了這一列。只認第一班載客的話，早上才發車的列整晚都驗不到承接
    const rowTasks = plan.planned
      .filter((task) => task.timelineRow === row && !/^RT\d/.test(task.tripCode))
      .sort((a, b) => a.departAt - b.departAt);
    if (rowTasks.length === 0) return { done: true, detail: `第 ${row} 列 ${item.effective_day} 沒有任務`, at: null };
    // 第一個有效的任務：被中心端取消、從沒開始過的不算（例如接班前被收掉的單）
    const head = rowTasks.slice(0, 8);
    const headStates = await this.store.ordersFor(head.map((task) => task.orderId));
    const voided = (task: PlannedDispatch) => {
      const found = headStates.filter((state) => state.orderId === task.orderId || state.planOrderId === task.orderId);
      return found.length > 0 && found.every((state) => state.closedReason === 'cancelled_by_center' && state.startedAt == null);
    };
    const target = head.find((task) => !voided(task)) ?? rowTasks[0];
    if (target.vehicleCode !== item.incoming) {
      return { done: false, detail: `計畫上 ${target.tripCode} 不是 ${item.incoming}（${target.vehicleCode}）`, at: null };
    }
    const states = headStates.filter((state) => state.orderId === target.orderId || state.planOrderId === target.orderId);
    // 車端回報過開始（之後完成、或被收尾取消都一樣）就算接下了這一列
    const own = states.filter((state) => state.vehicle === item.incoming
      && (state.status === 'PROCESSING' || state.status === 'END' || state.startedAt != null));
    const first = own[0];
    return first
      ? { done: true, served: true, detail: `${item.incoming} 開始 ${target.tripCode}`, at: first.startedAt }
      : { done: false, detail: `${item.incoming} 接第 ${row} 列，等 ${target.tripCode} 開始`, at: target.departAt };
  }

  /**
   * 備用車整天掛著待命或保養單，訂單是一張一張做的，不結束它調車單就開不了。
   * 只結束場內的單，而且只在調車快開始時才做，還沒到時間車照原本的任務。
   */
  private async releaseIncoming(run: Run, now: number): Promise<void> {
    const shunt = run.role('in').at(-1)!;
    if (now < shunt.departAt - RELEASE_LEAD_MS) return;
    const own = run.legs.map((leg) => leg.orderId);
    for (const orderId of await this.store.yardOrdersBefore(run.item.incoming, shunt.departAt, own, run.item.shunt_order.window.row)) {
      await this.orders.requestCancel(orderId).catch((error: Error) => {
        this.logger.warn(`結束接替車訂單 ${orderId} 失敗：${error.message}`);
      });
    }
  }

  private async finish(item: ItemRow, takeover: Takeover, legs: readonly ShuntLeg[]): Promise<void> {
    await this.refreshMileage();
    const finishedAt = Date.now();
    const stranded = legs.some((leg) => leg.role === 'out' && leg.gaveUp);
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE vehicle_rotation_vehicles r SET
           last_rotation_km = (SELECT v.initial_mileage_km FROM vehicles v WHERE v.vehicle_code = r.vehicle_code) + r.driven_km,
           updated_at = $2
         WHERE r.vehicle_code = $1`,
        [item.incoming, finishedAt],
      );
      await manager.query(
        'UPDATE vehicle_rotation_vehicles SET rotated_out_at = $2, updated_at = $3 WHERE vehicle_code = $1',
        [item.outgoing, this.now(), finishedAt],
      );
      // 原地待命的結果要留在畫面上；補救歷程記在 history，不清除
      await manager.query(
        `UPDATE vehicle_rotation_items SET status = 'done', finished_at = $2, fault = $3, history = history || $4::jsonb
         WHERE id = $1 AND status = 'confirmed'`,
        [
          item.id,
          finishedAt,
          stranded ? `輪替已生效；${item.outgoing} 未回格位，原地待命` : null,
          JSON.stringify([{ at: this.now(), kind: 'done', text: `${takeover.detail}，輪替完成` }]),
        ],
      );
    });
    this.invalidatePlans();
    this.logger.log(`輪替完成：${item.outgoing} → ${item.incoming}${stranded ? '（被換車原地待命）' : ''}`);
  }

  private steps(item: ItemRow, states: ReadonlyMap<string, OrderState>, takeover: Takeover | null): MonitorStep[] {
    const { window, incoming, outgoing } = item.shunt_order;
    const legs = normalizeLegs(item.shunts);
    const st = (leg: ShuntLeg | undefined) => (leg ? states.get(leg.orderId) ?? null : null);
    const ins = legs.filter((leg) => leg.role === 'in');
    const outs = legs.filter((leg) => leg.role === 'out');
    // 接替車直接開始接班時也算到位（見 advanceConfirmed）
    const servedIn = (item.history ?? []).some((entry) => entry.kind === 'in-by-service');
    const inEnded = ins.find((leg) => st(leg)?.status === 'END') ?? (servedIn ? ins.at(-1) : undefined);
    const inStarted = ins.find((leg) => st(leg)?.startedAt != null);
    const inLast = ins.at(-1)!;
    const outEnded = outs.find((leg) => st(leg)?.status === 'END');
    const outStarted = outs.find((leg) => st(leg)?.startedAt != null);
    const outLast = outs.at(-1)!;
    const stranded = outs.some((leg) => leg.gaveUp);
    const finished = item.status === 'done';
    const aborted = item.status === 'aborted';
    const inFault = st(inLast)?.status === 'FAULTED';

    const time = (actual: number | null | undefined, planned: number | null): Pick<MonitorStep, 'at' | 'timeKind'> =>
      actual != null ? { at: actual, timeKind: 'actual' } : planned != null ? { at: planned, timeKind: 'planned' } : { at: null, timeKind: 'none' };

    const depart: StepStatus = inStarted || inEnded ? 'done' : aborted || inFault ? 'fault' : item.status === 'confirmed' ? 'running' : 'waiting';
    const arrive: StepStatus = inEnded ? 'done' : aborted || inFault ? 'fault' : inStarted ? 'running' : 'waiting';
    const takeoverStatus: StepStatus = finished ? 'done' : aborted ? 'fault' : inEnded ? 'running' : 'waiting';
    const back: StepStatus = outEnded ? 'done'
      : stranded ? 'warn'
        : aborted ? 'fault'
          : st(outLast)?.status === 'FAULTED' ? 'fault' : outStarted ? 'running' : 'waiting';
    return [
      {
        key: 'depart', label: '接替車前往接續地點', detail: `${incoming} 前往 ${window.meetAt}`,
        ...time(st(inStarted ?? inLast)?.startedAt, inLast.departAt), status: depart,
      },
      {
        key: 'arrive', label: '抵達接續地點', detail: `${incoming} 到達 ${window.meetAt}`,
        ...time(st(inEnded)?.endedAt, inLast.arriveAt), status: arrive,
      },
      {
        key: 'takeover', label: '承接班次',
        detail: takeover?.detail ?? `${incoming} 接第 ${window.row} 列，${item.effective_day} 第一班開始`,
        ...(takeover && takeoverStatus === 'done' ? time(takeover.at, null) : time(null, takeover?.at ?? null)),
        status: takeoverStatus,
      },
      {
        key: 'return',
        label: stranded ? '輪替已生效／未回格位，原地待命' : '換下的車回到格位',
        detail: stranded ? `${outgoing} 停在原地，之後的任務從目前位置出發` : `${outgoing} 回到 ${outLast.destination?.name ?? ''}`,
        ...(outEnded ? time(st(outEnded)?.endedAt, null) : outLast.phase === 'hold' ? time(null, null) : time(st(outStarted)?.startedAt, outLast.departAt)),
        status: back,
      },
    ];
  }

  /** 中止後補救的摘要：每一段、目前狀態、失敗原因 */
  private recoveryView(item: ItemRow, states: ReadonlyMap<string, OrderState>) {
    if ((item.recovery_state ?? 'none') === 'none') return null;
    const legs = normalizeLegs(item.shunts).filter((leg) => (leg.role === 'fallback' || leg.role === 'return') && !leg.superseded);
    return {
      state: item.recovery_state,
      legs: legs.map((leg) => ({
        vehicle: leg.vehicleCode,
        trip_code: leg.tripCode,
        role: leg.role,
        phase: leg.phase,
        order_status: states.get(leg.orderId)?.status ?? null,
        result: leg.result ?? null,
        failure: leg.failure ?? leg.issueError ?? null,
      })),
    };
  }

  /** 今日輪替頁：報告、接替車目前狀態、監看進度 */
  async today(): Promise<Record<string, unknown>> {
    const day = this.day();
    const { rules, deployedAt } = await this.rules();
    const [report] = await this.dataSource.query(
      'SELECT blocked, generated_at FROM vehicle_rotation_reports WHERE operating_day = $1', [day],
    );
    const rows = await this.items(
      `operating_day = $1 OR status = 'confirmed' OR (status = 'aborted' AND recovery_state = 'running')
       OR (effective_day = $1 AND status = 'done')`, [day],
    );
    const plan = await this.planFor(day);
    const tasks = plan?.planned.map(toPlanTask) ?? [];
    const cars = await this.fleet(tasks, false);
    const now = this.now();
    // 所有項目的訂單一次查完，不逐筆查
    const allIds = rows.flatMap((row) => normalizeLegs(row.shunts).flatMap((leg) => [leg.orderId, ...(leg.waitFor ?? [])]));
    const states = indexStates(await this.store.ordersFor(allIds));
    const items: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const car = cars.find((entry) => entry.code === row.incoming);
      const takeover = row.status === 'confirmed' || row.status === 'done' ? await this.takeover(row).catch(() => null) : null;
      items.push({
        id: row.id,
        operating_day: row.operating_day,
        effective_day: row.effective_day,
        status: row.status,
        recovery_state: row.recovery_state ?? 'none',
        fault: row.fault,
        order: row.shunt_order,
        confirmed_by: row.confirmed_by,
        incoming_status: car ? this.carView(car, tasks, now) : null,
        steps: this.steps(row, states, takeover),
        recovery: this.recoveryView(row, states),
        history: (row.history ?? []).slice(-30),
      });
    }
    return {
      operating_day: day,
      now,
      rules,
      deployed_at: deployedAt,
      report_generated_at: report ? Number(report.generated_at) : null,
      blocked: report?.blocked ?? [],
      items,
      slot_options: [...new Set(tasks.filter((task) => task.kind === 'maintenance').map((task) => task.origin))].sort(),
    };
  }

  private carView(car: FleetCar, tasks: readonly PlanTask[], now: number) {
    const position = rowPositionAt(tasks, car.row, now);
    return {
      code: car.code,
      row: car.row,
      on_line: car.onLine,
      current_km: car.currentKm,
      last_rotation_km: car.lastRotationKm,
      battery_pct: car.batteryPct,
      rest_since: car.restSince,
      hold: car.hold,
      // 計畫推算的位置；移動中的車不當成已經在終點
      location: position.location,
      heading_to: position.headingTo,
      state: rowStateAt(tasks, car.row, now),
    };
  }

  /** 車輛清單 */
  async vehicles(): Promise<Record<string, unknown>> {
    const day = this.day();
    const plan = await this.planFor(day);
    const tasks = plan?.planned.map(toPlanTask) ?? [];
    const cars = await this.fleet(tasks, false);
    const { rules } = await this.rules();
    const now = this.now();
    const start = localMidnight(now);
    return {
      items: cars.map((car) => {
        const view = this.carView(car, tasks, now);
        return {
          ...view,
          next_rotation_km: nextRotationKm(car, rules),
          blockers: takeoverBlockers(car, rules, view.location, start),
        };
      }),
    };
  }

  async setHold(code: string, hold: unknown, by: string): Promise<void> {
    if (hold !== 'available' && hold !== 'reserved' && hold !== 'overhaul') {
      throw new BadRequestException('車輛設定只能是可輪替、保留或大保養');
    }
    const result = await this.dataSource.query(
      `UPDATE vehicle_rotation_vehicles SET hold = $2, updated_at = $3, updated_by = $4 WHERE vehicle_code = $1 RETURNING vehicle_code`,
      [code, hold, Date.now(), by],
    );
    if (result[1] === 0) throw new NotFoundException(`找不到車輛 ${code}`);
    const day = this.day();
    if (await this.hasReport(day)) await this.generate(day);
  }

  /** 輪替紀錄：做完、略過、中止的都留下來，補救結果與歷程一起帶出 */
  async records(): Promise<Record<string, unknown>> {
    const rows: ItemRow[] = await this.dataSource.query(
      `SELECT * FROM vehicle_rotation_items WHERE status IN ('done', 'skipped', 'aborted')
       ORDER BY finished_at DESC LIMIT 200`,
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        at: row.finished_at == null ? null : Number(row.finished_at),
        operating_day: row.operating_day,
        outgoing: row.outgoing,
        incoming: row.incoming,
        location: `${row.shunt_order.window.zone} ${row.shunt_order.window.location}`,
        result: row.status,
        recovery_state: row.recovery_state ?? 'none',
        fault: row.fault,
        by: row.confirmed_by,
        history: row.history ?? [],
      })),
    };
  }
}

function parseRules(input: unknown): RotationRules {
  const value = (input ?? {}) as Partial<RotationRules>;
  const isTime = (text: unknown): text is string => typeof text === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
  const intervalKm = Number(value.intervalKm);
  if (!Number.isFinite(intervalKm) || intervalKm < 1) throw new BadRequestException('里程基數至少要 1 公里');
  const slots = Array.isArray(value.takeoverSlots) ? value.takeoverSlots.filter((slot) => typeof slot === 'string') : [];
  if (slots.length === 0) throw new BadRequestException('至少要加入一個可接替格位');
  if (!isTime(value.windowStart) || !isTime(value.windowEnd)) throw new BadRequestException('期望執行時段格式不對');
  if (value.mode !== 'confirm' && value.mode !== 'auto') throw new BadRequestException('執行方式不對');
  if (!isTime(value.reportBy)) throw new BadRequestException('報告產出時間格式不對');
  return { intervalKm, takeoverSlots: slots, windowStart: value.windowStart, windowEnd: value.windowEnd, mode: value.mode, reportBy: value.reportBy };
}
