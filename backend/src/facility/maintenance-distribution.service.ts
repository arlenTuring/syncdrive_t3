import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MaintenanceTaskService } from '../maintenance-task/maintenance-task.service';
import { MapService } from '../map/map.service';
import { OperationShiftService } from '../operation-shift/operation-shift.service';
import {
  buildMaintenanceDistribution,
  buildVehicleDistribution,
  plannedYardTasksNow,
  type MaintenanceDistribution,
  type VehicleDistributionRow,
} from './maintenance-distribution';
import { orderBusinessKind } from '../order/order-business-kind';
import { OperatingClockService } from '../operating-day/operating-clock.service';
import { extractYardMoves } from '../dispatch/dispatch.yard-moves';
import { extractYardTasks } from '../dispatch/dispatch.yard-tasks';
import type { CurrentVehicleTask } from './maintenance-distribution';
import { DispatchEngineService } from '../dispatch/dispatch-engine.service';
import { servicePurposeByBlock } from '../dispatch/dispatch.service-purpose';
import { operatingDayStart } from '../operating-day/operating-day';

type DailyPlanTimeline = Awaited<ReturnType<DispatchEngineService['dailyPlanTimeline']>>;

/**
 * 整備分佈的資料組裝（規則見 maintenance-distribution.ts）。
 *
 * 讀：部署中班表的設定、班表綁定的整備任務、啟用中的地圖設施、車輛即時位置
 * （vehicle_monitor_demo，由 MQTT telemetry 寫入）、進行中的訂單。車輛分佈跟整備分佈
 * 共用同一份讀取與判斷。
 * 車進出格位時 MqttService 會發 domain:maintenance_slots 失效通知，前端據此重查。
 */
@Injectable()
export class MaintenanceDistributionService {
  private readonly logger = new Logger(MaintenanceDistributionService.name);

  constructor(
    private readonly operationShiftService: OperationShiftService,
    private readonly maintenanceTaskService: MaintenanceTaskService,
    private readonly mapService: MapService,
    private readonly dataSource: DataSource,
    private readonly clock: OperatingClockService,
    private readonly engine: DispatchEngineService,
  ) {}

  /**
   * 每日計畫時間線：整份班表內容很大，每次請求都讀會讓整備分佈、營運分佈各拖好幾秒（兩個小工具同時
   * 輪詢時前端逾時）。同一營運日 60 秒內沿用；同時進來的請求共用同一次讀取。讀取失敗不快取。
   */
  private timelineCache: { day: string; at: number; value: Promise<DailyPlanTimeline> } | null = null;

  private dailyPlanTimeline(day: string): Promise<DailyPlanTimeline> {
    const cached = this.timelineCache;
    if (cached && cached.day === day && Date.now() - cached.at < 60_000) return cached.value;
    const value = this.engine.dailyPlanTimeline(day).catch((err: unknown) => {
      this.logger.warn(`讀不到 ${day} 的每日計畫：${(err as Error).message}`);
      if (this.timelineCache?.value === value) this.timelineCache = null;
      return null;
    });
    this.timelineCache = { day, at: Date.now(), value };
    return value;
  }

  /**
   * 沒有有效訂單的車：每日計畫此刻那張卡。月台上等下一班之類的等待不會產生訂單，
   * 照它服務的下一張任務分類；本來該有訂單的卡（載客、場區整備、出入廠）沒有訂單就照實標示。
   */
  private async planBlocksNow(operatingNow: number): Promise<Map<string, { taskType: string; ordersExpected: boolean; purpose: CurrentVehicleTask['servicePurpose'] }>> {
    const result = new Map<string, { taskType: string; ordersExpected: boolean; purpose: CurrentVehicleTask['servicePurpose'] }>();
    const day = this.clock.operatingDay();
    const dayStart = operatingDayStart(day);
    if (dayStart == null) return result;
    const context = await this.dailyPlanTimeline(day);
    if (!context) return result;
    const purposes = servicePurposeByBlock(context.body);
    const nowMinute = (operatingNow - dayStart) / 60_000;
    const timelines = (context.body.scheduleOutput as { plan?: { timelines?: unknown[] } } | undefined)?.plan?.timelines;
    for (const timeline of Array.isArray(timelines) ? timelines : []) {
      const blocks = (timeline as { blocks?: unknown[] }).blocks;
      for (const raw of Array.isArray(blocks) ? blocks : []) {
        const block = raw as Record<string, unknown>;
        const start = Number(block.plannedStartMinute);
        const end = Number(block.plannedEndMinute);
        if (!(start <= nowMinute && nowMinute < end)) continue;
        const row = Number(block.timelineRow);
        const vehicle = Number.isInteger(row) && row >= 1 ? context.fleet[row - 1] : undefined;
        if (!vehicle || result.has(vehicle)) continue;
        const taskType = typeof block.taskType === 'string' ? block.taskType : '';
        const source = typeof block.source === 'string' ? block.source : '';
        const inYard = typeof block.yardFacilityNodeId === 'string' && !block.yardFacilityStationId;
        // 會發訂單的卡：載客、出入廠移動、場區格位上的整備／待命／暫停（見 dispatch.yard-tasks／yard-moves）
        const ordersExpected = taskType === 'passenger'
          || source === 'yard_exit_move' || source === 'yard_entry_move'
          || inYard;
        result.set(vehicle, { taskType, ordersExpected, purpose: purposes.get(String(block.id))?.purpose ?? null });
      }
    }
    return result;
  }

