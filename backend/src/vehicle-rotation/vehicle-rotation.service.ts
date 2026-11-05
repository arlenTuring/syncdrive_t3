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
  rowLocationAt,
  rowStateAt,
  takeoverBlockers,
  type FleetCar,
  type HoldState,
  type PlanTask,
  type RotationRules,
  type ShuntOrder,
} from './rotation.model';

type ItemStatus = 'pending' | 'confirmed' | 'skipped' | 'done' | 'aborted';

type ItemRow = {
  id: string;
  operating_day: string;
  effective_day: string;
  outgoing: string;
  incoming: string;
  status: ItemStatus;
  shunt_order: ShuntOrder;
  shunts: PlannedDispatch[];
  cancelled_order_ids: string[];
  fault: string | null;
  created_at: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
  finished_at: string | null;
};

type StepStatus = 'waiting' | 'running' | 'done' | 'fault';

export type MonitorStep = {
  key: 'depart' | 'arrive' | 'takeover' | 'return';
  label: string;
  detail: string;
  at: number | null;
  status: StepStatus;
};

type OrderState = { status: string; plannedEnd: number | null };

const RULES_KEY = 'vehicle_rotation.rules';
const TICK_MS = 5_000;
/** 接替車調車開始前多久結束它手上的待命、保養單（營運時間） */
const RELEASE_LEAD_MS = 5 * 60_000;
/** 調車計畫結束後超過這麼久還沒完成，就標示異常讓人處理 */
const OVERDUE_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

const nextDay = (day: string) => operatingDayOf((operatingDayStart(day) ?? 0) + DAY_MS + 3_600_000);

/** 調車訂單的班次代號：同一列同一天唯一，監看用它找訂單（模擬器下的單編號不同，代號相同） */
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

/**
 * 車輛輪替。
 *
 * 規則部署後，每天到「報告產出時間」就列出到達里程的車與接替車。每日確認模式由人確認，
 * 自動執行模式直接確認。確認之後的影響全部經過派遣計畫（見 dispatch/rotation.overlay.ts）：
 * 當天多兩趟調車、取消被換車的最後一段，下一營運日起兩台車對調列。
 *
 * 接替車的調車訂單異常時中止這筆輪替：計畫回到原本的樣子，被換車照常開，不對調。
 */
