import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Vehicle } from '../database/entities/vehicle.entity';
import { OperationOrder } from '../database/entities/operation-order.entity';
import { OperationShiftService } from '../operation-shift/operation-shift.service';
import { OrderService } from '../order/order.service';
import { dispatchConfig } from './dispatch.config';
import {
  dispatchDecision,
  fillMissingEndpoints,
  localMidnight,
  planDispatches,
  planYardMoves,
  planYardTasks,
  type PlannedDispatch,
} from './dispatch.plan';
import { extractYardMoves } from './dispatch.yard-moves';
import { extractYardTasks } from './dispatch.yard-tasks';

/**
 * 即時調度引擎。
 *
 * 職責只有一件：<strong>把部署中的班表，按時刻變成一張張營運訂單。</strong>
 * 訂單發出去之後的事（車輛怎麼開、怎麼回報）由〈營運任務狀態協議〉那一條鏈負責，
 * 這裡不介入。
 *
 * <pre>
 *   部署中的班表
 *      │ 展開成今日班次（與對外 timetable API 同一支展開函式）
 *      ▼
 *   今日待下訂單清單  ──每 tick 檢查一次──▶  發車前 leadSeconds 內？
 *                                              │是
 *                                              ▼
 *                                    OrderService.createOrder()
 *                                              │
 *                                              ▼
 *                          MQTT v1/vtms/{車}/operation/assign
 * </pre>
 *
 * <h3>為什麼是輪詢而不是排程器</h3>
 * 用 setTimeout 對每一班精準排程看起來更漂亮，但班表會被重新部署、程序會重啟、
 * 系統時間會被校正——每一種都要把既有的 timer 全部作廢重建。改成每幾秒問一次
 * 「現在該發哪些」，這些情況全部自動正確：狀態只有一份（班表本身），沒有需要
 * 同步的影子狀態。
 *
 * <h3>重複發送的防線有兩層</h3>
 * 記憶體裡的 issued 集合擋掉同一支程序內的重複；資料庫查詢擋掉重啟後的重複。
 * 只靠記憶體的話，重啟會把整個補發窗口內的訂單再發一次——車端會收到重複的
 * assign。所以每個 tick 都會對候選訂單查一次庫。
 */