  async getDistribution(): Promise<MaintenanceDistribution> {
    return (await this.load()).maintenance;
  }

  /** 車輛分佈：營運中／整備中／待命中（跟整備分佈同一套判斷，規則見 buildVehicleDistribution） */
  async getVehicleDistribution(): Promise<VehicleDistributionRow[]> {
    const { fleet, currentTasks } = await this.load();
    return buildVehicleDistribution({ fleetCodes: fleet, currentTasks });
  }

  /** 班表時間線補算過渡任務的用途（舊單沒存 service_purpose 時用）；同一份班表 60 秒內沿用 */
  private purposeCache = new Map<string, { at: number; byTrip: Map<string, 'operation' | 'maintenance' | 'standby'> }>();

  private async purposesForShift(shiftId: string): Promise<Map<string, 'operation' | 'maintenance' | 'standby'>> {
    const cached = this.purposeCache.get(shiftId);
    if (cached && Date.now() - cached.at < 60_000) return cached.byTrip;
    const byTrip = new Map<string, 'operation' | 'maintenance' | 'standby'>();
    try {
      const body = (await this.operationShiftService.getShiftTrips(shiftId)).body ?? {};
      for (const move of extractYardMoves(body).moves) {
        if (move.servicePurpose) byTrip.set(move.tripCode, move.servicePurpose.purpose);
      }
      for (const task of extractYardTasks(body).tasks) {
        if (task.servicePurpose) byTrip.set(task.tripCode, task.servicePurpose.purpose);
      }
    } catch (err) {
      this.logger.warn(`讀不到班表 ${shiftId}，過渡任務用途無法補算：${(err as Error).message}`);
    }
    this.purposeCache.set(shiftId, { at: Date.now(), byTrip });
    return byTrip;
  }

  /**
   * 啟用中地圖的設施（代號 ↔ id）。每次都讀檔解析整張地圖（約 300 KB）會卡住事件迴圈，
   * 拖慢 MQTT 轉送；地圖不常換，同一張圖 30 秒內沿用。
   */
  private facilityCache: { mapId: string; at: number; items: Array<{ mapCode: string; equipmentId: string }> } | null = null;

  private activeMapFacilities(): Array<{ mapCode: string; equipmentId: string }> {
    try {
      const mapId = this.mapService.getActiveMapLibraryStatus().activeMapId;
      const now = Date.now();
      if (this.facilityCache?.mapId === mapId && now - this.facilityCache.at < 30_000) {
        return this.facilityCache.items;
      }
      const items = this.mapService.getFieldEquipment(mapId, 'facility').items;
      this.facilityCache = { mapId, at: now, items };
      return items;
    } catch (err) {
      this.logger.warn(`讀不到啟用中的地圖設施：${(err as Error).message}`);
      return [];
    }
  }