@Injectable()
export class VehicleRotationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VehicleRotationService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly engine: DispatchEngineService,
    private readonly clock: OperatingClockService,
    private readonly orders: OrderService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.refreshMileage();
      await this.autoGenerate();
      await this.monitorOpenItems();
    } catch (error) {
      this.logger.error(`車輛輪替檢查失敗：${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private now(): number {
    return this.clock.now();
  }

  private day(): string {
    return this.clock.operatingDay();
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

  /** 累計里程：初始里程＋已完成訂單各段走過的距離。只算新完成的訂單，訂單被清理也不會少算 */
  private async refreshMileage(): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO vehicle_rotation_vehicles (vehicle_code)
       SELECT vehicle_code FROM vehicles WHERE is_active = true AND service_enabled = true
       ON CONFLICT DO NOTHING`,
    );
    await this.dataSource.query(
      `UPDATE vehicle_rotation_vehicles r SET
         driven_km = r.driven_km + t.km,
         counted_until = t.until
       FROM (
         SELECT o.vehicle_code,
                SUM(COALESCE((SELECT SUM(v::numeric) FROM jsonb_each_text(o.payload->'leg_distance_max_m') e(k, v)), 0)) / 1000 AS km,
                MAX(o.completed_at) AS until
         FROM operation_orders o
         JOIN vehicle_rotation_vehicles c ON c.vehicle_code = o.vehicle_code
         WHERE o.status = 'END' AND o.completed_at > c.counted_until
         GROUP BY o.vehicle_code
       ) t
       WHERE r.vehicle_code = t.vehicle_code`,
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
    const plan = await this.engine.planForRotation(day);
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
    const nextPlan = await this.engine.planForRotation(nextDay(day));
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
              cancelled_order_ids, created_at, confirmed_at, confirmed_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)`,
          [
            randomUUID(), day, nextDay(day), order.outgoing, order.incoming,
            confirmed ? 'confirmed' : 'pending',
            JSON.stringify(order), JSON.stringify(shunts),
            JSON.stringify([...order.window.cancelled.map((task) => task.order_id), ...spareTasks.cancelled]),
            now, confirmed ? now : null, confirmed ? '自動執行' : null,
          ],
        );
      }
      await manager.query(
        `INSERT INTO vehicle_rotation_reports (operating_day, blocked, generated_at) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (operating_day) DO UPDATE SET blocked = EXCLUDED.blocked, generated_at = EXCLUDED.generated_at`,
        [day, JSON.stringify(report.blocked), now],
      );
    });
    this.logger.log(`${day} 輪替報告：${report.orders.length} 組，${report.blocked.length} 台排不進去`);
  }

  /** 訂單的兩趟調車，跟畫面上的調車單同一份時間 */
  private shuntsFor(day: string, order: ShuntOrder, planned: readonly PlannedDispatch[]): PlannedDispatch[] {
    const row = order.window.row;
    const change = (key: string) => order.changes.find((item) => item.key === key)!;
    const [inFrom, inTo] = change('add-incoming').route.split(' → ');
    const [outFrom, outTo] = change('add-outgoing').route.split(' → ');
    const inAt = change('add-incoming').at;
    const outAt = change('add-outgoing').at;
    const incomingRow = planned.find((item) => item.vehicleCode === order.incoming)?.timelineRow ?? row;
    return [
      shuntDispatch({
        planned, tripCode: shuntTripCode(day, row, 'A'), vehicleCode: order.incoming, row: incomingRow,
        from: inFrom, to: inTo, departAt: inAt, arriveAt: inAt + order.window.moveInMs, label: '輪替接替',
      }),
      shuntDispatch({
        planned, tripCode: shuntTripCode(day, row, 'B'), vehicleCode: order.outgoing, row,
        from: outFrom, to: outTo, departAt: outAt, arriveAt: outAt + Math.max(60_000, order.window.moveInMs), label: '輪替回場',
      }),
    ];
  }

  private async findItem(id: string): Promise<ItemRow> {
    const [row] = await this.items('id = $1', [id]);
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
      `UPDATE vehicle_rotation_items SET status = 'confirmed', confirmed_at = $2, confirmed_by = $3 WHERE id = $1`,
      [id, Date.now(), by],
    );
  }

  async skip(id: string, by: string): Promise<void> {
    const item = await this.findItem(id);
    if (item.status !== 'pending') throw new ConflictException('這筆輪替已經處理過了');
    await this.dataSource.query(
      `UPDATE vehicle_rotation_items SET status = 'skipped', confirmed_at = $2, confirmed_by = $3, finished_at = $2 WHERE id = $1`,
      [id, Date.now(), by],
    );
  }

  private async orderStates(item: ItemRow): Promise<{ incoming: OrderState | null; outgoing: OrderState | null; tookOver: boolean }> {
    const codes = item.shunts.map((shunt) => shunt.tripCode);
    const rows: Array<{ trip_code: string; status: string; planned_end: string | null }> = await this.dataSource.query(
      `SELECT trip_code, status, planned_end FROM operation_orders
       WHERE trip_code = ANY($1) AND created_at >= $2
       ORDER BY created_at ASC`,
      [codes, item.created_at],
    );
    const pick = (code: string): OrderState | null => {
      const row = rows.filter((entry) => entry.trip_code === code).at(-1);
      return row ? { status: row.status, plannedEnd: row.planned_end == null ? null : Number(row.planned_end) } : null;
    };
    const boundary = operatingDayStart(item.effective_day) ?? 0;
    const [{ count }]: Array<{ count: string }> = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM operation_orders
       WHERE vehicle_code = $1 AND line_kind = 'MAINLINE' AND status IN ('PROCESSING', 'END') AND planned_start >= $2`,
      [item.incoming, boundary],
    );
    return { incoming: pick(codes[0]), outgoing: pick(codes[1]), tookOver: Number(count) > 0 };
  }

  private steps(item: ItemRow, states: Awaited<ReturnType<VehicleRotationService['orderStates']>>): MonitorStep[] {
    const { window, incoming, outgoing } = item.shunt_order;
    const [inShunt, outShunt] = item.shunts;
    const inStatus = states.incoming?.status;
    const outStatus = states.outgoing?.status;
    const finished = item.status === 'done';
    const depart: StepStatus = finished || inStatus === 'PROCESSING' || inStatus === 'END' ? 'done'
      : inStatus === 'FAULTED' ? 'fault' : item.status === 'confirmed' ? 'running' : 'waiting';
    const arrive: StepStatus = finished || inStatus === 'END' ? 'done'
      : inStatus === 'FAULTED' ? 'fault' : inStatus === 'PROCESSING' ? 'running' : 'waiting';
    const takeover: StepStatus = finished || states.tookOver ? 'done' : arrive === 'done' ? 'running' : 'waiting';
    const back: StepStatus = finished || outStatus === 'END' ? 'done'
      : outStatus === 'FAULTED' ? 'fault' : outStatus === 'PROCESSING' ? 'running' : 'waiting';
    return [
      { key: 'depart', label: '接替車前往接續地點', detail: `${incoming} 前往 ${window.meetAt}`, at: inShunt.departAt, status: depart },
      { key: 'arrive', label: '抵達接續地點', detail: `${incoming} 到達 ${window.meetAt}`, at: inShunt.arriveAt, status: arrive },
      { key: 'takeover', label: '承接班次', detail: `${incoming} 接第 ${window.row} 列，${item.effective_day} 第一班開始`, at: null, status: takeover },
      { key: 'return', label: '換下的車回到格位', detail: `${outgoing} 回到 ${outShunt.destination?.name ?? ''}`, at: outShunt.departAt, status: back },
    ];
  }

  /** 監看進行中的輪替：接替車調車失敗就中止，全部完成就記下里程 */
  private async monitorOpenItems(): Promise<void> {
    const open = await this.items(`status = 'confirmed'`, []);
    for (const item of open) {
      const states = await this.orderStates(item);
      const now = this.now();
      if (states.incoming?.status === 'FAULTED') {
        await this.dataSource.query(
          `UPDATE vehicle_rotation_items SET status = 'aborted', fault = $2, finished_at = $3 WHERE id = $1`,
          [item.id, `${item.incoming} 調車異常，已中止輪替，${item.outgoing} 照原計畫繼續`, Date.now()],
        );
        this.logger.warn(`輪替中止：${item.outgoing} → ${item.incoming}`);
        continue;
      }
      await this.releaseIncoming(item, now);
      // 調車單根本沒發出來也要算逾時，用計畫的到達時間判斷，不然這筆會一直掛著沒人知道
      const late = (state: OrderState | null, plannedArrive: number) =>
        state?.status !== 'END' && now > (state?.plannedEnd ?? plannedArrive) + OVERDUE_MS;
      const fault = states.outgoing?.status === 'FAULTED'
        ? `${item.outgoing} 回場調車異常，需人工處理`
        : late(states.incoming, item.shunts[0].arriveAt) || late(states.outgoing, item.shunts[1].arriveAt)
          ? '調車逾時未完成，需人工處理' : null;
      if (fault !== item.fault) {
        await this.dataSource.query('UPDATE vehicle_rotation_items SET fault = $2 WHERE id = $1', [item.id, fault]);
      }
      const steps = this.steps(item, states);
      if (steps.every((step) => step.status === 'done')) await this.finish(item);
    }
  }

  /**
   * 備用車整天掛著待命或保養單，訂單是一張一張做的，不結束它調車單就開不了。
   * 只結束場內的單，而且只在調車快開始時才做，還沒到時間車照原本的任務。
   */
  private async releaseIncoming(item: ItemRow, now: number): Promise<void> {
    const shunt = item.shunts[0];
    if (now < shunt.departAt - RELEASE_LEAD_MS) return;
    const active: Array<{ order_id: string }> = await this.dataSource.query(
      `SELECT order_id FROM operation_orders
       WHERE vehicle_code = $1 AND status IN ('PENDING', 'PROCESSING') AND line_kind <> 'MAINLINE'
         AND trip_code <> $2 AND planned_start <= $3 AND payload->>'cancel_requested_at' IS NULL`,
      [item.incoming, shunt.tripCode, shunt.departAt],
    );
    for (const order of active) {
      await this.orders.requestCancel(order.order_id).catch((error: Error) => {
        this.logger.warn(`結束接替車訂單 ${order.order_id} 失敗：${error.message}`);
      });
    }
  }

  private async finish(item: ItemRow): Promise<void> {
    await this.refreshMileage();
    const finishedAt = Date.now();
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
      await manager.query(
        `UPDATE vehicle_rotation_items SET status = 'done', fault = NULL, finished_at = $2 WHERE id = $1`,
        [item.id, finishedAt],
      );
    });
    this.logger.log(`輪替完成：${item.outgoing} → ${item.incoming}`);
  }

  /** 今日輪替頁：報告、接替車目前狀態、監看進度 */
  async today(): Promise<Record<string, unknown>> {
    const day = this.day();
    const { rules, deployedAt } = await this.rules();
    const [report] = await this.dataSource.query(
      'SELECT blocked, generated_at FROM vehicle_rotation_reports WHERE operating_day = $1', [day],
    );
    const rows = await this.items(
      `operating_day = $1 OR status = 'confirmed' OR (effective_day = $1 AND status = 'done')`, [day],
    );
    const plan = await this.engine.planForRotation(day);
    const tasks = plan?.planned.map(toPlanTask) ?? [];
    const cars = await this.fleet(tasks, false);
    const now = this.now();
    const items: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const car = cars.find((entry) => entry.code === row.incoming);
      items.push({
        id: row.id,
        operating_day: row.operating_day,
        effective_day: row.effective_day,
        status: row.status,
        fault: row.fault,
        order: row.shunt_order,
        confirmed_by: row.confirmed_by,
        incoming_status: car ? this.carView(car, tasks, now) : null,
        steps: this.steps(row, await this.orderStates(row)),
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
    return {
      code: car.code,
      row: car.row,
      on_line: car.onLine,
      current_km: car.currentKm,
      last_rotation_km: car.lastRotationKm,
      battery_pct: car.batteryPct,
      rest_since: car.restSince,
      hold: car.hold,
      location: rowLocationAt(tasks, car.row, now),
      state: rowStateAt(tasks, car.row, now),
    };
  }

  /** 車輛清單 */
  async vehicles(): Promise<Record<string, unknown>> {
    const day = this.day();
    const plan = await this.engine.planForRotation(day);
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

  /** 輪替紀錄：做完、略過、中止的都留下來 */
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
        fault: row.fault,
        by: row.confirmed_by,
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

