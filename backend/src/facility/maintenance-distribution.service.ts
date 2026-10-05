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
  ) {}

  async getDistribution(): Promise<MaintenanceDistribution> {
    return (await this.load()).maintenance;
  }

  /** 車輛分佈：營運中／整備中／待命中（跟整備分佈同一套判斷，規則見 buildVehicleDistribution） */
  async getVehicleDistribution(): Promise<VehicleDistributionRow[]> {
    const { maintenance, fleet, processingOrders } = await this.load();
    return buildVehicleDistribution({ fleetCodes: fleet, processingOrders, maintenance });
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
    // 每台車最新一筆進行中的訂單（正線與整備都要：車輛分佈靠它分營運中／整備中）
    const orders: Array<{
      vehicle_code: string;
      line_kind: string | null;
      kind: string | null;
      task_type: string | null;
      plan_task_type: string | null;
      source: string | null;
      card_label: string | null;
    }> = await this.dataSource.query(`
      SELECT DISTINCT ON (vehicle_code)
        vehicle_code,
        line_kind,
        payload->>'kind' AS kind,
        payload->>'maintenance_task_type' AS task_type,
        payload->>'task_type' AS plan_task_type,
        payload->>'source' AS source,
        payload->>'card_label' AS card_label
      FROM operation_orders
      WHERE status = 'PROCESSING'
      ORDER BY vehicle_code, planned_start DESC
    `);
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
    return { maintenance, fleet, processingOrders };
  }
}