@Injectable()
export class DispatchEngineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DispatchEngineService.name);

  private timer: NodeJS.Timeout | null = null;

  /** 本次程序已發過的 order_id。跨日時清掉，避免無限成長。 */
  private issued = new Set<string>();

  /** issued 集合對應的日期（當地零點）。換日就重置。 */
  private issuedDay = 0;

  /** 執行期開關。與環境變數的差別是這個可以線上改，不必重啟。 */
  private runtimeEnabled: boolean | null = null;

  private lastTickAt: number | null = null;

  private lastError: string | null = null;

  private readonly recentlyIssued: Array<{
    orderId: string;
    vehicleCode: string;
    tripCode: string;
    departAt: number;
    issuedAt: number;
    lateSeconds: number;
  }> = [];

  constructor(
    private readonly operationShiftService: OperationShiftService,
    private readonly orderService: OrderService,
    @InjectRepository(Vehicle)
    private readonly vehicleRepository: Repository<Vehicle>,
    @InjectRepository(OperationOrder)
    private readonly orderRepository: Repository<OperationOrder>,
  ) {}

  /**
   * 計時器<strong>一律建立</strong>，停用與否由每次 tick 自己判斷。
   *
   * 停用時直接不建計時器看起來更省，但那會讓 <code>POST /dispatch/enable</code>
   * 變成一個沒有作用的按鈕：回應說已啟用、卻永遠不會有人去 tick。要開就得重啟
   * 後端——那正是這支端點想避免的事。
   *
   * 停用時每次 tick 在第一個判斷就返回，成本是每 5 秒一次的函式呼叫。
   */
  onModuleInit(): void {
    const interval = Math.max(1, dispatchConfig.tickSeconds) * 1000;
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
    // 讓 timer 不要擋住程序結束（測試與優雅關閉）
    this.timer.unref?.();
    this.logger.log(
      dispatchConfig.enabled
        ? `即時調度引擎啟動：每 ${dispatchConfig.tickSeconds} 秒檢查一次，` +
            `提前 ${dispatchConfig.leadSeconds} 秒下訂單`
        : '即時調度引擎目前停用（DISPATCH_ENABLED=false）；' +
            'POST /syncdrive-api/dispatch/enable 可以線上開啟，不必重啟',
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 線上開關。停用時保留既有訂單，只是不再發新的。 */
  setEnabled(enabled: boolean): void {
    this.runtimeEnabled = enabled;
    this.logger.log(`即時調度引擎${enabled ? '啟用' : '停用'}（執行期指令）`);
  }

  private get isEnabled(): boolean {
    return this.runtimeEnabled ?? dispatchConfig.enabled;
  }

  /**
   * 目前的車隊，依代號排序。
   *
   * 排序是「第 N 列 → 第 N 台」這個對應的前提，所以不能省：資料庫回傳順序沒有
   * 保證，不排的話重啟後同一列可能換一台車。
   */
  private async loadFleet(): Promise<string[]> {
    const vehicles = await this.vehicleRepository.find({
      where: { isActive: true },
    });
    return vehicles
      .map((vehicle) => vehicle.vehicleCode)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  /** 今日全部待下訂單（不管有沒有下過） */
  async planToday(reference = Date.now()): Promise<{
    shiftId: string;
    shiftName: string;
    planned: PlannedDispatch[];
    skipped: Array<{ tripCode: string; reason: string }>;
  } | null> {
    const deployed = await this.operationShiftService.getDeployedTrips();
    if (!deployed) return null;

    const fleet = await this.loadFleet();
    const taskTypes = dispatchConfig.taskTypes;

    // 空車移動要走 extractYardMoves，不能讓它再從班次展開結果進來一次。
    //
    // 展開結果裡也有 taskType='dispatch' 的卡，但那份<strong>沒有站序</strong>——
    // 空車移動的起訖點是場區設施，不在 stationDwells 裡。兩邊都收的話同一趟會被
    // 排兩次：一份有起訖點、一份兩端都空，後者還會去搶相鄰卡的補齊來源。
    const includeMoves = taskTypes.includes('dispatch');
    const trips = planDispatches({
      trips: deployed.trips,
      fleet,
      taskTypes: taskTypes.filter((type) => type !== 'dispatch'),
      reference,
    });

    const rawMoves = includeMoves
      ? extractYardMoves(deployed.body)
      : { moves: [], skipped: [] };
    const moves = planYardMoves({ moves: rawMoves.moves, fleet, reference });

    // 整備班次同樣要下訂單：整備格位的佔用、車輛卡片的徽章、班次運行紀錄的
    // 整備分頁，全部是從 line_kind='MAINTENANCE' 的訂單長出來的。
    const includeTasks = taskTypes.includes('maintenance');
    const rawTasks = includeTasks
      ? extractYardTasks(deployed.body)
      : { tasks: [], skipped: [] };
    const yardTasks = planYardTasks({
      tasks: rawTasks.tasks,
      fleet,
      reference,
    });

    // 補齊只記了一端的移動卡，要在兩種來源合併之後做——缺的那一端通常在正線班次上
    const merged = fillMissingEndpoints(
      [...trips.planned, ...moves.planned, ...yardTasks.planned].sort(
        (a, b) => a.departAt - b.departAt,
      ),
    );

    const skipped = [
      ...trips.skipped,
      ...moves.skipped,
      ...yardTasks.skipped,
      ...[...rawMoves.skipped, ...rawTasks.skipped].map((item) => ({
        tripCode: item.blockId,
        reason: item.reason,
      })),
    ];

    // 補完還缺一端的不發。半邊的任務對車輛沒有意義，發了只會讓它停在原地等。
    const planned: PlannedDispatch[] = [];
    for (const item of merged) {
      if (item.origin && item.destination) {
        planned.push(item);
        continue;
      }
      skipped.push({
        tripCode: item.tripCode,
        reason: `補不到${item.origin ? '終點' : '起點'}，不發訂單`,
      });
    }

    return {
      shiftId: deployed.shiftId,
      shiftName: deployed.shiftName,
      planned,
      skipped,
    };
  }

  /**
   * 一次檢查。<code>dryRun</code> 時只回報「會發什麼」，不真的發。
   */
  async tick(options?: { dryRun?: boolean; now?: number }): Promise<{
    checked: number;
    issued: PlannedDispatch[];
    expired: PlannedDispatch[];
    skipped: Array<{ tripCode: string; reason: string }>;
  }> {
    const now = options?.now ?? Date.now();
    const dryRun = options?.dryRun ?? false;
    this.lastTickAt = now;

    const empty = { checked: 0, issued: [], expired: [], skipped: [] };
    if (!dryRun && !this.isEnabled) return empty;

    // 換日就把記憶體的已發清單重置——昨天的 order_id 今天不會再出現
    const today = localMidnight(now);
    if (today !== this.issuedDay) {
      this.issued = new Set();
      this.issuedDay = today;
    }

    let plan: Awaited<ReturnType<typeof this.planToday>>;
    try {
      plan = await this.planToday(now);
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error(`即時調度引擎讀班表失敗：${this.lastError}`);
      return empty;
    }
    if (!plan) {
      this.lastError = '目前沒有部署中的班表';
      return empty;
    }

    const due: PlannedDispatch[] = [];
    const expired: PlannedDispatch[] = [];
    for (const item of plan.planned) {
      if (this.issued.has(item.orderId)) continue;
      const decision = dispatchDecision({
        departAt: item.departAt,
        now,
        leadSeconds: dispatchConfig.leadSeconds,
        catchUpSeconds: dispatchConfig.catchUpSeconds,
      });
      if (decision === 'dispatch') due.push(item);
      else if (decision === 'expired') expired.push(item);
    }

    if (due.length === 0) {
      return {
        checked: plan.planned.length,
        issued: [],
        expired,
        skipped: plan.skipped,
      };
    }

    // 第二層防重：重啟後記憶體是空的，庫裡卻可能已經有這些訂單
    const existing = await this.orderRepository.find({
      where: { id: In(due.map((item) => item.orderId)) },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((row) => row.id));

    const issued: PlannedDispatch[] = [];
    for (const item of due) {
      if (existingIds.has(item.orderId)) {
        // 已經在庫裡＝上一次程序發過了。記進記憶體避免每個 tick 都再查一次。
        this.issued.add(item.orderId);
        continue;
      }
      if (dryRun) {
        issued.push(item);
        continue;
      }
      try {
        await this.issueOrder(item, plan.shiftId, plan.shiftName);
        this.issued.add(item.orderId);
        issued.push(item);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = `下訂單 ${item.orderId} 失敗：${message}`;
        this.logger.error(this.lastError);
        // 不記進 issued——下個 tick 還在補發窗口內的話會再試一次
      }
    }

    return {
      checked: plan.planned.length,
      issued,
      expired,
      skipped: plan.skipped,
    };
  }

  /**
   * 真的下一張訂單。
   *
   * <code>payload</code> 是車端唯一能拿到 A/B 點的地方——
   * <code>GET /order/queryById</code> 回的就是這一整包。車輛是自駕，知道起訖點就
   * 自己會規劃路徑，所以我們給的是「去哪、幾點該到」，不是路徑。
   */
  private async issueOrder(
    item: PlannedDispatch,
    shiftId: string,
    shiftName: string,
  ): Promise<void> {
    await this.orderService.createOrder({
      order_id: item.orderId,
      vehicle_code: item.vehicleCode,
      trip_code: item.tripCode,
      // 三種訂單分開標記：正線營運、空車移動、整備。狀態統計與圖台徽章都靠它分流。
      // 只有載客班次進正線班表；其餘一律是整備班次。
      //
      // 空車移動（出廠、入廠、讓站）雖然車真的在開，但那是把車在場區之間挪
      // 位置，還沒開始營運——它屬於整備班次，也停在整備區。
      line_kind: item.kind === 'passenger' ? 'MAINLINE' : 'MAINTENANCE',
      ...(item.maintenance
        ? {
            maint_type_label: item.maintenance.typeLabel,
            maint_type_bg: item.maintenance.typeBg,
            maint_type_color: item.maintenance.typeColor,
            maint_station: item.maintenance.yardSlotId,
          }
        : {}),
      planned_start: item.departAt,
      planned_end: item.arriveAt,
      payload: {
        source: 'dispatch_engine',
        kind: item.kind,
        // 整備分佈的 SQL 讀 payload->>'yard_slot_id' 判斷哪一格被佔著
        ...(item.maintenance
          ? { yard_slot_id: item.maintenance.yardSlotId }
          : {}),
        shift_id: shiftId,
        shift_name: shiftName,
        timeline_row: item.timelineRow,
        task_type: item.taskType,
        card_label: item.cardLabel,
        route_code: item.routeCode,
        route_name: item.routeName,
        planned_depart_at: item.departAt,
        planned_arrive_at: item.arriveAt,
        origin: item.origin && {
          id: item.origin.id,
          name: item.origin.name,
          kind: item.origin.kind,
          depart_at: item.origin.departAt,
        },
        destination: item.destination && {
          id: item.destination.id,
          name: item.destination.name,
          kind: item.destination.kind,
          arrive_at: item.destination.arriveAt,
        },
        stations: item.stations.map((station) => ({
          order: station.order,
          station_id: station.stationId,
          station_name: station.stationName,
          role: station.role,
          arrive_at: station.arriveAt,
          depart_at: station.departAt,
          dwell_seconds: station.dwellSeconds,
        })),
      },
    });

    const lateSeconds = Math.round((Date.now() - item.departAt) / 1000);
    this.recentlyIssued.unshift({
      orderId: item.orderId,
      vehicleCode: item.vehicleCode,
      tripCode: item.tripCode,
      departAt: item.departAt,
      issuedAt: Date.now(),
      lateSeconds,
    });
    this.recentlyIssued.length = Math.min(this.recentlyIssued.length, 50);

    this.logger.log(
      `下訂單 ${item.orderId} → ${item.vehicleCode}` +
        `（${item.origin?.name ?? '?'} → ${item.destination?.name ?? '?'}）`,
    );
  }

  /** 給內部監看用的狀態快照 */
  async status(): Promise<Record<string, unknown>> {
    const now = Date.now();
    const plan = await this.planToday(now).catch(() => null);
    const upcoming = (plan?.planned ?? [])
      .filter((item) => item.departAt >= now && !this.issued.has(item.orderId))
      .slice(0, 10);

    return {
      enabled: this.isEnabled,
      config: {
        tick_seconds: dispatchConfig.tickSeconds,
        lead_seconds: dispatchConfig.leadSeconds,
        catch_up_seconds: dispatchConfig.catchUpSeconds,
        task_types: dispatchConfig.taskTypes,
      },
      deployed_shift: plan ? { id: plan.shiftId, name: plan.shiftName } : null,
      last_tick_at: this.lastTickAt,
      last_error: this.lastError,
      today_trip_count: plan?.planned.length ?? 0,
      issued_today: this.issued.size,
      skipped: plan?.skipped ?? [],
      upcoming: upcoming.map((item) => ({
        order_id: item.orderId,
        vehicle_code: item.vehicleCode,
        trip_code: item.tripCode,
        depart_at: item.departAt,
        depart_in_seconds: Math.round((item.departAt - now) / 1000),
        origin: item.origin?.name ?? null,
        destination: item.destination?.name ?? null,
      })),
      recently_issued: this.recentlyIssued.slice(0, 10),
    };
  }
}
