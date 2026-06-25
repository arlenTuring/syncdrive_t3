import {
  Injectable,
  NotFoundException,
  BadRequestException,
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
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.PROCESSING],
  [OrderStatus.PROCESSING]: [OrderStatus.END, OrderStatus.FAULTED],
  [OrderStatus.END]: [],
  [OrderStatus.FAULTED]: [OrderStatus.PROCESSING, OrderStatus.END],
};

export type OperationCurrentLeg = {
  target_station_id?: string;
  distance_to_target_m?: number;
  eta_seconds?: number;
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

export type OperationMqttPayload = {
  order_id?: string;
  trip_code?: string;
  vehicle_code?: string;
  vehicle_phase?: string;
  order_status?: string;
  operation_action?: string;
  line_kind?: string;
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
  ) {}

  async createOrder(
    data: {
      order_id: string;
      vehicle_code: string;
      trip_code: string;
      route_id?: string;
      priority_level?: number;
      line_kind?: string;
      payload?: Record<string, unknown>;
    },
    options?: { skipAssign?: boolean; initialStatus?: OrderStatus },
  ): Promise<OperationOrder> {
    if (!data.order_id || !data.vehicle_code || !data.trip_code) {
      throw new BadRequestException('order_id, vehicle_code, trip_code are required.');
    }

    const routeId = data.route_id
      ?? this.orderRouteService.routeIdForTripCode(data.trip_code)
      ?? undefined;
    const lineKind = data.line_kind
      ?? (routeId ? 'MAINLINE' : undefined);

    const order = this.orderRepository.create({
      id: data.order_id,
      tripCode: data.trip_code,
      vehicleCode: data.vehicle_code,
      routeId,
      priorityLevel: data.priority_level ?? 50,
      lineKind,
      payload: data.payload ?? {},
      status: options?.initialStatus ?? OrderStatus.PENDING,
      createdAt: String(Date.now()),
    });
    const saved = await this.orderRepository.save(order);

    if (routeId) {
      await this.orderRouteService.materializeActionStates(saved.id, routeId);
    }

    if (!options?.skipAssign) {
      this.orderMqttPublisher.publishAssign(
        saved.vehicleCode,
        saved.id,
        saved.priorityLevel,
      );
    }

    this.datasourceInvalidation.emitOrderLifecycle(saved.vehicleCode);
    return saved;
  }

  async getOrderById(id: string): Promise<OperationOrder> {
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with id '${id}' not found`);
    }
    return order;
  }

  /** CRITICAL 安全事件或 vehicle_phase=FAULTED 時，將進行中訂單標記為故障 */
  async faultActiveOrderForVehicle(
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

    // SSOT：中心端僅變更訂單契約狀態 (order.status)，
    // 不寫入 vehicle_phase（車端為其唯一真值源，此處保留車端最後回報值）。
    order.status = OrderStatus.FAULTED;
    order.completedAt = String(Date.now());
    order.payload = {
      ...(order.payload ?? {}),
      fault_reason: reason ?? 'CRITICAL_EVENT',
      faulted_at: Date.now(),
    };
    const saved = await this.orderRepository.save(order);
    this.datasourceInvalidation.emitOrderLifecycle(code);
    return saved;
  }

  /** 人工復歸：故障訂單恢復為進行中（示範／維運用） */
  async recoverFaultedOrderForVehicle(vehicleCode: string): Promise<OperationOrder | null> {
    const code = String(vehicleCode ?? '').trim().toUpperCase();
    if (!code) return null;

    const order = await this.orderRepository.findOne({
      where: { vehicleCode: code, status: OrderStatus.FAULTED },
      order: { createdAt: 'DESC' },
    });
    if (!order) return null;

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

  private async applyFaultToOrder(
    order: OperationOrder,
    reason: string,
    payload?: OperationMqttPayload,
  ): Promise<OperationOrder> {
    // 此路徑由車端 operation/update 回報 vehicle_phase=FAULTED 觸發，
    // 故 vehicle_phase 僅鏡像車端回報值（不存在則留空），不由中心端臆造。
    order.status = OrderStatus.FAULTED;
    order.completedAt = String(Date.now());
    order.payload = {
      ...(order.payload ?? {}),
      vehicle_phase: payload?.vehicle_phase ?? null,
      fault_reason: reason,
      faulted_at: Date.now(),
    };
    const saved = await this.orderRepository.save(order);
    this.datasourceInvalidation.emitOrderLifecycle(order.vehicleCode);
    return saved;
  }

  async updateOrderStatus(id: string, statusStr: string): Promise<OperationOrder> {
    const order = await this.getOrderById(id);
    const targetStatus = statusStr.toUpperCase() as OrderStatus;

    if (!Object.values(OrderStatus).includes(targetStatus)) {
      throw new BadRequestException(
        `Invalid status: '${statusStr}'. Allowed: ${Object.values(OrderStatus).join(', ')}`,
      );
    }

    const allowedNextStatuses = VALID_TRANSITIONS[order.status];
    if (!allowedNextStatuses.includes(targetStatus)) {
      throw new BadRequestException(
        `Invalid state transition: '${order.status}' → '${targetStatus}'.`,
      );
    }

    order.status = targetStatus;
    if (targetStatus === OrderStatus.END || targetStatus === OrderStatus.FAULTED) {
      order.completedAt = String(Date.now());
    } else if (targetStatus === OrderStatus.PROCESSING) {
      // bigint 欄位清空須用 null，不可用空字串
      order.completedAt = null;
    }
    const saved = await this.orderRepository.save(order);
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
      throw new NotFoundException(`Action '${actionId}' not found`);
    }

    const status = this.orderRouteService.normalizeActionStatus(body.status);
    if (!status) {
      throw new BadRequestException(`Invalid action status: '${body.status}'`);
    }

    row.actionStatus = status;
    if (body.note != null) row.note = body.note;
    if (body.actual_start_time != null) row.actualStartTime = String(body.actual_start_time);
    if (body.actual_end_time != null) row.actualEndTime = String(body.actual_end_time);
    await this.actionStateRepository.save(row);

    const order = await this.getOrderById(row.orderId);
    const progress = await this.orderRouteService.computeRouteProgress(order.id, order.routeId ?? null);
    order.payload = {
      ...(order.payload ?? {}),
      route_progress: progress,
      active_action_id: actionId,
      updated_at: Date.now(),
    };
    await this.orderRepository.save(order);

    return row;
  }

  /**
   * MQTT operation/update：僅更新已存在訂單的任務進度與輕量 payload。
   * 訂單契約狀態（PENDING/PROCESSING/END）須經 REST API 變更。
   */
  async applyOperationMqttUpdate(
    vehicleCode: string,
    payload: OperationMqttPayload,
  ): Promise<OperationOrder | null> {
    const tripCode = this.nonEmpty(payload.trip_code);
    const orderId = this.nonEmpty(payload.order_id);
    if (!tripCode || !orderId) return null;

    const routeId = this.nonEmpty(payload.route_id)
      ?? this.orderRouteService.routeIdForTripCode(tripCode);
    let lineKind = this.nonEmpty(payload.line_kind)
      ?? (routeId ? 'MAINLINE' : null);
    if (!lineKind && (payload.maint_type_label || payload.yard_slot_id)) {
      lineKind = 'MAINTENANCE';
    }
    if (!lineKind) return null;

    let order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) {
      return null;
    }

    const vehiclePhase = String(payload.vehicle_phase ?? '').toUpperCase();
    const isAwaitingDeparture =
      vehiclePhase === 'AWAITING_DEPARTURE'
      || String(payload.order_status ?? '').toUpperCase() === 'PENDING';

    if (
      order.status === OrderStatus.PENDING
      && lineKind === 'MAINLINE'
      && this.isShiftTripCode(tripCode)
      && isAwaitingDeparture
    ) {
      return this.applyPendingMainlineOperationRefresh(
        order,
        vehicleCode,
        payload,
        routeId,
        tripCode,
      );
    }

    if (
      order.status === OrderStatus.PENDING
      && lineKind === 'MAINLINE'
      && this.isShiftTripCode(tripCode)
      && (vehiclePhase === 'TRANSITING' || vehiclePhase === 'DWELLING' || vehiclePhase === 'DOCKING')
    ) {
      order = await this.updateOrderStatus(orderId, 'processing');
    }

    if (order.status !== OrderStatus.PROCESSING) {
      return order;
    }

    const phase = vehiclePhase;
    if (phase === 'FAULTED') {
      return this.applyFaultToOrder(order, 'VEHICLE_PHASE_FAULTED', payload);
    }

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

    const prevPayload = (order.payload ?? {}) as Record<string, unknown>;
    const legEtaMax: Record<string, number> = {
      ...((prevPayload.leg_eta_max as Record<string, number> | undefined) ?? {}),
    };
    if (legTarget && etaSec != null) {
      legEtaMax[legTarget] = Math.max(legEtaMax[legTarget] ?? 0, etaSec);
    }
    const legEtaMaxFromPayload = typeof currentLeg?.leg_eta_max === 'number'
      ? Math.max(0, Math.round(currentLeg.leg_eta_max))
      : null;
    if (legTarget && legEtaMaxFromPayload != null && legEtaMaxFromPayload > 0) {
      legEtaMax[legTarget] = legEtaMaxFromPayload;
    }
    const maxEta = legTarget ? (legEtaMax[legTarget] ?? etaSec ?? 0) : 0;

    const computedProgress = await this.orderRouteService.computeRouteProgress(
      orderId,
      order.routeId ?? routeId,
    );
    const routeProgress = this.computeRouteProgressFromLeg(
      legTarget,
      etaSec,
      maxEta,
      computedProgress,
    );
    const segmentIndex = legTarget && order.routeId
      ? await this.resolveSegmentIndex(order.routeId ?? routeId, legTarget)
      : routeProgress < 50 ? 0 : 1;
    const segmentRemainPct = maxEta > 0 && etaSec != null
      ? Math.round((etaSec / maxEta) * 100)
      : 0;

    const nextStation = await this.orderRouteService.computeNextStation(
      orderId,
      order.routeId ?? routeId,
    );

    const operationAction = deriveOperationActionFromTaskGroup(payload.task_group);

    order.tripCode = tripCode;
    order.vehicleCode = vehicleCode;
    order.routeId = order.routeId ?? routeId ?? undefined;
    order.lineKind = lineKind;
    order.nextStation = nextStation ?? order.nextStation;
    const times = this.tripTimesFromCode(tripCode, lineKind === 'MAINLINE' ? 6 : 30, payload.timestamp);
    order.plannedStart = String(times.plannedStart);
    order.plannedEnd = String(times.plannedEnd);
    order.etaRemain = etaSec != null
      ? this.formatSecondsMmSs(etaSec)
      : this.formatEtaMmSs(routeProgress, 6);
    order.payload = {
      vehicle_phase: payload.vehicle_phase ?? null,
      current_leg: currentLeg ?? null,
      leg_eta_max: legEtaMax,
      segment_index: segmentIndex,
      segment_remain_pct: segmentRemainPct,
      route_progress: routeProgress,
      operation_action: operationAction,
      updated_at: payload.timestamp ?? Date.now(),
    };

    return this.orderRepository.save(order);
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
      return this.updateOrderStatus(orderId, 'processing');
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
      if (!this.isShiftTripCode(order.tripCode)) continue;
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
        await this.updateOrderStatus(snap.orderId, 'processing');
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

  private isShiftTripCode(raw: unknown): boolean {
    return typeof raw === 'string' && /^[DU]\d{4}$/i.test(raw.trim());
  }

  /** 待發班次：僅刷新 current_leg／ETA，不升級為 PROCESSING */
  private async applyPendingMainlineOperationRefresh(
    order: OperationOrder,
    vehicleCode: string,
    payload: OperationMqttPayload,
    routeId: string | null,
    tripCode: string,
  ): Promise<OperationOrder> {
    const currentLeg = typeof payload.current_leg === 'object' ? payload.current_leg : null;
    const legTarget = this.nonEmpty(currentLeg?.target_station_id);
    const etaSec = typeof currentLeg?.eta_seconds === 'number'
      ? Math.max(0, Math.round(currentLeg.eta_seconds))
      : null;
    const legEtaMaxFromPayload = typeof currentLeg?.leg_eta_max === 'number'
      ? Math.max(0, Math.round(currentLeg.leg_eta_max))
      : null;

    const prevPayload = (order.payload ?? {}) as Record<string, unknown>;
    const legEtaMax: Record<string, number> = {
      ...((prevPayload.leg_eta_max as Record<string, number> | undefined) ?? {}),
    };
    if (legTarget && legEtaMaxFromPayload != null && legEtaMaxFromPayload > 0) {
      legEtaMax[legTarget] = legEtaMaxFromPayload;
    } else if (legTarget && etaSec != null) {
      legEtaMax[legTarget] = Math.max(legEtaMax[legTarget] ?? 0, etaSec);
    }

    order.tripCode = tripCode;
    order.vehicleCode = vehicleCode;
    order.routeId = order.routeId ?? routeId ?? undefined;
    order.lineKind = 'MAINLINE';
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

  private tripTimesFromCode(
    tripCode: string,
    legMinutes: number,
    timestamp?: unknown,
  ): { plannedStart: number; plannedEnd: number } {
    const base = typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : Date.now();
    const match = tripCode.match(/^[DU](\d{2})(\d{2})$/);
    if (!match) return { plannedStart: base, plannedEnd: base + legMinutes * 60_000 };
    const start = new Date(base);
    start.setHours(parseInt(match[1], 10), parseInt(match[2], 10), 0, 0);
    if (start.getTime() > base + 12 * 60 * 60_000) start.setDate(start.getDate() - 1);
    return { plannedStart: start.getTime(), plannedEnd: start.getTime() + legMinutes * 60_000 };
  }

  private computeRouteProgressFromLeg(
    legTarget: string | null,
    etaSec: number | null,
    maxEta: number,
    fallback: number,
  ): number {
    if (!legTarget || etaSec == null || maxEta <= 0) return fallback;
    const legFraction = Math.max(0, Math.min(1, (maxEta - etaSec) / maxEta));
    if (legTarget === 'T3') {
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
    if (!routeId) return legTarget === 'T3' ? 0 : 1;
    const stations = await this.orderRouteService.getRouteStations(routeId);
    if (stations.length < 2) return 0;
    const mid = stations.find((s) => s.stationId === 'T3') ?? stations[1];
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
