import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { DataSource } from 'typeorm';
import { Vehicle } from '../database/entities/vehicle.entity';
import { RedisService } from '../redis/redis.service';
import { VehicleRealtimeQueryDto } from './dto/vehicle-realtime-query.dto';

@Injectable()
export class VehicleService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly vehicles: Repository<Vehicle>,
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  async listActive(): Promise<Vehicle[]> {
    return this.vehicles.find({
      where: { isActive: true, vehicleCode: Like('PMS%') },
      order: { vehicleCode: 'ASC' },
    });
  }

  /**
   * 註冊主檔 LEFT JOIN 一車一筆持久化快照。Redis 不在這條初始讀取路徑上，確保
   * 後端重啟、Redis 清空或車端暫停時仍能還原最後有效資料。
   */
  async getRealtimeSnapshot(query: VehicleRealtimeQueryDto) {
    const sortColumns = {
      name: `COALESCE(NULLIF(v.display_name, ''), v.vehicle_code)`,
      speed: `CASE WHEN m.telemetry_payload IS NOT NULL THEN m.demo_speed END`,
      battery: `CASE WHEN m.telemetry_payload IS NOT NULL THEN m.demo_load END`,
      connection: 'm.health_fresh_received_at',
      gear: `CASE WHEN m.telemetry_payload IS NOT NULL THEN m.gear END`,
      updatedAt: `GREATEST(COALESCE(m.telemetry_received_at, 0), COALESCE(m.operation_received_at, 0), COALESCE(m.health_received_at, 0))`,
    } as const;
    const sortColumn = sortColumns[query.sortBy] ?? sortColumns.name;
    const direction = query.sortDirection === 'desc' ? 'DESC' : 'ASC';
    const keyword = query.keyword ? `%${query.keyword}%` : null;
    const offset = (query.page - 1) * query.pageSize;

    const countRows = await this.dataSource.query(
      `SELECT count(*)::int AS total
       FROM vehicles v
       WHERE v.is_active = true AND v.vehicle_code LIKE 'PMS%'
         AND ($1::text IS NULL OR v.vehicle_code ILIKE $1 OR COALESCE(v.display_name, '') ILIKE $1)`,
      [keyword],
    );
    const total = Number(countRows[0]?.total ?? 0);
    const rows = await this.dataSource.query(
      `SELECT
         v.id, v.vehicle_code, COALESCE(NULLIF(v.display_name, ''), v.vehicle_code) AS display_name,
         m.map_id, m.segment_label, m.location_kind, m.location_object_id,
         m.position_x, m.position_y, m.position_z, m.heading_rad,
         m.demo_speed, m.demo_load, m.gear,
         m.telemetry_payload, m.telemetry_derived, m.telemetry_data_at, m.telemetry_received_at,
         m.operation_payload, m.operation_data_at, m.operation_received_at,
         m.health_payload, m.health_data_at, m.health_received_at, m.health_fresh_received_at,
         active_order.order_id AS contract_order_id,
         active_order.trip_code AS contract_trip_code,
         active_order.status AS contract_status
       FROM vehicles v
       LEFT JOIN vehicle_monitor_demo m ON m.vehicle_code = v.vehicle_code
       LEFT JOIN LATERAL (
         SELECT o.order_id, o.trip_code, o.status
         FROM operation_orders o
         WHERE o.vehicle_code = v.vehicle_code AND o.status IN ('PENDING', 'PROCESSING', 'FAULTED')
         ORDER BY o.created_at DESC, o.order_id DESC
         LIMIT 1
       ) active_order ON true
       WHERE v.is_active = true AND v.vehicle_code LIKE 'PMS%'
         AND ($1::text IS NULL OR v.vehicle_code ILIKE $1 OR COALESCE(v.display_name, '') ILIKE $1)
       ORDER BY ${sortColumn} ${direction} NULLS LAST, v.vehicle_code ASC
       LIMIT $2 OFFSET $3`,
      [keyword, query.pageSize, offset],
    );
    const now = Date.now();
    const offlineAfterMs = this.redis.offlineAfterMs;
    const items = rows.map((row: Record<string, any>) => {
      const telemetry = this.record(row.telemetry_payload);
      const hasTelemetry = telemetry != null && row.telemetry_data_at != null;
      const derived = this.record(row.telemetry_derived);
      const localPose = this.record(telemetry?.local_pose);
      const position = this.record(localPose?.position);
      const kinematics = this.record(telemetry?.kinematics);
      const energy = this.record(telemetry?.energy);
      const actuation = this.record(telemetry?.actuation_feedback);
      const x = position ? Number(position.x) : Number(row.position_x);
      const y = position ? Number(position.y) : Number(row.position_y);
      const hasData = hasTelemetry || row.operation_data_at != null || row.health_data_at != null;
      const lastHeartbeat = Number(row.health_fresh_received_at);
      const connectionStatus = !hasData
        ? 'NO_DATA'
        : Number.isFinite(lastHeartbeat) && now - lastHeartbeat <= offlineAfterMs
          ? 'ONLINE'
          : 'OFFLINE';
      return {
        id: row.id,
        vehicleCode: row.vehicle_code,
        displayName: row.display_name,
        connectionStatus,
        mapId: typeof derived?.mapId === 'string' ? derived.mapId : row.map_id ?? null,
        location: !hasTelemetry || !Number.isFinite(x) || !Number.isFinite(y) ? null : {
          x,
          y,
          z: this.numberOrNull(position?.z),
          headingRad: this.numberOrNull(localPose?.heading),
          label: typeof derived?.label === 'string' ? derived.label : null,
          kind: typeof derived?.kind === 'string' ? derived.kind : null,
          objectId: derived?.objectId != null ? String(derived.objectId) : null,
        },
        speedKph: !hasTelemetry ? null : this.numberOrNull(
          kinematics?.velocity == null ? null : Number(kinematics.velocity) * 3.6,
        ),
        batteryLevel: !hasTelemetry ? null : this.numberOrNull(energy?.battery_level),
        gear: hasTelemetry && typeof actuation?.gear === 'string' ? actuation.gear : null,
        telemetry: this.streamSnapshot(row.telemetry_payload, row.telemetry_data_at, row.telemetry_received_at),
        operation: this.streamSnapshot(row.operation_payload, row.operation_data_at, row.operation_received_at),
        health: this.streamSnapshot(row.health_payload, row.health_data_at, row.health_received_at),
        contractOrder: row.contract_order_id ? {
          orderId: row.contract_order_id,
          tripCode: row.contract_trip_code,
          status: row.contract_status,
        } : null,
      };
    });
    return {
      serverTime: now,
      offlineAfterMs,
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  private streamSnapshot(payload: unknown, dataAt: unknown, receivedAt: unknown) {
    if (!payload || dataAt == null || receivedAt == null) return null;
    return { payload, dataAt: Number(dataAt), receivedAt: Number(receivedAt), persisted: true };
  }

  private record(value: unknown): Record<string, any> | null {
    return value != null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : null;
  }

  private numberOrNull(value: unknown): number | null {
    if (value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
}
