import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  OperationOrder,
  OrderStatus,
} from '../database/entities/operation-order.entity';
import {
  OrderActionState,
} from '../database/entities/order-action-state.entity';
import { RouteActionStatus } from '../database/entities/operation-route-station-action.entity';
import { OrderEvent } from '../database/entities/order-event.entity';
import { OrderMqttPublisher } from './order-mqtt.publisher';
import { OrderRouteService } from './order-route.service';
import { deriveOperationActionFromTaskGroup } from './task-group.util';
import { orderBusinessKindSql } from './order-business-kind';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';
import { OperatingClockService } from '../operating-day/operating-clock.service';
import { MapService } from '../map/map.service';
import {
  ExecutionStatusKey,
  PENDING_VEHICLE_FAULT_SQL,
  ShiftRecordListItem,
  ShiftTab,
  toShiftRecordListItem,
} from './order-list.util';

export type ListOrdersQuery = {
  tab?: ShiftTab;
  keyword?: string;
  execution_status?: ExecutionStatusKey | 'all';
  vehicle_code?: string;
  planned_start_from?: string;
  planned_start_to?: string;
  page?: number;
  page_size?: number;
};

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.PROCESSING, OrderStatus.FAULTED],
  [OrderStatus.PROCESSING]: [OrderStatus.END, OrderStatus.FAULTED],
  [OrderStatus.END]: [],
  [OrderStatus.FAULTED]: [OrderStatus.PROCESSING, OrderStatus.END],
};

const CONFIRMED_DWELL_PHASES = new Set(['DWELLING', 'DOCKED', 'AT_STATION']);

function confirmedDwellPatch(vehiclePhase: string, stationId: string | null, reportedAt: number | null | undefined) {
  return stationId && CONFIRMED_DWELL_PHASES.has(vehiclePhase)
    ? { last_confirmed_dwell: { station_id: stationId, reported_at: reportedAt ?? Date.now() } }
    : {};
}

export type OperationCurrentLeg = {
  target_station_id?: string;
  distance_to_target_m?: number;
  eta_seconds?: number;
  /**
   * @deprecated 車端已不需要回報：中心端會用訂單自己的站序計畫時刻推算
   * （見 computeLegEtaMaxFromSchedule）。僅在推算失敗時當相容性 fallback。
   */
  leg_eta_max?: number;
};

/** 模擬／場上回報：正線訂單生命週期快照（不限制同時 PROCESSING 台數） */
export type MainlineOrderLifecycleSnapshot = {
  vehicleCode: string;
  orderId: string;
  tripCode: string;
  routeId: string;
  phase: 'pending' | 'processing';
};

/** 模擬／場上回報：整備任務訂單快照 */
export type MaintenanceOrderLifecycleSnapshot = {
  vehicleCode: string;
  orderId: string;
  tripCode: string;
  phase: 'pending' | 'processing';
  maintTypeLabel: string;
  maintTypeBg: string;
  maintTypeColor: string;
  iconBgColor: string;
  progressMarkerIcon: string;
  yardSlotId?: string | null;
  maintStation?: string | null;
  segmentIndex: number;
  routeProgress: number;
};

/**
 * 一則 operation/update 套用到訂單的結果（給 MQTT 端記診斷用）。
 * 只有 progress_applied、pending_refreshed、faulted 會寫庫。
 */
/** 後端內建示範（demo-simulation）自己建的單；示範的對帳只能動這種單 */
export const BACKEND_DEMO_SOURCE = 'backend_demo';

export type OperationMqttOutcome =
  | 'missing_order_id'
  | 'unknown_order'
  | 'vehicle_mismatch'
  | 'stale'
  | 'duplicate'
  | 'pending_refreshed'
  | 'not_processing'
  | 'cancel_requested'
  | 'vehicle_fault_reported'
  | 'progress_applied';