  private async load(): Promise<{
    maintenance: MaintenanceDistribution;
    fleet: string[];
    processingOrders: Array<{
      vehicleCode: string;
      lineKind: string | null;
      kind: string | null;
      taskType: string | null;
      cardLabel: string | null;
    }>;
    currentTasks: CurrentVehicleTask[];
  }> {
    const shift = await this.operationShiftService.getDeployedShift();

    let maintenanceBody: Record<string, unknown> | null = null;
    const taskId = typeof shift?.body.maintenanceTaskId === 'string' ? shift.body.maintenanceTaskId.trim() : '';
    if (taskId) {
      try {
        maintenanceBody = (await this.maintenanceTaskService.getTaskDetail(taskId)).body;
      } catch (err) {
        this.logger.warn(`找不到班表綁定的整備任務 ${taskId}：${(err as Error).message}`);
      }
    }

    const facilities = this.activeMapFacilities();

    const vehicleLocations: Array<{ vehicle_code: string; location_object_id: string }> = await this.dataSource.query(`
      SELECT m.vehicle_code, m.location_object_id
      FROM vehicle_monitor_demo m
      JOIN vehicles v ON v.vehicle_code = m.vehicle_code AND v.is_active = true
      WHERE m.location_kind = 'FACILITY' AND m.location_object_id IS NOT NULL
    `);
    /*
     * 每台車此刻有效的那一張任務（營運分佈與整備分佈共用）：
     * - 執行中，而且計畫還沒過期，或車端 10 分鐘內還有回報（晚到仍在跑的班次不能消失）；
     * - 或還沒開始、但計畫時間窗正好涵蓋此刻（該做卻還沒開始的任務）。
     * 已結束、取消、過期的單不算——以前取「最新一筆執行中」，殭屍單會一直留著。
     * 時間用營運時間（重播時照倍速），回報新鮮度用實際時間。
     */
    const operatingNow = this.clock.now();
    const realNow = Date.now();
    const orders: Array<{
      vehicle_code: string;
      order_id: string;
      trip_code: string | null;
      line_kind: string | null;
      kind: string | null;
      task_type: string | null;
      plan_task_type: string | null;
      source: string | null;
      card_label: string | null;
      service_purpose: string | null;
      plan_shift_id: string | null;
    }> = await this.dataSource.query(
      `SELECT DISTINCT ON (vehicle_code)
        vehicle_code,
        order_id,
        COALESCE(payload->>'plan_trip_code', trip_code) AS trip_code,
        line_kind,
        payload->>'kind' AS kind,
        payload->>'maintenance_task_type' AS task_type,
        payload->>'task_type' AS plan_task_type,
        payload->>'source' AS source,
        payload->>'card_label' AS card_label,
        payload->>'service_purpose' AS service_purpose,
        payload->>'plan_shift_id' AS plan_shift_id
      FROM operation_orders
      WHERE NOT (payload ? 'cancel_requested_at')
        AND (
          (status = 'PROCESSING' AND (
            COALESCE(planned_end, planned_start + 600000) >= $1::bigint - 60000
            OR COALESCE((payload->>'updated_at')::bigint, 0) >= $2::bigint - 600000
          ))
          OR (status = 'PENDING' AND planned_start <= $1::bigint
              AND COALESCE(planned_end, planned_start + 600000) >= $1::bigint)
        )
      ORDER BY vehicle_code, CASE status WHEN 'PROCESSING' THEN 0 ELSE 1 END, planned_start DESC`,
      [operatingNow, realNow],
    );
    const fleetRows: Array<{ vehicle_code: string }> = await this.dataSource.query(
      `SELECT vehicle_code FROM vehicles WHERE is_active = true`,
    );
    const fleet = fleetRows.map((row) => row.vehicle_code);
    const processingOrders = orders.map((row) => ({
      vehicleCode: row.vehicle_code,
      // 業務分類全系統同一套（見 order-business-kind.ts）；舊版模擬器的 TEST 單在這裡換算
      lineKind: orderBusinessKind({
        lineKind: row.line_kind,
        payload: { kind: row.kind, task_type: row.plan_task_type, maintenance_task_type: row.task_type, source: row.source },
      }) ?? row.line_kind,
      kind: row.kind,
      taskType: row.task_type,
      cardLabel: row.card_label,
    }));
    const currentTasks: CurrentVehicleTask[] = [];
    for (const [index, row] of orders.entries()) {
      const businessKind = processingOrders[index].lineKind;
      const purposeValue = row.service_purpose;
      const stored: CurrentVehicleTask['servicePurpose'] =
        purposeValue === 'operation' || purposeValue === 'maintenance' || purposeValue === 'standby' ? purposeValue : null;
      let servicePurpose: CurrentVehicleTask['servicePurpose'] = stored;
      let purposeSource: CurrentVehicleTask['purposeSource'] = stored ? 'order' : null;
      if (!stored && (businessKind ?? '').toUpperCase() === 'TRANSITION' && row.plan_shift_id && row.trip_code) {
        servicePurpose = (await this.purposesForShift(row.plan_shift_id)).get(row.trip_code) ?? null;
        purposeSource = servicePurpose ? 'shift' : null;
      }
      currentTasks.push({
        vehicleCode: row.vehicle_code,
        orderId: row.order_id,
        tripCode: row.trip_code,
        businessKind,
        taskType: row.task_type ?? row.plan_task_type,
        servicePurpose,
        purposeSource,
      });
    }
    const withOrder = new Set(currentTasks.map((task) => task.vehicleCode));
    for (const [vehicleCode, block] of await this.planBlocksNow(operatingNow)) {
      if (withOrder.has(vehicleCode)) continue;
      currentTasks.push({
        vehicleCode,
        orderId: '',
        tripCode: null,
        businessKind: null,
        taskType: block.taskType,
        servicePurpose: block.purpose,
        purposeSource: 'shift',
        planBlock: { taskType: block.taskType, ordersExpected: block.ordersExpected },
      });
    }

    const maintenance = buildMaintenanceDistribution({
      shift,
      maintenanceBody,
      facilities,
      vehicleLocations: vehicleLocations.map((row) => ({
        vehicleCode: row.vehicle_code,
        facilityId: String(row.location_object_id),
      })),
      // 整備分佈只看整備訂單；正線訂單的車不在格位裡，本來也對不到
      currentTasks: processingOrders
        .filter((order) => (order.lineKind ?? '').toUpperCase() === 'MAINTENANCE')
        .map((order) => ({ vehicleCode: order.vehicleCode, taskType: order.taskType, cardLabel: order.cardLabel })),
      plannedTasks: shift ? plannedYardTasksNow(shift.body, fleet) : [],
    });
    return { maintenance, fleet, processingOrders, currentTasks };
  }
}
