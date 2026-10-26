import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, LessThan, Like, Repository } from 'typeorm';
import {
  OperationOrder,
  OrderStatus,
} from '../database/entities/operation-order.entity';
import { OperationRoute } from '../database/entities/operation-route.entity';
import { OperationRouteStationAction } from '../database/entities/operation-route-station-action.entity';
import { OperationRouteStation } from '../database/entities/operation-route-station.entity';
import { ScheduledOrderEntry } from '../database/entities/scheduled-order-entry.entity';
import { SystemSetting } from '../database/entities/system-setting.entity';
import { Vehicle } from '../database/entities/vehicle.entity';
import type { DailyPlanAdoption, DailyPlanTask } from '../dispatch/daily-plan';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';
import { MapService } from '../map/map.service';
import { OperatingClockService } from '../operating-day/operating-clock.service';
import { SystemFoundationSettingsService } from '../system-health/system-foundation-settings.service';
import { buildRouteLabel, hasPendingVehicleFault } from './order-list.util';
import { OrderService } from './order.service';

export type CalendarCategory =
  | 'running'
  | 'pending'
  | 'fault'
  | 'completed'
  | 'cancelled';

export function orderCalendarCategory(
  order: Pick<OperationOrder, 'status' | 'payload'>,
): CalendarCategory {
  const payload = (order.payload ?? {}) as Record<string, unknown>;
  if (order.status === OrderStatus.END) return 'completed';
  if (payload.cancel_requested_at) return 'cancelled';
  if (order.status === OrderStatus.FAULTED || hasPendingVehicleFault(order))
    return 'fault';
  if (order.status === OrderStatus.PROCESSING) return 'running';
  return 'pending';
}

type RouteSnapshot = {
  route_name: string;
  line_kind: string;
  stations: Array<{
    order: number;
    station_id: string;
    station_name: string;
    actions: string[];
  }>;
};

@Injectable()
export class ScheduledOrderService {
  constructor(
    @InjectRepository(ScheduledOrderEntry)
    private readonly schedules: Repository<ScheduledOrderEntry>,
    @InjectRepository(OperationOrder)
    private readonly orders: Repository<OperationOrder>,
    @InjectRepository(OperationRoute)
    private readonly routes: Repository<OperationRoute>,
    @InjectRepository(OperationRouteStation)
    private readonly stations: Repository<OperationRouteStation>,
    @InjectRepository(OperationRouteStationAction)
    private readonly actions: Repository<OperationRouteStationAction>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(SystemSetting)
    private readonly systemSettings: Repository<SystemSetting>,
    private readonly orderService: OrderService,
    private readonly mapService: MapService,
    private readonly settings: SystemFoundationSettingsService,
    private readonly invalidation: DatasourceInvalidationService,
    private readonly operatingClock: OperatingClockService,
  ) {}

  private async timeZone() {
    return (await this.settings.get()).locale.timeZone || 'Asia/Taipei';
  }

  async options() {
    const activeMapId =
      this.mapService.getActiveMapLibraryStatus().activeMapId || null;
    const [vehicles, routes] = await Promise.all([
      this.vehicles.find({
        where: { isActive: true, serviceEnabled: true },
        order: { vehicleCode: 'ASC' },
      }),
      this.routes.find({ order: { routeName: 'ASC', id: 'ASC' } }),
    ]);
    const routeIds = routes.map((route) => route.id);
    const [stations, actions] = routeIds.length
      ? await Promise.all([
          this.stations.find({
            where: { routeId: In(routeIds) },
            order: { sequenceOrder: 'ASC' },
          }),
          this.actions.find({
            where: { routeId: In(routeIds) },
            order: { sequenceOrder: 'ASC' },
          }),
        ])
      : [[], []];
    return {
      time_zone: await this.timeZone(),
      map_id: activeMapId,
      vehicles: vehicles.map((vehicle) => ({
        vehicle_code: vehicle.vehicleCode,
        display_name: vehicle.displayName || vehicle.vehicleCode,
      })),
      routes: routes.map((route) => {
        const routeStations = stations.filter(
          (station) => station.routeId === route.id,
        );
        return {
          route_id: route.id,
          route_name: route.routeName,
          line_kind: route.lineKind,
          group_name:
            route.lineKind === 'MAINTENANCE' ? '整備路線' : '營運路線',
          available: Boolean(activeMapId) && routeStations.length >= 2,
          unavailable_reason: !activeMapId
            ? '尚未啟用地圖，無法確定路線地圖關聯'
            : routeStations.length >= 2
              ? null
              : '站序不完整，至少需要兩站',
          estimated_minutes: null,
          stations: routeStations.map((station) => ({
            order: station.sequenceOrder,
            station_id: station.stationId,
            station_name: station.stationDisplayName || station.stationId,
            actions: actions
              .filter((action) => action.stationRowId === station.id)
              .map((action) => action.actionType),
          })),
        };
      }),
    };
  }