export type OperationMqttPayload = {
  order_id?: string;
  trip_code?: string;
  vehicle_code?: string;
  vehicle_phase?: string;
  order_status?: string;
  operation_action?: string;
  /**
   * @deprecated 車端已不需要回報：中心端派單時就把 line_kind 寫進訂單記錄
   * 了（見 dispatch-engine.service.ts），這裡一律信任既有訂單。僅在訂單本身
   * 缺記錄時當相容性 fallback，供舊車端／模擬器過渡使用。
   */
  line_kind?: string;
  /** @deprecated 同 line_kind，中心端指派時已經知道，車端不需要回報。 */
  route_id?: string;
  current_leg?: OperationCurrentLeg | string;
  task_group?: Array<Record<string, unknown>>;
  event?: {
    event_id?: string;
    event_type?: string;
    request_status?: string;
    completion_status?: string;
    payload?: Record<string, unknown>;
  };
  maint_type_label?: string;
  /**
   * 車端一般不需要主動回報：中心端會用車輛最近一次 telemetry/update 的
   * local_pose.position 比對場區格位範圍自動判定（見
   * MqttService.enrichWithFacilityLocation）。仍保留此欄位供舊車端／
   * 模擬器相容——若車端已帶值，中心端不會覆蓋。
   */
  yard_slot_id?: string;
  timestamp?: number;
};

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(OperationOrder)
    private readonly orderRepository: Repository<OperationOrder>,
    @InjectRepository(OrderActionState)
    private readonly actionStateRepository: Repository<OrderActionState>,
    @InjectRepository(OrderEvent)
    private readonly orderEventRepository: Repository<OrderEvent>,
    private readonly orderMqttPublisher: OrderMqttPublisher,
    private readonly orderRouteService: OrderRouteService,
    private readonly datasourceInvalidation: DatasourceInvalidationService,
    private readonly mapService: MapService,
    @Optional() private readonly operatingClock?: OperatingClockService,
  ) {}

  /** 實際時刻 → 營運時刻（沒有時鐘服務時，例如單元測試，就是實際時間） */
  private toOperating(realTs: number): number {
    return this.operatingClock ? this.operatingClock.toOperating(realTs) : realTs;
  }

  /**
   * 同一張單的「讀出 → 改 payload → 存回」依序執行。
   *
   * 車端 1 Hz 的 MQTT 進度、REST 狀態回報、中心端取消可能同時改同一張單；TypeORM 的 save
   * 會把整個 payload 寫回，沒排隊的話後存的會蓋掉先存的欄位（實測：MQTT 進度蓋掉了剛寫的
   * vehicle_progress_at.END；同樣的情況也可能蓋掉 cancel_requested_at）。這裡在本程序內依
   * 訂單 ID 排隊，進入後一律重新讀取。主系統目前是單一後端程序；若之後多實例部署，要改成
   * 資料庫層的原子更新或列鎖。
   */
  private readonly orderLocks = new Map<string, Promise<void>>();

  private async withOrderLock<T>(orderId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.orderLocks.get(orderId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const chained = previous.then(() => current);
    this.orderLocks.set(orderId, chained);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.orderLocks.get(orderId) === chained) this.orderLocks.delete(orderId);
    }
  }

  async createOrder(
    data: {
      order_id: string;
      vehicle_code: string;
      trip_code: string;
      route_id?: string;
      priority_level?: number;
      line_kind?: string;
      payload?: Record<string, unknown>;
      /** 計畫發車時刻（Epoch 毫秒）。班表下來的訂單會帶，手動建立的可略。 */
      planned_start?: number;
      /** 計畫結束時刻（Epoch 毫秒） */
      planned_end?: number;
      /** 整備訂單的徽章與格位。車輛卡片與整備分佈都讀這幾欄。 */
      maint_type_label?: string;
      maint_type_bg?: string;
      maint_type_color?: string;
      maint_station?: string;
    },
    options?: { skipAssign?: boolean; initialStatus?: OrderStatus },
  ): Promise<OperationOrder> {
    if (!data.order_id || !data.vehicle_code || !data.trip_code) {
      throw new BadRequestException('order_id, vehicle_code, trip_code are required.');
    }

    // 路線與業務分類只用呼叫端明確給的值；班次代號只是名稱，不拿來推路線或分類
    const routeId = data.route_id ?? undefined;
    const lineKind = data.line_kind ?? undefined;

    const order = this.orderRepository.create({
      id: data.order_id,
      tripCode: data.trip_code,
      vehicleCode: data.vehicle_code,
      routeId,
      priorityLevel: data.priority_level ?? 50,
      lineKind,
      payload: data.payload ?? {},
      plannedStart: data.planned_start == null ? undefined : String(data.planned_start),
      plannedEnd: data.planned_end == null ? undefined : String(data.planned_end),
      maintTypeLabel: data.maint_type_label,
      maintTypeBg: data.maint_type_bg,
      maintTypeColor: data.maint_type_color,
      maintStation: data.maint_station,
      status: options?.initialStatus ?? OrderStatus.PENDING,
      createdAt: String(Date.now()),
    });
    /*
     * 不得覆寫既有訂單的兩種單：人工測試單（line_kind=TEST）與模擬器重播單
     * （payload.source=plan_replay）。模擬器的分類已改成實際業務類型，所以不能再靠
     * line_kind 判斷——改看來源。
     *
     * 重播單的編號＝執行 ID＋任務代號，建單逾時重試時同一張會再送一次：內容相同（同車、
     * 同任務、同一輪）就回傳原訂單，不再發 assign，車端不會收到兩次；內容不同才是撞號，報錯。
     */
    const createOnly = data.line_kind === 'TEST' || data.payload?.source === 'plan_replay';
    let saved: OperationOrder;
    if (createOnly) {
      try { await this.orderRepository.insert(order); }
      catch (error) {
        if ((error as { code?: string }).code !== '23505') throw error;
        if (data.payload?.source !== 'plan_replay') {
          throw new ConflictException('測試訂單編號已存在，請先查詢原訂單');
        }
        const existing = await this.orderRepository.findOne({ where: { id: data.order_id } });
        const existingPayload = (existing?.payload ?? {}) as Record<string, unknown>;
        if (
          existing
          && existing.vehicleCode === data.vehicle_code
          && existing.tripCode === data.trip_code
          && existingPayload.plan_run_id === data.payload?.plan_run_id
        ) {
          return Object.assign(existing, { duplicate: true }) as OperationOrder;
        }
        throw new ConflictException(`重播訂單編號 ${data.order_id} 已存在且內容不同（不是同一輪的同一個任務）`);
      }
      saved = order;
    } else {
      // 同編號的單已經存在時，save 會整筆覆寫（連狀態都改回 PENDING）。只允許覆寫還沒開始、
      // 也沒被取消的待發單；已開始、已結案或已取消的一律拒絕——不然重送一次建單就能把
      // 執行中或已結束的單「復活」。跟狀態回報、取消走同一個排隊，進入後重新讀取。
      saved = await this.withOrderLock(data.order_id, async () => {
        const existing = await this.orderRepository.findOne({ where: { id: data.order_id } });
        if (existing) {
          const existingPayload = (existing.payload ?? {}) as Record<string, unknown>;
          if (existing.status !== OrderStatus.PENDING || existingPayload.cancel_requested_at) {
            throw new ConflictException({
              statusCode: 409,
              code: 'ORDER_NOT_OVERWRITABLE',
              message: `訂單 ${data.order_id} 已是 ${existing.status}${existingPayload.cancel_requested_at ? '（中心端已取消）' : ''}，不能用建單覆寫`,
            });
          }
        }
        return this.orderRepository.save(order);
      });
    }

    if (routeId) {
      await this.orderRouteService.materializeActionStates(saved.id, routeId);
    }

    if (!options?.skipAssign) {
      const mqttAssign = this.orderMqttPublisher.publishAssign(
        saved.vehicleCode,
        saved.id,
        saved.priorityLevel,
      );
      (saved as OperationOrder & { mqtt_assign?: typeof mqttAssign }).mqtt_assign = mqttAssign;
    }

    this.datasourceInvalidation.emitOrderLifecycle(saved.vehicleCode);
    return saved;
  }

  async getOrderById(id: string): Promise<OperationOrder> {
    if (!this.nonEmpty(id)) {
      // id 缺漏時 TypeORM 的 where:{id:undefined} 會被忽略，等於查全表第一筆——
      // 對外查詢絕不能讓缺參數變成「隨機回一筆」，必須先擋掉。
      throw new BadRequestException({ statusCode: 400, code: 'ORDER_ID_REQUIRED', message: 'id is required' });
    }
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException({ statusCode: 404, code: 'ORDER_NOT_FOUND', message: `Order '${id}' not found` });
    }
    return order;
  }

  /**
   * 對外查詢用：回傳訂單並在 payload.origin/destination 補上場域參照座標。
   *
   * 座標不在派單當下寫死進 DB——地圖之後可能再校正，寫死的話進行中訂單會拿到
   * 舊座標。改成每次查詢當下即時查表：station 用現行地圖的站點座標，facility
   * （場區格位／範圍型設施）取範圍中心值。查不到（例如地圖已無此站點）就跳過
   * 補值，保留原始欄位，不讓查詢失敗。
   */
  async getOrderByIdWithCoordinates(id: string): Promise<OperationOrder> {
    const order = await this.getOrderById(id);
    return this.attachEndpointCoordinates(order);
  }

  /** mapId 由呼叫端傳進來：列表一次幾百張單，不必每個端點都重讀一次現行地圖設定 */
  private attachEndpointCoordinates(
    order: OperationOrder,
    mapId: string = this.mapService.getActiveMapLibraryStatus().activeMapId,
  ): OperationOrder {
    const payload = (order.payload ?? {}) as Record<string, unknown>;
    if (payload.map_snapshot) return order; // 測試單保存建立時座標，不隨換圖改寫。
    const origin = this.resolveEndpointCoordinates(payload.origin, mapId);
    const destination = this.resolveEndpointCoordinates(payload.destination, mapId);
    if (!origin && !destination) {
      return order;
    }
    return {
      ...order,
      payload: {
        ...payload,
        ...(origin ? { origin } : {}),
        ...(destination ? { destination } : {}),
      },
    } as OperationOrder;
  }

  private resolveEndpointCoordinates(point: unknown, mapId: string): Record<string, unknown> | null {
    if (!point || typeof point !== 'object') return null;
    const endpoint = point as Record<string, unknown>;
    const endpointId = typeof endpoint.id === 'string' ? endpoint.id : undefined;
    const kind = typeof endpoint.kind === 'string' ? endpoint.kind : undefined;
    if (!endpointId || !kind) {
      return { ...endpoint };
    }
    try {
      if (kind === 'station') {
        const station = this.mapService.getStation(mapId, endpointId);
        return { ...endpoint, x: station.xM, y: station.yM };
      }
      if (kind === 'facility') {
        const center = this.mapService.getFacilityCenter(mapId, endpointId);
        if (center) {
          return { ...endpoint, x: center.xM, y: center.yM };
        }
      }
    } catch {
      // 查不到座標（例如地圖已改版、id 對不上）就跳過補值，回傳原始欄位。
    }
    return { ...endpoint };
  }

  async listOrders(query: ListOrdersQuery): Promise<{
    items: ShiftRecordListItem[];
    total: number;
    page: number;
    page_size: number;
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size) || 20));
    const tab: ShiftTab = query.tab === 'maintenance' ? 'maintenance' : 'mainline';

    const qb = this.orderRepository.createQueryBuilder('o');

    // 分頁跟 matchesTab 同一套業務分類（order-business-kind.ts），不看班次代號
    const businessKind = orderBusinessKindSql('o');
    if (tab === 'maintenance') {
      qb.andWhere(`${businessKind} = 'MAINTENANCE'`);
    } else {
      qb.andWhere(`${businessKind} IN ('MAINLINE', 'TRANSITION', 'TEST')`);
    }

    const vehicle = String(query.vehicle_code ?? '').trim().toUpperCase();
    if (vehicle) {
      qb.andWhere('o.vehicle_code = :vehicle', { vehicle });
    }

    const keyword = String(query.keyword ?? '').trim();
    if (keyword) {
      qb.andWhere(
        `(
          o.order_id ILIKE :kw
          OR o.trip_code ILIKE :kw
          OR o.vehicle_code ILIKE :kw
          OR COALESCE(o.next_station, '') ILIKE :kw
          OR COALESCE(o.maint_station, '') ILIKE :kw
          OR COALESCE(o.payload->>'yard_slot_id', '') ILIKE :kw
          OR (
            -- 與 order-list.util buildRouteLabel 一致：看訂單記錄的路線，不看班次代號開頭
            COALESCE(NULLIF(o.payload->>'route_name', ''), CASE o.route_id
              WHEN 'ROUTE-MAINLINE-UP' THEN 'S2W→T3→N2W'
              WHEN 'ROUTE-MAINLINE-DOWN' THEN 'N2W→T3→S2W'
              ELSE ''
            END)
          ) ILIKE :kw
          OR (
            o.line_kind = 'MAINTENANCE'
            AND CONCAT(
              'S2W→',
              COALESCE(NULLIF(TRIM(o.payload->>'yard_slot_id'), ''), o.next_station, '')
            ) ILIKE :kw
          )
          OR EXISTS (
            SELECT 1 FROM operation_route_stations rs
            WHERE rs.route_id = o.route_id AND rs.station_id ILIKE :kw
          )
        )`,
        { kw: `%${keyword}%` },
      );
    }

    if (query.planned_start_from) {
      qb.andWhere('o.planned_start >= :from', { from: query.planned_start_from });
    }
    if (query.planned_start_to) {
      qb.andWhere('o.planned_start <= :to', { to: query.planned_start_to });
    }

    const execStatus = query.execution_status;
    if (execStatus && execStatus !== 'all') {
      switch (execStatus) {
        case 'pending':
          qb.andWhere('o.status = :st', { st: OrderStatus.PENDING });
          break;
        case 'running':
          qb.andWhere(
            `o.status = :st AND COALESCE(o.delay_minutes, 0) = 0 AND NOT ${PENDING_VEHICLE_FAULT_SQL}`,
            { st: OrderStatus.PROCESSING },
          );
          break;
        case 'delayed':
          qb.andWhere(
            `o.status = :st AND COALESCE(o.delay_minutes, 0) > 0 AND NOT ${PENDING_VEHICLE_FAULT_SQL}`,
            { st: OrderStatus.PROCESSING },
          );
          break;
        case 'fault_pending':
          qb.andWhere(PENDING_VEHICLE_FAULT_SQL);
          break;
        case 'faulted':
          qb.andWhere('o.status = :st', { st: OrderStatus.FAULTED });
          break;
        case 'completed':
          qb.andWhere('o.status = :st', { st: OrderStatus.END });
          break;
        default:
          break;
      }
    }

    qb.orderBy('o.planned_start', 'DESC', 'NULLS LAST').addOrderBy('o.created_at', 'DESC');

    const total = await qb.getCount();
    const rows = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return {
      items: rows.map(toShiftRecordListItem),
      total,
      page,
      page_size: pageSize,
    };
  }

  async getOrderDetail(id: string) {
    const order = await this.getOrderById(id);
    const actions = await this.actionStateRepository.find({
      where: { orderId: id },
      order: { id: 'ASC' },
    });
    const stations = order.routeId
      ? await this.orderRouteService.getRouteStations(order.routeId)
      : [];
    const stationNameById = new Map(
      stations.map((s) => [s.stationId, s.stationDisplayName]),
    );
    const item = toShiftRecordListItem(order);
    const payload = (order.payload ?? {}) as Record<string, unknown>;
    const toEpoch = (v?: string | null) => {
      if (v == null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      ...item,
      actions: actions.map((a) => ({
        action_id: a.id,
        station_id: a.stationId,
        station_display_name: stationNameById.get(a.stationId) || null,
        action_type: a.actionType,
        action_status: a.actionStatus,
        node_id: a.nodeId ?? null,
        actual_start_time: toEpoch(a.actualStartTime ?? null),
        actual_end_time: toEpoch(a.actualEndTime ?? null),
        note: a.note ?? null,
      })),
      task_group: Array.isArray(payload.task_group) ? payload.task_group : [],
      vehicle_phase: payload.vehicle_phase ?? null,
      current_leg: payload.current_leg ?? null,
    };
  }

  /**
   * CRITICAL 安全事件：在這台車進行中的訂單記下「車輛故障，結案待確認」。
   *
   * 不改訂單狀態——訂單生命週期只由車端 REST updateOrderProgress 確認（車端介接說明書 §5.2）。
   * 告警（security_event_logs）、事件中心通知與車輛故障顯示在 mqtt.service 照常處理；
   * 這裡只讓訂單畫面不再顯示成正常運行，等車端回報 FAULTED 或復歸後 END。
   */
  async markVehicleFaultOnActiveOrder(
    vehicleCode: string,
    reason?: string,
  ): Promise<OperationOrder | null> {
    const code = String(vehicleCode ?? '').trim().toUpperCase();
    if (!code) return null;

    const order = await this.orderRepository.findOne({
      where: { vehicleCode: code, status: OrderStatus.PROCESSING },
      order: { createdAt: 'DESC' },
    });
    if (!order) return null;

    return this.withOrderLock(order.id, async () => {
      const fresh = await this.orderRepository.findOne({ where: { id: order.id } });
      if (!fresh || fresh.status !== OrderStatus.PROCESSING) return fresh ?? null;
      // 不寫 vehicle_phase（車端是唯一真值源），也不動 status／completed_at
      fresh.payload = {
        ...(fresh.payload ?? {}),
        vehicle_fault: { reported_at: Date.now(), reason: reason ?? 'CRITICAL_EVENT', source: 'event_report' },
      };
      const saved = await this.orderRepository.save(fresh);
      this.datasourceInvalidation.emitOrderLifecycle(code);
      return saved;
    });
  }

  /** 人工復歸：故障訂單恢復為進行中（示範／維運用） */
  async recoverFaultedOrderForVehicle(vehicleCode: string): Promise<OperationOrder | null> {
    const code = String(vehicleCode ?? '').trim().toUpperCase();
    if (!code) return null;

    const order = await this.orderRepository.findOne({
      where: { vehicleCode: code, status: OrderStatus.FAULTED },
      order: { createdAt: 'DESC' },
    });
    if (!order) {
      // 現在故障不會替車端結案：示範的人工復歸改成清掉進行中訂單的「車輛故障」標記
      const active = await this.orderRepository.findOne({
        where: { vehicleCode: code, status: OrderStatus.PROCESSING },
        order: { createdAt: 'DESC' },
      });
      if (!active || !(active.payload as Record<string, unknown> | null)?.vehicle_fault) return null;
      active.payload = { ...(active.payload ?? {}), vehicle_fault: null, recovered_at: Date.now() };
      const cleared = await this.orderRepository.save(active);
      this.datasourceInvalidation.emitOrderLifecycle(code);
      return cleared;
    }

    // SSOT：僅復原訂單契約狀態；vehicle_phase 留待車端下次回報更新，中心端不臆測。
    order.status = OrderStatus.PROCESSING;
    // completed_at 為 bigint 欄位，清空須用 null（空字串會被 Postgres 拒絕）
    order.completedAt = null;
    order.payload = {
      ...(order.payload ?? {}),
      fault_reason: null,
      faulted_at: null,
      recovered_at: Date.now(),
    };
    const saved = await this.orderRepository.save(order);
    this.datasourceInvalidation.emitOrderLifecycle(code);
    return saved;
  }

  assertVehicleScope(vehicleCode: string, scope?: string[]): void {
    if (scope && !scope.includes(vehicleCode)) {
      throw new ForbiddenException({ statusCode: 403, code: 'VEHICLE_NOT_AUTHORIZED', message: '此金鑰未授權操作該車輛訂單' });
    }
  }

  async activeOrders(vehicleCode: string, scope?: string[]) {
    if (!vehicleCode?.trim()) throw new BadRequestException({ statusCode: 400, code: 'VEHICLE_CODE_REQUIRED', message: 'vehicle_code is required' });
    this.assertVehicleScope(vehicleCode, scope);
    const items = await this.orderRepository.find({
      where: { vehicleCode, status: In([OrderStatus.PENDING, OrderStatus.PROCESSING, OrderStatus.FAULTED]) },
      order: { createdAt: 'ASC' },
    });
    const mapId = this.mapService.getActiveMapLibraryStatus().activeMapId;
    return { vehicle_code: vehicleCode, items: items.map(order => this.attachEndpointCoordinates(order, mapId)) };
  }

  async authorizeOrder(id: string, scope?: string[]): Promise<OperationOrder> {
    const order = await this.getOrderById(id);
    this.assertVehicleScope(order.vehicleCode, scope);
    return order;
  }

  async authorizeAction(id: string, scope?: string[]): Promise<void> {
    const action = await this.actionStateRepository.findOne({ where: { id } });
    if (!action) throw new NotFoundException({ statusCode: 404, code: 'ACTION_NOT_FOUND', message: `Action '${id}' not found` });
    await this.authorizeOrder(action.orderId, scope);
  }

  /**
   * @param options.reporter 'vehicle'＝車端經 REST updateOrderProgress 回報；只有這種會記下
   *   payload.vehicle_progress_at（車端證據），中心端內部呼叫（示範等）不記。
   */
  async updateOrderStatus(
    id: string,
    statusStr: string,
    options?: { reporter?: 'vehicle'; operatingAt?: number },
  ): Promise<OperationOrder> {
    if (!this.nonEmpty(id)) return this.updateOrderStatusLocked(id, statusStr, options);
    return this.withOrderLock(id, () => this.updateOrderStatusLocked(id, statusStr, options));
  }

  private async updateOrderStatusLocked(
    id: string,
    statusStr: string,
    options?: { reporter?: 'vehicle'; operatingAt?: number },
  ): Promise<OperationOrder> {
    const order = await this.getOrderById(id);
    const normalizedStatus = this.nonEmpty(statusStr);
    if (!normalizedStatus) {
      throw new BadRequestException({ statusCode: 400, code: 'STATUS_REQUIRED', message: 'status is required' });
    }
    const targetStatus = normalizedStatus as OrderStatus;

    if (![OrderStatus.PROCESSING, OrderStatus.END, OrderStatus.FAULTED].includes(targetStatus)) {
      throw new BadRequestException({ statusCode: 400, code: 'INVALID_ORDER_STATUS', message: 'status 必須為 PROCESSING、END 或 FAULTED（大寫）' });
    }

    if (order.status === targetStatus) {
      // HTTP 回應遺失後可安全重試；沒記到車端證據（舊資料）時補記，其他不動
      if (options?.reporter === 'vehicle') {
        const payload = (order.payload ?? {}) as Record<string, unknown>;
        const progress = (payload.vehicle_progress_at ?? {}) as Record<string, number>;
        if (progress[targetStatus] == null) {
          order.payload = { ...payload, vehicle_progress_at: { ...progress, [targetStatus]: Date.now() } };
          return this.orderRepository.save(order);
        }
      }
      return order;
    }
    /*
     * 中心端已請求取消的單：不能再開始（PROCESSING），取消結案（FAULTED）之後也不能被改回
     * 執行中或完成——不然車端遲到的回報會把已中止的任務「復活」。執行中剛好正常跑完
     * （PROCESSING → END）仍照實接受：那是真的完成，不改成中止。
     */
    const cancelRequested = Boolean((order.payload as Record<string, unknown> | null)?.cancel_requested_at);
    if (cancelRequested && (
      targetStatus === OrderStatus.PROCESSING
      || (order.status === OrderStatus.FAULTED && targetStatus === OrderStatus.END)
    )) {
      throw new ConflictException({
        statusCode: 409,
        code: 'ORDER_CANCELLED',
        message: `訂單已由中心端取消，不能改為 '${targetStatus}'`,
      });
    }
    const allowedNextStatuses = VALID_TRANSITIONS[order.status];
    if (!allowedNextStatuses.includes(targetStatus)) {
      throw new BadRequestException({ statusCode: 400, code: 'INVALID_ORDER_TRANSITION', message: `Invalid state transition: '${order.status}' → '${targetStatus}'.` });
    }

    const now = Date.now();
    if (options?.operatingAt != null && (!Number.isSafeInteger(options.operatingAt) || options.operatingAt < 0)) {
      throw new BadRequestException({ statusCode: 400, code: 'INVALID_OPERATING_AT', message: 'operating_at 必須為非負 Epoch 毫秒整數' });
    }
    order.status = targetStatus;
    if (options?.reporter === 'vehicle') {
      // 車端 REST 回報的證據（中心端收到的時間）；追蹤統計的「開始／結案」只認這個
      const payload = (order.payload ?? {}) as Record<string, unknown>;
      order.payload = {
        ...payload,
        vehicle_progress_at: { ...((payload.vehicle_progress_at ?? {}) as Record<string, number>), [targetStatus]: now },
      };
    }
    // 營運時刻（operating-day.ts）：計畫時刻、延誤、班次中心都在營運時間上比；實際時刻另外保留
    // 車端已在共用營運時鐘上知道事件發生時刻時，以該時刻計算準點；HTTP 接收時間仍保留在
    // vehicle_progress_at／completedAt，避免倍速把網路與事件迴圈延遲放大成營運延誤。
    const operatingNow = options?.operatingAt ?? this.toOperating(now);
    if (targetStatus === OrderStatus.END || targetStatus === OrderStatus.FAULTED) {
      order.completedAt = String(now);
      order.payload = { ...((order.payload ?? {}) as Record<string, unknown>), op_completed_at: operatingNow };
      if (targetStatus === OrderStatus.FAULTED && cancelRequested) {
        // 協議用 FAULTED 結案取消；記下原因，介面與統計跟真正故障分開
        order.payload = { ...((order.payload ?? {}) as Record<string, unknown>), closed_reason: 'cancelled_by_center' };
      }
      // 延誤＝結束晚於計畫結束的整分鐘數（不到一分鐘算準點），以營運時間比。班次中心的「延誤班次」
      // 與班次運行紀錄的準點／延誤篩選都讀這個欄位；先前只有示範模擬會寫它。
      const plannedEnd = Number(order.plannedEnd);
      if (targetStatus === OrderStatus.END && Number.isFinite(plannedEnd) && plannedEnd > 0) {
        order.delayMinutes = Math.max(0, Math.floor((operatingNow - plannedEnd) / 60_000));
      }
    } else if (targetStatus === OrderStatus.PROCESSING) {
      // bigint 欄位清空須用 null，不可用空字串
      order.completedAt = null;
      // 發車時刻：運能趨勢的「即時數值」照實際發車算，不照計畫。故障復歸不覆寫。
      // actual_started_at 是收到的實際時刻；op_started_at 是同一刻的營運時刻
      const payload = (order.payload ?? {}) as Record<string, unknown>;
      if (payload.actual_started_at == null) {
        order.payload = { ...payload, actual_started_at: now, op_started_at: operatingNow };
      }
    }
    const saved = await this.orderRepository.save(order);
    this.datasourceInvalidation.emitOrderLifecycle(saved.vehicleCode);
    return saved;
  }

  /**
   * 中心端主動取消一張已下發訂單（行控人員操作，內部端點，不對外）。
   *
   * 只負責發起，不強制車端結案：REST 立刻在 payload 寫下 cancel_requested_at
   * 當作權威事實，MQTT operation/cancel 只是低延遲通知——跟建立訂單時
   * REST 寫庫、MQTT operation/assign 只通知是同一個模式。車端收到通知或下次對帳
   * 發現這個欄位後，照既有協議呼叫 updateOrderProgress?status=FAULTED 結案；
   * 中心端這裡不等、也不替車端把狀態轉成 FAULTED——那是車端的權威回報，不是中心端
   * 能代打的。
   *
   * 只有 PENDING、PROCESSING 能取消：END／FAULTED 已經是終態，取消沒有意義。
   * 重複呼叫同一張已請求取消的單，冪等回傳、不重發 MQTT（不然行控多點兩下，
   * 車端就收到兩則一樣的通知）。
   */
  async requestCancel(id: string): Promise<OperationOrder> {
    if (!this.nonEmpty(id)) return this.requestCancelLocked(id);
    return this.withOrderLock(id, () => this.requestCancelLocked(id));
  }

  private async requestCancelLocked(id: string): Promise<OperationOrder> {
    const order = await this.getOrderById(id);

    if (order.status === OrderStatus.END || order.status === OrderStatus.FAULTED) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'ORDER_ALREADY_CLOSED',
        message: `訂單已是終態 '${order.status}'，無法取消`,
      });
    }

    const payload = (order.payload ?? {}) as Record<string, unknown>;
    if (payload.cancel_requested_at) {
      return order; // 已經請求過，冪等回傳，不重發 MQTT
    }

    order.payload = { ...payload, cancel_requested_at: Date.now() };
    const saved = await this.orderRepository.save(order);
    this.orderMqttPublisher.publishCancel(saved.vehicleCode, saved.id);
    this.datasourceInvalidation.emitOrderLifecycle(saved.vehicleCode);
    return saved;
  }

  /** 車端以 action_id 回報動作狀態（REST SSOT） */
  async updateActionStatus(
    actionId: string,
    body: { status: string; note?: string; actual_start_time?: number; actual_end_time?: number },
  ): Promise<OrderActionState> {
    const row = await this.actionStateRepository.findOne({ where: { id: actionId } });
    if (!row) {
      throw new NotFoundException({ statusCode: 404, code: 'ACTION_NOT_FOUND', message: `Action '${actionId}' not found` });
    }

    const status = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'].includes(body.status)
      ? this.orderRouteService.normalizeActionStatus(body.status) : null;
    if (!status) {
      throw new BadRequestException({ statusCode: 400, code: 'INVALID_ACTION_STATUS', message: `Invalid action status: '${body.status}'` });
    }

    row.actionStatus = status;
    if (body.note != null) row.note = body.note;
    if (body.actual_start_time != null) row.actualStartTime = String(body.actual_start_time);
    if (body.actual_end_time != null) row.actualEndTime = String(body.actual_end_time);
    await this.actionStateRepository.save(row);

    await this.withOrderLock(row.orderId, async () => {
      const order = await this.getOrderById(row.orderId);
      const progress = await this.orderRouteService.computeRouteProgress(order.id, order.routeId ?? null);
      order.payload = {
        ...(order.payload ?? {}),
        route_progress: progress,
        active_action_id: actionId,
        updated_at: Date.now(),
      };
      await this.orderRepository.save(order);
    });

    return row;
  }

  /**
   * 車端 operation/update（MQTT）→ 既有訂單的執行進度。
   *
   * <h3>MQTT 不改訂單狀態，也不建立訂單</h3>
   * 協議規定訂單狀態只由 REST updateOrderProgress 變更（見 document/對外介接/車端介接說明書.md §二、§5.2），
   * 所以這裡：
   * - 只用訂單 ID 對應既有訂單；沒有 order_id、找不到訂單、回報的車不是指派的車，一律不寫，
   *   回傳診斷原因，不替不存在的訂單造一張卡。
   * - 不管班次代號長什麼樣（D1234、NT0000、其他），都不會把 PENDING 改成 PROCESSING：
   *   開始執行只認車端的 REST 回報。待發中的單只刷新下一站與 ETA。
   * - 終態（END、FAULTED）的單不再寫進度；比上次回報還舊、或同一刻重送的訊息直接略過。
   * - 業務分類、路線、計畫時刻、班次代號都以中心端下單時的記錄為準，不用班次名稱推。
   */
  async applyOperationMqttUpdate(
    vehicleCode: string,
    payload: OperationMqttPayload,
  ): Promise<OperationOrder | null> {
    const outcome = await this.applyOperationMqttUpdateWithOutcome(vehicleCode, payload);
    return outcome.order;
  }

  async applyOperationMqttUpdateWithOutcome(
    vehicleCode: string,
    payload: OperationMqttPayload,
  ): Promise<{ order: OperationOrder | null; outcome: OperationMqttOutcome; assignedVehicle?: string }> {
    const orderId = this.nonEmpty(payload.order_id);
    if (!orderId) return { order: null, outcome: 'missing_order_id' };
    return this.withOrderLock(orderId, () => this.applyOperationMqttUpdateLocked(orderId, vehicleCode, payload));
  }

  private async applyOperationMqttUpdateLocked(
    orderId: string,
    vehicleCode: string,
    payload: OperationMqttPayload,
  ): Promise<{ order: OperationOrder | null; outcome: OperationMqttOutcome; assignedVehicle?: string }> {

    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) return { order: null, outcome: 'unknown_order' };
    if (order.vehicleCode !== vehicleCode) {
      return { order: null, outcome: 'vehicle_mismatch', assignedVehicle: order.vehicleCode };
    }

    const prevPayload = (order.payload ?? {}) as Record<string, unknown>;
    const reportedAt = typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp)
      ? payload.timestamp
      : null;
    // 只跟上一則車端 MQTT 的時間比（同一個時鐘）；updated_at 也會被 REST 動作回報用伺服器時間寫，不能拿來比
    const lastReportedAt = typeof prevPayload.last_operation_report_at === 'number'
      ? prevPayload.last_operation_report_at
      : null;
    if (reportedAt != null && lastReportedAt != null && reportedAt <= lastReportedAt) {
      return { order, outcome: reportedAt === lastReportedAt ? 'duplicate' : 'stale' };
    }

    const vehiclePhase = String(payload.vehicle_phase ?? '').toUpperCase();
    // 中心端已取消、還沒結案的單：等車端用 REST 回報 FAULTED，進度不再寫
    if (prevPayload.cancel_requested_at) {
      return { order, outcome: 'cancel_requested' };
    }
    if (order.status === OrderStatus.PENDING) {
      // 待發：只刷新顯示用的下一站與 ETA；車端報什麼 phase 都不算開始
      return { order: await this.applyPendingOperationRefresh(order, payload), outcome: 'pending_refreshed' };
    }
    if (order.status !== OrderStatus.PROCESSING) {
      return { order, outcome: 'not_processing' };
    }

    // 路線只用訂單自己的記錄；舊訂單沒記錄時才看車端回報，不從班次代號推
    const routeId = order.routeId ?? this.nonEmpty(payload.route_id);

    // vehicle_phase=FAULTED 不結案：照常寫進度，並標「車輛故障，結案待確認」（vehicle_fault），
    // 等車端用 REST 回報 FAULTED；車端之後回報正常 phase 就清掉標記
    const faultMark = this.vehicleFaultMark(prevPayload, vehiclePhase);

    if (Array.isArray(payload.task_group) && payload.task_group.length > 0) {
      await this.orderRouteService.applyTaskGroupUpdate(
        orderId,
        payload.task_group as Parameters<OrderRouteService['applyTaskGroupUpdate']>[1],
      );
    }

    if (payload.event?.event_type) {
      await this.recordOrderEvent(orderId, payload.event);
    }

    const currentLeg = typeof payload.current_leg === 'object' ? payload.current_leg : null;
    const legTarget = this.nonEmpty(currentLeg?.target_station_id);
    const etaSec = typeof currentLeg?.eta_seconds === 'number'
      ? Math.max(0, Math.round(currentLeg.eta_seconds))
      : null;

    const legEtaMax: Record<string, number> = {
      ...((prevPayload.leg_eta_max as Record<string, number> | undefined) ?? {}),
    };
    if (legTarget && etaSec != null) {
      legEtaMax[legTarget] = Math.max(legEtaMax[legTarget] ?? 0, etaSec);
    }
    // leg_eta_max 的權威來源是訂單自己的站序計畫時刻（前一站計畫發車→本站計畫抵達），
    // 車端不需要回報這個值——資料本來就在派單時寫進 payload.stations[]。
    // currentLeg?.leg_eta_max 只在排班資料算不出來時才當相容性 fallback 用。
    const legEtaMaxFromSchedule = legTarget
      ? this.computeLegEtaMaxFromSchedule(order, legTarget)
      : null;
    const legEtaMaxFromPayload = typeof currentLeg?.leg_eta_max === 'number'
      ? Math.max(0, Math.round(currentLeg.leg_eta_max))
      : null;
    if (legTarget) {
      const preferred = legEtaMaxFromSchedule
        ?? (legEtaMaxFromPayload != null && legEtaMaxFromPayload > 0 ? legEtaMaxFromPayload : null);
      if (preferred != null) {
        legEtaMax[legTarget] = preferred;
      }
    }
    const maxEta = legTarget ? (legEtaMax[legTarget] ?? etaSec ?? 0) : 0;

    const computedProgress = await this.orderRouteService.computeRouteProgress(
      orderId,
      routeId,
    );
    const effectiveRouteId = routeId ?? null;
    const routeStations = effectiveRouteId
      ? await this.orderRouteService.getRouteStations(effectiveRouteId)
      : [];
    const midStationId = routeStations.length >= 2
      ? routeStations[Math.min(1, routeStations.length - 1)].stationId
      : null;
    const routeProgress = this.computeRouteProgressFromLeg(
      legTarget,
      etaSec,
      maxEta,
      computedProgress,
      midStationId,
    );
    const segmentIndex = legTarget && midStationId
      ? (legTarget === midStationId ? 0 : 1)
      : routeProgress < 50 ? 0 : 1;
    const segmentRemainPct = maxEta > 0 && etaSec != null
      ? Math.round((etaSec / maxEta) * 100)
      : 0;

    const nextStation = await this.orderRouteService.computeNextStation(
      orderId,
      routeId,
    );

    const operationAction = deriveOperationActionFromTaskGroup(payload.task_group);

    order.routeId = routeId ?? undefined;
    order.nextStation = nextStation ?? order.nextStation;
    // 計畫時刻由中心端決定，車端回報不得覆蓋；沒有計畫時刻的舊單就維持沒有，不拿班次代號推。
    order.etaRemain = etaSec != null
      ? this.formatSecondsMmSs(etaSec)
      : this.formatEtaMmSs(routeProgress, 6);
    // 合併而不是整包取代。
    //
    // payload 同時裝著兩種東西：中心端下單時寫入的<strong>任務內容</strong>
    // （起訖點、站序、班表出處）與車端回報的<strong>執行進度</strong>。整包覆蓋
    // 會讓第一次進度回報就把任務內容清掉——車輛之後重取 GET /order/queryById
    // 就再也拿不到自己要去哪裡，而且畫面上的路徑也會跟著消失。
    order.payload = {
      ...(order.payload ?? {}),
      vehicle_phase: payload.vehicle_phase ?? null,
      current_leg: currentLeg ?? null,
      leg_eta_max: legEtaMax,
      segment_index: segmentIndex,
      segment_remain_pct: segmentRemainPct,
      route_progress: routeProgress,
      operation_action: operationAction,
      updated_at: payload.timestamp ?? Date.now(),
      ...(reportedAt != null ? { last_operation_report_at: reportedAt } : {}),
      ...confirmedDwellPatch(vehiclePhase, legTarget, reportedAt),
      ...faultMark,
    };

    return {
      order: await this.orderRepository.save(order),
      outcome: vehiclePhase === 'FAULTED' ? 'vehicle_fault_reported' : 'progress_applied',
    };
  }

  /** 示範／排班：中心端建立正線訂單並 MQTT assign（REST 契約） */
  async ensureMainlineOrder(
    vehicleCode: string,
    orderId: string,
    tripCode: string,
    routeId: string,
  ): Promise<OperationOrder> {
    const existing = await this.orderRepository.findOne({ where: { id: orderId } });
    if (existing) {
      return existing;
    }

    const staleOrders = await this.orderRepository.find({
      where: {
        vehicleCode,
        status: OrderStatus.PROCESSING,
      },
    });
    for (const stale of staleOrders) {
      if (stale.id === orderId) continue;
      if ((stale.payload as Record<string, unknown> | null)?.source !== BACKEND_DEMO_SOURCE) continue;
      stale.status = OrderStatus.END;
      stale.completedAt = String(Date.now());
      await this.orderRepository.save(stale);
    }

    return this.createOrder({
      order_id: orderId,
      vehicle_code: vehicleCode,
      trip_code: tripCode,
      route_id: routeId,
      line_kind: 'MAINLINE',
      priority_level: 50,
      payload: { source: BACKEND_DEMO_SOURCE },
    }, { initialStatus: OrderStatus.PENDING });
  }

  /** 示範：待發班次訂單（模擬發車前） */
  async ensurePendingMainlineShift(
    vehicleCode: string,
    orderId: string,
    tripCode: string,
    routeId: string,
  ): Promise<OperationOrder> {
    const existing = await this.orderRepository.findOne({ where: { id: orderId } });
    if (existing) {
      if (existing.status === OrderStatus.PROCESSING || existing.status === OrderStatus.FAULTED) {
        return existing;
      }
      // 不是示範建的單（正式調度、模擬器重播）：示範不能改它的車、班次與分類
      if ((existing.payload as Record<string, unknown> | null)?.source !== BACKEND_DEMO_SOURCE) {
        return existing;
      }
      existing.vehicleCode = vehicleCode;
      existing.tripCode = tripCode;
      existing.routeId = existing.routeId ?? routeId;
      existing.lineKind = 'MAINLINE';
      existing.payload = {
        ...(existing.payload ?? {}),
        segment_index: 0,
        segment_remain_pct: 100,
        route_progress: 0,
        current_leg: null,
      };
      return this.orderRepository.save(existing);
    }

    return this.createOrder({
      order_id: orderId,
      vehicle_code: vehicleCode,
      trip_code: tripCode,
      route_id: routeId,
      line_kind: 'MAINLINE',
      priority_level: 50,
      payload: {
        source: BACKEND_DEMO_SOURCE,
        segment_index: 0,
        segment_remain_pct: 100,
        route_progress: 0,
        current_leg: null,
      },
    }, { initialStatus: OrderStatus.PENDING, skipAssign: true });
  }

  /** 示範：發車後僅做一次 PENDING → PROCESSING（進度由 MQTT operation/update 更新） */
  async promoteMainlineShiftToProcessing(
    vehicleCode: string,
    orderId: string,
    tripCode: string,
    routeId: string,
  ): Promise<OperationOrder> {
    await this.ensureMainlineOrder(vehicleCode, orderId, tripCode, routeId);
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (order.status === OrderStatus.PENDING) {
      return this.updateOrderStatus(orderId, 'PROCESSING');
    }
    return order;
  }

  /**
   * 示範 tick：依模擬器回報的快照確保訂單存在，並結束已離場的殘留訂單。
   * 台數上限由模擬器／派車策略決定，後端不寫死容量。
   * 進度寫入交由 MQTT → applyOperationMqttUpdate。
   */
  async reconcileMainlineOrderLifecycle(
    snapshots: ReadonlyArray<MainlineOrderLifecycleSnapshot>,
  ): Promise<number> {
    const activeOrderIds = new Set<string>();
    const deduped = new Map<string, MainlineOrderLifecycleSnapshot>();

    for (const snap of snapshots) {
      const prev = deduped.get(snap.orderId);
      if (!prev || snap.phase === 'processing') {
        deduped.set(snap.orderId, snap);
      }
    }

    for (const snap of deduped.values()) {
      activeOrderIds.add(snap.orderId);
      if (snap.phase === 'pending') {
        await this.ensurePendingMainlineShift(
          snap.vehicleCode,
          snap.orderId,
          snap.tripCode,
          snap.routeId,
        );
      } else {
        await this.promoteMainlineShiftToProcessing(
          snap.vehicleCode,
          snap.orderId,
          snap.tripCode,
          snap.routeId,
        );
      }
    }

    const openOrders = await this.orderRepository.find({
      where: {
        lineKind: 'MAINLINE',
        status: In([OrderStatus.PENDING, OrderStatus.PROCESSING]),
      },
    });

    let ended = 0;
    for (const order of openOrders) {
      // 只收示範自己建的單；正式調度、模擬器重播的單不能因為班次代號長得像就被結束
      if ((order.payload as Record<string, unknown> | null)?.source !== BACKEND_DEMO_SOURCE) continue;
      if (activeOrderIds.has(order.id)) continue;
      order.status = OrderStatus.END;
      order.completedAt = String(Date.now());
      await this.orderRepository.save(order);
      ended += 1;
    }

    return ended;
  }

  /**
   * 示範 tick：依模擬器回報同步整備任務訂單（DEMO-ORD-*），車輛回正線時結束殘留任務。
   */
  async reconcileMaintenanceOrderLifecycle(
    snapshots: ReadonlyArray<MaintenanceOrderLifecycleSnapshot>,
  ): Promise<number> {
    const activeOrderIds = new Set<string>();

    for (const snap of snapshots) {
      activeOrderIds.add(snap.orderId);
      const order = await this.ensureMaintenanceShift(snap);
      if (snap.phase === 'processing' && order.status === OrderStatus.PENDING) {
        await this.updateOrderStatus(snap.orderId, 'PROCESSING');
      }
    }

    const openOrders = await this.orderRepository.find({
      where: {
        lineKind: 'MAINTENANCE',
        status: In([OrderStatus.PENDING, OrderStatus.PROCESSING]),
      },
    });

    let ended = 0;
    for (const order of openOrders) {
      if (!order.id.startsWith('DEMO-ORD-')) continue;
      if (activeOrderIds.has(order.id)) continue;
      order.status = OrderStatus.END;
      order.completedAt = String(Date.now());
      await this.orderRepository.save(order);
      ended += 1;
    }

    return ended;
  }

  private async ensureMaintenanceShift(
    snap: MaintenanceOrderLifecycleSnapshot,
  ): Promise<OperationOrder> {
    const payloadPatch = {
      yard_slot_id: snap.yardSlotId ?? null,
      segment_index: snap.segmentIndex,
      segment_remain_pct: Math.max(0, 100 - snap.routeProgress),
      route_progress: snap.routeProgress,
    };
    const maintStation = snap.maintStation ?? snap.yardSlotId ?? undefined;
    const existing = await this.orderRepository.findOne({ where: { id: snap.orderId } });
    if (existing) {
      existing.vehicleCode = snap.vehicleCode;
      existing.tripCode = snap.tripCode;
      existing.lineKind = 'MAINTENANCE';
      existing.maintTypeLabel = snap.maintTypeLabel;
      existing.maintTypeBg = snap.maintTypeBg;
      existing.maintTypeColor = snap.maintTypeColor;
      existing.iconBgColor = snap.iconBgColor;
      existing.progressMarkerIcon = snap.progressMarkerIcon;
      existing.maintStation = maintStation;
      existing.nextStation = snap.yardSlotId ?? maintStation ?? existing.nextStation;
      existing.payload = { ...(existing.payload ?? {}), ...payloadPatch };
      if (existing.status === OrderStatus.END) {
        existing.status = OrderStatus.PENDING;
        existing.completedAt = null;
      }
      return this.orderRepository.save(existing);
    }

    const created = await this.createOrder({
      order_id: snap.orderId,
      vehicle_code: snap.vehicleCode,
      trip_code: snap.tripCode,
      line_kind: 'MAINTENANCE',
      priority_level: 40,
      payload: payloadPatch,
    }, { initialStatus: OrderStatus.PENDING, skipAssign: true });
    created.maintTypeLabel = snap.maintTypeLabel;
    created.maintTypeBg = snap.maintTypeBg;
    created.maintTypeColor = snap.maintTypeColor;
    created.iconBgColor = snap.iconBgColor;
    created.progressMarkerIcon = snap.progressMarkerIcon;
    created.maintStation = maintStation;
    created.nextStation = snap.yardSlotId ?? maintStation;
    return this.orderRepository.save(created);
  }

  /**
   * 車端 MQTT 的 phase 對「車輛故障，結案待確認」標記的影響：FAULTED 時記下（已有就不覆蓋時間），
   * 回報其他 phase 表示車端已不在故障中，清掉標記；沒報 phase 就不動。
   */
  private vehicleFaultMark(prevPayload: Record<string, unknown>, vehiclePhase: string): Record<string, unknown> {
    if (vehiclePhase === 'FAULTED') {
      return prevPayload.vehicle_fault
        ? {}
        : { vehicle_fault: { reported_at: Date.now(), reason: 'VEHICLE_PHASE_FAULTED', source: 'operation_update' } };
    }
    return vehiclePhase && prevPayload.vehicle_fault ? { vehicle_fault: null } : {};
  }

  /**
   * 待發的單：只刷新下一站與 ETA，不升級為 PROCESSING、不改分類與班次代號。
   * 任何業務分類、任何班次代號都一樣——開始執行只認車端 REST 回報。
   */
  private async applyPendingOperationRefresh(
    order: OperationOrder,
    payload: OperationMqttPayload,
  ): Promise<OperationOrder> {
    const currentLeg = typeof payload.current_leg === 'object' ? payload.current_leg : null;
    const legTarget = this.nonEmpty(currentLeg?.target_station_id);
    const etaSec = typeof currentLeg?.eta_seconds === 'number'
      ? Math.max(0, Math.round(currentLeg.eta_seconds))
      : null;
    // 同 applyOperationMqttUpdate：leg_eta_max 優先從訂單自己的站序計畫時刻推算，
    // 車端回報值只在算不出來時當相容性 fallback。
    const legEtaMaxFromSchedule = legTarget
      ? this.computeLegEtaMaxFromSchedule(order, legTarget)
      : null;
    const legEtaMaxFromPayload = typeof currentLeg?.leg_eta_max === 'number'
      ? Math.max(0, Math.round(currentLeg.leg_eta_max))
      : null;

    const prevPayload = (order.payload ?? {}) as Record<string, unknown>;
    const legEtaMax: Record<string, number> = {
      ...((prevPayload.leg_eta_max as Record<string, number> | undefined) ?? {}),
    };
    if (legTarget) {
      const preferred = legEtaMaxFromSchedule
        ?? (legEtaMaxFromPayload != null && legEtaMaxFromPayload > 0 ? legEtaMaxFromPayload : null);
      if (preferred != null) {
        legEtaMax[legTarget] = preferred;
      } else if (etaSec != null) {
        legEtaMax[legTarget] = Math.max(legEtaMax[legTarget] ?? 0, etaSec);
      }
    }

    if (legTarget) {
      order.nextStation = legTarget;
    }
    if (etaSec != null) {
      order.etaRemain = this.formatSecondsMmSs(etaSec);
    }
    order.payload = {
      ...(order.payload ?? {}),
      vehicle_phase: payload.vehicle_phase ?? 'AWAITING_DEPARTURE',
      current_leg: currentLeg ?? null,
      leg_eta_max: legEtaMax,
      operation_action: payload.operation_action ?? null,
      route_progress: 0,
      segment_index: 0,
      segment_remain_pct: 100,
      updated_at: payload.timestamp ?? Date.now(),
      ...(typeof payload.timestamp === 'number' ? { last_operation_report_at: payload.timestamp } : {}),
      ...confirmedDwellPatch(
        String(payload.vehicle_phase ?? '').toUpperCase(),
        legTarget,
        typeof payload.timestamp === 'number' ? payload.timestamp : null,
      ),
      ...this.vehicleFaultMark(
        (order.payload ?? {}) as Record<string, unknown>,
        String(payload.vehicle_phase ?? '').toUpperCase(),
      ),
    };
    return this.orderRepository.save(order);
  }

  private async recordOrderEvent(
    orderId: string,
    event: NonNullable<OperationMqttPayload['event']>,
  ): Promise<void> {
    const eventId = this.nonEmpty(event.event_id) ?? `${orderId}_EVT_${Date.now()}`;
    const existing = await this.orderEventRepository.findOne({ where: { id: eventId } });
    const row = existing ?? this.orderEventRepository.create({ id: eventId });
    Object.assign(row, {
      orderId,
      eventType: String(event.event_type),
      requestStatus: event.request_status ?? 'PENDING',
      completionStatus: event.completion_status ?? null,
      payload: event.payload ?? {},
      createdAt: existing?.createdAt ?? String(Date.now()),
      resolvedAt: event.completion_status ? String(Date.now()) : null,
    });
    await this.orderEventRepository.save(row);
  }

  private normalizeOrderStatus(raw: unknown, lineKind: string): OrderStatus | null {
    const v = this.nonEmpty(raw)?.toUpperCase();
    if (v && Object.values(OrderStatus).includes(v as OrderStatus)) return v as OrderStatus;
    if (lineKind === 'MAINLINE') return OrderStatus.PROCESSING;
    return null;
  }

  private nonEmpty(raw: unknown): string | null {
    if (raw == null) return null;
    const v = String(raw).trim();
    return v ? v : null;
  }

  /**
   * 從訂單自己的站序計畫時刻推算某一段（前一停靠點計畫發車 → 目標停靠點計畫
   * 抵達）的計畫總秒數。車端不需要回報 current_leg.leg_eta_max——這個資料
   * 派單當下就已經寫進 order.payload.stations[] 了。
   */
  private computeLegEtaMaxFromSchedule(
    order: OperationOrder,
    targetStationId: string,
  ): number | null {
    const payload = (order.payload ?? {}) as Record<string, unknown>;
    const stations = Array.isArray(payload.stations)
      ? (payload.stations as Array<Record<string, unknown>>)
      : [];
    const index = stations.findIndex(
      (s) => this.nonEmpty(s.station_id) === targetStationId,
    );
    if (index <= 0) return null;
    const arriveAt = stations[index]?.arrive_at;
    const departAt = stations[index - 1]?.depart_at;
    if (typeof arriveAt !== 'number' || typeof departAt !== 'number') return null;
    const seconds = Math.round((arriveAt - departAt) / 1000);
    return seconds > 0 ? seconds : null;
  }

  private computeRouteProgressFromLeg(
    legTarget: string | null,
    etaSec: number | null,
    maxEta: number,
    fallback: number,
    midStationId: string | null,
  ): number {
    if (!legTarget || etaSec == null || maxEta <= 0) return fallback;
    const legFraction = Math.max(0, Math.min(1, (maxEta - etaSec) / maxEta));
    if (midStationId && legTarget === midStationId) {
      if (etaSec === 0) return 50;
      return Math.round(legFraction * 50);
    }
    if (etaSec === 0) return 100;
    return Math.round(50 + legFraction * 50);
  }

  private async resolveSegmentIndex(
    routeId: string | null | undefined,
    legTarget: string,
  ): Promise<number> {
    if (!routeId) return 0;
    const stations = await this.orderRouteService.getRouteStations(routeId);
    if (stations.length < 2) return 0;
    const mid = stations[Math.min(1, stations.length - 1)];
    return legTarget === mid.stationId ? 0 : 1;
  }

  private formatSecondsMmSs(totalSec: number): string {
    const sec = Math.max(0, Math.round(totalSec));
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  private formatEtaMmSs(progressPct: number, legMinutes: number): string {
    const progress = Math.min(100, Math.max(0, progressPct));
    const totalSec = Math.max(0, Math.round((1 - progress / 100) * legMinutes * 60));
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }
}