  private hash(input: Record<string, unknown>) {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  async create(
    input: {
      request_key?: string;
      display_name?: string;
      vehicle_code?: string;
      route_id?: string;
      planned_start?: number;
    },
    actorId: string,
  ) {
    const requestKey = String(input.request_key ?? '').trim();
    const displayName = String(input.display_name ?? '').trim();
    const vehicleCode = String(input.vehicle_code ?? '').trim();
    const routeId = String(input.route_id ?? '').trim();
    const plannedStart = Number(input.planned_start);
    if (!requestKey || requestKey.length > 100)
      throw new BadRequestException('request_key 必填且不得超過 100 字元');
    if (!displayName || displayName.length > 120)
      throw new BadRequestException('訂單名稱必填且不得超過 120 字元');
    if (!vehicleCode || !routeId)
      throw new BadRequestException('指派載具與路線皆為必填');
    if (!Number.isSafeInteger(plannedStart) || plannedStart <= Date.now())
      throw new BadRequestException('計畫開始時間必須晚於目前時間');

    const requestHash = this.hash({
      displayName,
      vehicleCode,
      routeId,
      plannedStart,
    });
    const previous = await this.schedules.findOne({ where: { requestKey } });
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new ConflictException('同一 request_key 已用於不同排程內容');
      return this.projectSchedule(previous);
    }

    const [vehicle, route, routeStations, routeActions] = await Promise.all([
      this.vehicles.findOne({
        where: { vehicleCode, isActive: true, serviceEnabled: true },
      }),
      this.routes.findOne({ where: { id: routeId } }),
      this.stations.find({
        where: { routeId },
        order: { sequenceOrder: 'ASC' },
      }),
      this.actions.find({
        where: { routeId },
        order: { sequenceOrder: 'ASC' },
      }),
    ]);
    if (!vehicle)
      throw new BadRequestException('載具不存在、未啟用或不可接新任務');
    if (!route) throw new BadRequestException('路線不存在或已失效');
    if (routeStations.length < 2)
      throw new BadRequestException('路線站序不完整，至少需要兩站');
    const activeMapId =
      this.mapService.getActiveMapLibraryStatus().activeMapId || null;
    if (!activeMapId)
      throw new BadRequestException('尚未啟用地圖，無法建立路線排程');

    const sameSlot = await this.schedules.findOne({
      where: {
        vehicleCode,
        plannedStart: String(plannedStart),
        state: In(['PENDING', 'PUBLISHED']),
      },
    });
    if (sameSlot)
      throw new ConflictException('此載具在相同計畫開始時間已有排程');

    const snapshot: RouteSnapshot = {
      route_name: route.routeName,
      line_kind: route.lineKind || 'MAINLINE',
      stations: routeStations.map((station) => ({
        order: station.sequenceOrder,
        station_id: station.stationId,
        station_name: station.stationDisplayName || station.stationId,
        actions: routeActions
          .filter((action) => action.stationRowId === station.id)
          .map((action) => action.actionType),
      })),
    };
    const row = this.schedules.create({
      requestKey,
      requestHash,
      displayName,
      vehicleCode,
      routeId,
      mapId: activeMapId,
      plannedStart: String(plannedStart),
      plannedEnd: null,
      routeSnapshot: snapshot,
      state: 'PENDING',
      operationOrderId: null,
      createdBy: actorId,
      createdAt: String(Date.now()),
      cancelledAt: null,
      publishedAt: null,
      lastAttemptAt: null,
      lastError: null,
    });
    try {
      const saved = await this.schedules.save(row);
      this.invalidation.emit(
        ['table:scheduled_order_entries'],
        'scheduled_order_created',
      );
      return this.projectSchedule(saved);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        const duplicate = await this.schedules.findOne({
          where: { requestKey },
        });
        if (duplicate?.requestHash === requestHash)
          return this.projectSchedule(duplicate);
        throw new ConflictException('排程識別或載具時段發生衝突');
      }
      throw error;
    }
  }

  async calendar(
    from: number,
    to: number,
    vehicleCode?: string,
    limitPerGroup = 20,
  ) {
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from >= to ||
      to - from > 8 * 86_400_000
    ) {
      throw new BadRequestException(
        'from/to 必須是有效 Epoch 毫秒，且查詢範圍不得超過八日',
      );
    }
    if (
      !Number.isSafeInteger(limitPerGroup) ||
      limitPerGroup < 1 ||
      limitPerGroup > 200
    )
      throw new BadRequestException('limit_per_group 必須介於 1 至 200');
    const orderWhere = vehicleCode
      ? { vehicleCode, plannedStart: Between(String(from), String(to - 1)) }
      : { plannedStart: Between(String(from), String(to - 1)) };
    const scheduleWhere = vehicleCode
      ? { vehicleCode, plannedStart: Between(String(from), String(to - 1)) }
      : { plannedStart: Between(String(from), String(to - 1)) };
    const [orders, schedules, planSettings, timeZone, unscheduledCount] =
      await Promise.all([
        this.orders.find({
          where: orderWhere,
          order: { plannedStart: 'ASC', id: 'ASC' },
        }),
        this.schedules.find({
          where: scheduleWhere,
          order: { plannedStart: 'ASC', id: 'ASC' },
        }),
        this.systemSettings.find({
          where: { settingKey: Like('operation.daily_plan.%') },
        }),
        this.timeZone(),
        this.orders.count({
          where: vehicleCode
            ? { vehicleCode, plannedStart: IsNull() }
            : { plannedStart: IsNull() },
        }),
      ]);
    const scheduleByOrderId = new Map(
      schedules
        .filter((item) => item.operationOrderId)
        .map((item) => [item.operationOrderId!, item]),
    );
    const templateSnapshots = await this.loadRouteSnapshots(
      orders
        .filter((order) => !scheduleByOrderId.has(order.id))
        .map((order) => order.routeId)
        .filter((id): id is string => Boolean(id)),
    );
    const adoptedPlans = planSettings
      .map((row) => row.settingValue as DailyPlanAdoption)
      .filter(
        (plan) =>
          plan &&
          typeof plan.plan_digest === 'string' &&
          Array.isArray(plan.tasks),
      );
    const plannedItems = adoptedPlans.flatMap((plan) =>
      plan.tasks
        .filter(
          (task) =>
            task.start != null &&
            task.start >= from &&
            task.start < to &&
            (!vehicleCode || task.vehicle_code === vehicleCode) &&
            !orders.some((order) =>
              this.orderBelongsToPlanTask(order, plan, task),
            ),
        )
        .map((task) => this.projectPlanTask(plan, task)),
    );
    const items = [
      ...orders.map((order) =>
        this.projectOrder(
          order,
          scheduleByOrderId.get(order.id),
          order.routeId ? templateSnapshots.get(order.routeId) : undefined,
        ),
      ),
      ...schedules
        .filter(
          (item) =>
            !item.operationOrderId ||
            !orders.some((order) => order.id === item.operationOrderId),
        )
        .map((item) => this.projectSchedule(item)),
      ...plannedItems,
    ].sort(
      (a, b) =>
        a.planned_start - b.planned_start ||
        a.source_id.localeCompare(b.source_id),
    );
    const dayKey = (value: number) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(value));
    const days: Record<
      string,
      { counts: Record<CalendarCategory, number>; items: typeof items }
    > = {};
    for (const item of items) {
      const key = dayKey(item.planned_start);
      days[key] ??= {
        counts: {
          running: 0,
          pending: 0,
          fault: 0,
          completed: 0,
          cancelled: 0,
        },
        items: [],
      };
      days[key].counts[item.category] += 1;
      days[key].items.push(item);
    }
    const boundedDays = Object.fromEntries(
      Object.entries(days).map(([key, day]) => [
        key,
        {
          counts: day.counts,
          items: (
            [
              'running',
              'pending',
              'fault',
              'completed',
              'cancelled',
            ] as CalendarCategory[]
          ).flatMap((category) =>
            day.items
              .filter((item) => item.category === category)
              .slice(0, limitPerGroup),
          ),
        },
      ]),
    );
    return {
      time_zone: timeZone,
      from,
      to,
      limit_per_group: limitPerGroup,
      unscheduled_count: unscheduledCount,
      days: boundedDays,
      total: items.length,
    };
  }

  async detail(source: string, id: string) {
    if (source === 'plan') {
      const rows = await this.systemSettings.find({
        where: { settingKey: Like('operation.daily_plan.%') },
      });
      for (const row of rows) {
        const plan = row.settingValue as DailyPlanAdoption;
        const task = Array.isArray(plan?.tasks)
          ? plan.tasks.find(
              (candidate) => this.planSourceId(plan, candidate) === id,
            )
          : undefined;
        if (task) return this.projectPlanTask(plan, task);
      }
      throw new NotFoundException('找不到班表計畫');
    }
    if (source === 'schedule') {
      const schedule = await this.schedules.findOne({ where: { id } });
      if (!schedule) throw new NotFoundException('找不到排程');
      if (schedule.operationOrderId) {
        const order = await this.orders.findOne({
          where: { id: schedule.operationOrderId },
        });
        if (order) return this.projectOrder(order, schedule);
      }
      return this.projectSchedule(schedule);
    }
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('找不到訂單');
    const schedule = await this.schedules.findOne({
      where: { operationOrderId: id },
    });
    const routeSnapshots =
      !schedule && order.routeId
        ? await this.loadRouteSnapshots([order.routeId])
        : new Map<string, RouteSnapshot>();
    return this.projectOrder(
      order,
      schedule ?? undefined,
      order.routeId ? routeSnapshots.get(order.routeId) : undefined,
    );
  }

  async recordOptions() {
    const codes = await this.orders
      .createQueryBuilder('o')
      .select('DISTINCT o.vehicle_code', 'vehicle_code')
      .where("COALESCE(o.vehicle_code, '') <> ''")
      .orderBy('o.vehicle_code', 'ASC')
      .getRawMany<{ vehicle_code: string }>();
    const vehicles = codes.length
      ? await this.vehicles.find({ where: { vehicleCode: In(codes.map((row) => row.vehicle_code)) } })
      : [];
    const byCode = new Map(vehicles.map((vehicle) => [vehicle.vehicleCode, vehicle]));
    return {
      time_zone: await this.timeZone(),
      page_size: 20,
      vehicles: codes.map(({ vehicle_code }) => ({
        vehicle_code,
        display_name: byCode.get(vehicle_code)?.displayName || vehicle_code,
        active: byCode.get(vehicle_code)?.isActive ?? false,
      })),
      categories: [
        { value: 'pending', label: '待執行' },
        { value: 'running', label: '執行中' },
        { value: 'fault', label: '異常' },
        { value: 'completed', label: '結束' },
        { value: 'cancelled', label: '取消' },
      ],
    };
  }

  async records(query: {
    keyword?: string;
    from?: number;
    to?: number;
    vehicleCode?: string;
    category?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    direction?: string;
    snapshot?: number;
  }) {
    const from = Number(query.from);
    const to = Number(query.to);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from >= to || to - from > 366 * 86_400_000)
      throw new BadRequestException('from/to 必須是有效時間區間，且不得超過 366 日');
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(query.pageSize) || 20)));
    const keyword = String(query.keyword ?? '').trim().slice(0, 100).toLowerCase();
    const snapshot = Number.isSafeInteger(Number(query.snapshot)) ? Number(query.snapshot) : Date.now();
    const category = String(query.category ?? '').trim();
    const qb = this.orders
      .createQueryBuilder('o')
      .where('o.planned_start >= :from AND o.planned_start < :to AND o.created_at <= :snapshot', { from: String(from), to: String(to), snapshot: String(snapshot) });
    if (query.vehicleCode) qb.andWhere('o.vehicle_code = :vehicleCode', { vehicleCode: String(query.vehicleCode).slice(0, 64) });
    if (keyword) {
      qb.andWhere(`(
        LOWER(o.order_id) LIKE :keyword OR LOWER(o.trip_code) LIKE :keyword OR
        LOWER(o.vehicle_code) LIKE :keyword OR LOWER(COALESCE(o.payload->>'order_name', '')) LIKE :keyword OR
        LOWER(COALESCE(o.payload->>'route_name', '')) LIKE :keyword
      )`, { keyword: `%${keyword}%` });
    }
    const cancelled = `(o.status <> 'END' AND COALESCE(o.payload->>'cancel_requested_at', '') <> '')`;
    const pendingFault = `(o.status IN ('PENDING', 'PROCESSING') AND (COALESCE(o.payload->'vehicle_fault', 'null'::jsonb) <> 'null'::jsonb OR UPPER(COALESCE(o.payload->>'vehicle_phase', '')) = 'FAULTED'))`;
    if (category === 'completed') qb.andWhere("o.status = 'END'");
    else if (category === 'cancelled') qb.andWhere(cancelled);
    else if (category === 'fault') qb.andWhere(`o.status <> 'END' AND NOT ${cancelled} AND (o.status = 'FAULTED' OR ${pendingFault})`);
    else if (category === 'running') qb.andWhere(`o.status = 'PROCESSING' AND NOT ${cancelled} AND NOT ${pendingFault}`);
    else if (category === 'pending') qb.andWhere(`o.status = 'PENDING' AND NOT ${cancelled} AND NOT ${pendingFault}`);
    else if (category) throw new BadRequestException('category 不合法');

    const sortColumns: Record<string, string> = {
      order_id: 'o.order_id',
      vehicle_code: 'o.vehicle_code',
      planned_start: 'o.planned_start',
      planned_end: 'o.planned_end',
    };
    const sortBy = sortColumns[String(query.sortBy ?? '')] ? String(query.sortBy) : 'planned_start';
    const direction = String(query.direction).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(sortColumns[sortBy], direction, 'NULLS LAST').addOrderBy('o.order_id', direction).skip((page - 1) * pageSize).take(pageSize);
    const [orders, total] = await qb.getManyAndCount();
    const schedules = orders.length
      ? await this.schedules.find({ where: { operationOrderId: In(orders.map((order) => order.id)) } })
      : [];
    const byOrder = new Map(schedules.filter((row) => row.operationOrderId).map((row) => [row.operationOrderId!, row]));
    const routeSnapshots = await this.loadRouteSnapshots(
      orders.filter((order) => !byOrder.has(order.id)).map((order) => order.routeId).filter((id): id is string => Boolean(id)),
    );
    return {
      items: orders.map((order) => this.projectOrder(order, byOrder.get(order.id), order.routeId ? routeSnapshots.get(order.routeId) : undefined)),
      total,
      page,
      page_size: pageSize,
      sort_by: sortBy,
      direction: direction.toLowerCase(),
      time_zone: await this.timeZone(),
      snapshot,
    };
  }

  private planSourceId(plan: DailyPlanAdoption, task: DailyPlanTask) {
    return `${plan.operating_day}:${plan.plan_digest}:${task.id}`;
  }

  private orderBelongsToPlanTask(
    order: OperationOrder,
    plan: DailyPlanAdoption,
    task: DailyPlanTask,
  ) {
    const payload = (order.payload ?? {}) as Record<string, unknown>;
    return (
      payload.operating_day === plan.operating_day &&
      payload.plan_digest === plan.plan_digest &&
      (payload.plan_block_id === task.id ||
        payload.plan_trip_code === task.code)
    );
  }

  private projectPlanTask(plan: DailyPlanAdoption, task: DailyPlanTask) {
    return {
      source: 'plan' as const,
      source_id: this.planSourceId(plan, task),
      schedule_id: null,
      order_id: null,
      display_name: `${plan.shift_name} · ${task.code}`,
      vehicle_code: task.vehicle_code || '未指派',
      route_id: null,
      route_name: task.task_type || plan.shift_name,
      category: 'pending' as const,
      status: 'PLANNED',
      status_hint: '班表計畫，尚未下發',
      planned_start: task.start!,
      planned_end: task.end,
      actual_start: null,
      actual_end: null,
      reason: null,
      stations: [],
    };
  }

  private async loadRouteSnapshots(routeIds: string[]) {
    const uniqueIds = [...new Set(routeIds)];
    if (!uniqueIds.length) return new Map<string, RouteSnapshot>();
    const [routes, stations, actions] = await Promise.all([
      this.routes.find({ where: { id: In(uniqueIds) } }),
      this.stations.find({
        where: { routeId: In(uniqueIds) },
        order: { sequenceOrder: 'ASC' },
      }),
      this.actions.find({
        where: { routeId: In(uniqueIds) },
        order: { sequenceOrder: 'ASC' },
      }),
    ]);
    return new Map(
      routes.map((route) => [
        route.id,
        {
          route_name: route.routeName,
          line_kind: route.lineKind || 'MAINLINE',
          stations: stations
            .filter((station) => station.routeId === route.id)
            .map((station) => ({
              order: station.sequenceOrder,
              station_id: station.stationId,
              station_name: station.stationDisplayName || station.stationId,
              actions: actions
                .filter((action) => action.stationRowId === station.id)
                .map((action) => action.actionType),
            })),
        },
      ]),
    );
  }

  private projectSchedule(schedule: ScheduledOrderEntry) {
    const stateCategory: CalendarCategory =
      schedule.state === 'CANCELLED'
        ? 'cancelled'
        : schedule.state === 'EXPIRED' || schedule.state === 'FAILED'
          ? 'fault'
          : 'pending';
    const snapshot = schedule.routeSnapshot as unknown as RouteSnapshot;
    return {
      source: 'schedule' as const,
      source_id: schedule.id,
      schedule_id: schedule.id,
      order_id: schedule.operationOrderId,
      display_name: schedule.displayName,
      vehicle_code: schedule.vehicleCode,
      route_id: schedule.routeId,
      route_name: snapshot.route_name,
      category: stateCategory,
      status: schedule.state,
      status_hint:
        schedule.state === 'PENDING' ? '尚未下發' : schedule.lastError,
      planned_start: Number(schedule.plannedStart),
      planned_end:
        schedule.plannedEnd == null ? null : Number(schedule.plannedEnd),
      actual_start: null,
      actual_end: null,
      reason: schedule.lastError,
      stations: snapshot.stations,
    };
  }

  private projectOrder(
    order: OperationOrder,
    schedule?: ScheduledOrderEntry,
    templateSnapshot?: RouteSnapshot,
  ) {
    const payload = (order.payload ?? {}) as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    const snapshot = schedule?.routeSnapshot as RouteSnapshot | undefined;
    const payloadStations = Array.isArray(payload.stations)
      ? (payload.stations as Array<Record<string, unknown>>)
      : [];
    const progress = (payload.vehicle_progress_at ?? {}) as Record<
      string,
      unknown
    >;
    return {
      source: 'order' as const,
      source_id: order.id,
      schedule_id: schedule?.id ?? null,
      order_id: order.id,
      display_name:
        schedule?.displayName ||
        text(payload.order_name) ||
        order.tripCode ||
        order.id,
      vehicle_code: order.vehicleCode,
      route_id: order.routeId ?? null,
      route_name:
        snapshot?.route_name ||
        templateSnapshot?.route_name ||
        buildRouteLabel(order),
      category: orderCalendarCategory(order),
      status: order.status,
      status_hint: payload.cancel_requested_at
        ? '取消請求中／待車端確認'
        : hasPendingVehicleFault(order)
          ? '結案待確認'
          : null,
      planned_start: Number(order.plannedStart),
      planned_end: order.plannedEnd == null ? null : Number(order.plannedEnd),
      // actual_started_at / completedAt 是中心收到車端 REST 狀態更新的真實時間；
      // vehicle_progress_at 僅保留為舊資料的車端回報證據 fallback，不冒充車端裝置時鐘。
      actual_start:
        Number(payload.actual_started_at ?? progress.PROCESSING) || null,
      actual_end: Number(order.completedAt ?? progress.END) || null,
      reason: payload.fault_reason || payload.closed_reason || null,
      stations:
        snapshot?.stations ??
        (payloadStations.length
          ? payloadStations.map((station, index) => ({
              order: Number(station.order) || index + 1,
              station_id: text(station.station_id),
              station_name:
                text(station.station_name) || text(station.station_id),
              actions: [],
            }))
          : (templateSnapshot?.stations ?? [])),
    };
  }

  /** 在既有 dispatch advisory lock 內呼叫；沒有班表時也能發布人工計畫。 */
  async publishDue(now: number, leadSeconds: number, catchUpSeconds: number) {
    // 人工實機排程只依後端真實時間發布；模擬／暫停／重播不能把歷史營運時間送給真車。
    if (this.operatingClock.snapshot(now).mode !== 'realtime')
      return { checked: 0, published: [] as string[] };
    const retryBackoffMs = 30_000;
    const dueTo = now + leadSeconds * 1000;
    const expiredBefore = now - catchUpSeconds * 1000;
    await this.schedules.update(
      { state: 'PENDING', plannedStart: LessThan(expiredBefore.toString()) },
      {
        state: 'EXPIRED',
        lastAttemptAt: String(now),
        lastError: '已超過補發窗口，未下發',
      },
    );
    const due = await this.schedules.find({
      where: {
        state: 'PENDING',
        plannedStart: Between(String(expiredBefore), String(dueTo)),
      },
      order: { plannedStart: 'ASC', id: 'ASC' },
      take: 100,
    });
    const published: string[] = [];
    for (const schedule of due) {
      if (
        schedule.lastAttemptAt != null &&
        now - Number(schedule.lastAttemptAt) < retryBackoffMs
      )
        continue;
      const operationOrderId =
        schedule.operationOrderId || `MANUAL-${schedule.id}`;
      const existing = await this.orders.findOne({
        where: { id: operationOrderId },
      });
      if (!existing) {
        const snapshot = schedule.routeSnapshot as unknown as RouteSnapshot;
        try {
          await this.orderService.createOrder({
            order_id: operationOrderId,
            vehicle_code: schedule.vehicleCode,
            trip_code: `MANUAL-${schedule.id.slice(0, 8)}`,
            route_id: schedule.routeId,
            line_kind: snapshot.line_kind,
            planned_start: Number(schedule.plannedStart),
            planned_end:
              schedule.plannedEnd == null
                ? undefined
                : Number(schedule.plannedEnd),
            payload: {
              source: 'manual_schedule',
              scheduled_order_id: schedule.id,
              order_name: schedule.displayName,
              plan_map_id: schedule.mapId,
              route_name: snapshot.route_name,
              stations: snapshot.stations.map((station) => ({
                order: station.order,
                station_id: station.station_id,
                station_name: station.station_name,
              })),
              origin: snapshot.stations[0]
                ? {
                    id: snapshot.stations[0].station_id,
                    name: snapshot.stations[0].station_name,
                    kind: 'station',
                  }
                : null,
              destination: snapshot.stations.at(-1)
                ? {
                    id: snapshot.stations.at(-1)!.station_id,
                    name: snapshot.stations.at(-1)!.station_name,
                    kind: 'station',
                  }
                : null,
            },
          });
        } catch (error) {
          schedule.lastAttemptAt = String(now);
          schedule.lastError =
            error instanceof Error ? error.message : String(error);
          // 保留待發，讓下一個既有調度 tick 可以安全重試；超過補發窗口才標示 EXPIRED。
          schedule.state = 'PENDING';
          await this.schedules.save(schedule);
          continue;
        }
      }
      schedule.operationOrderId = operationOrderId;
      schedule.state = 'PUBLISHED';
      schedule.publishedAt = String(now);
      schedule.lastAttemptAt = String(now);
      schedule.lastError = null;
      await this.schedules.save(schedule);
      published.push(schedule.id);
    }
    if (published.length)
      this.invalidation.emit(
        ['table:scheduled_order_entries', 'table:operation_orders'],
        'scheduled_order_published',
      );
    return { checked: due.length, published };
  }
}
