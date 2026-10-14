import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { DataSource } from 'typeorm';
import { Vehicle } from '../database/entities/vehicle.entity';
import { RedisService } from '../redis/redis.service';
import { nextAvailableVehicleCode } from '../common/vehicle-codes';
import { VehicleRealtimeQueryDto } from './dto/vehicle-realtime-query.dto';
import { CreateVehicleDto, UpdateVehicleDto, UpdateVehicleServiceDto, VehicleRegistrationQueryDto } from './dto/vehicle-registration.dto';

@Injectable()
export class VehicleService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly vehicles: Repository<Vehicle>,
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async listActive(): Promise<Vehicle[]> {
    return this.vehicles.find({
      where: { isActive: true, vehicleCode: Like('PMS%') },
      order: { vehicleCode: 'ASC' },
    });
  }

  async getRegistrationList(query: VehicleRegistrationQueryDto) {
    const sortColumns = {
      name: `COALESCE(NULLIF(v.display_name, ''), v.vehicle_code)`,
      mileage: 'v.initial_mileage_km',
      connection: 'm.health_fresh_received_at',
      service: 'v.service_enabled',
      createdAt: 'v.created_at',
    } as const;
    const sort = sortColumns[query.sortBy] ?? sortColumns.createdAt;
    const direction = query.sortDirection === 'asc' ? 'ASC' : 'DESC';
    const keyword = query.keyword ? `%${query.keyword}%` : null;
    const offset = (query.page - 1) * query.pageSize;
    const [countRows, rows] = await Promise.all([
      this.dataSource.query(
        `SELECT count(*)::int AS total FROM vehicles v
         WHERE v.is_active = true AND v.vehicle_code LIKE 'PMS%'
           AND ($1::text IS NULL OR v.vehicle_code ILIKE $1 OR COALESCE(v.display_name, '') ILIKE $1)`,
        [keyword],
      ),
      this.dataSource.query(
        `SELECT v.id, v.vehicle_code, COALESCE(NULLIF(v.display_name, ''), v.vehicle_code) AS display_name,
                v.initial_mileage_km, v.service_enabled, v.created_at, v.updated_at, v.row_version,
                m.telemetry_data_at, m.operation_data_at, m.health_data_at, m.health_fresh_received_at
         FROM vehicles v
         LEFT JOIN vehicle_monitor_demo m ON m.vehicle_code = v.vehicle_code
         WHERE v.is_active = true AND v.vehicle_code LIKE 'PMS%'
           AND ($1::text IS NULL OR v.vehicle_code ILIKE $1 OR COALESCE(v.display_name, '') ILIKE $1)
         ORDER BY ${sort} ${direction} NULLS LAST, v.vehicle_code ASC
         LIMIT $2 OFFSET $3`,
        [keyword, query.pageSize, offset],
      ),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    const now = Date.now();
    return {
      items: rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        displayName: row.display_name,
        initialMileageKm: Number(row.initial_mileage_km),
        connectionStatus: this.connectionStatus(row, now),
        serviceEnabled: row.service_enabled,
        createdAt: Number(row.created_at),
        updatedAt: row.updated_at == null ? null : Number(row.updated_at),
        version: Number(row.row_version),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async createRegistration(input: CreateVehicleDto) {
    const displayName = this.validName(input.displayName);
    const vehicle = await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('syncdrive_vehicle_code_allocator'))`);
      const usedRows = await manager.query(`SELECT vehicle_code FROM vehicles WHERE vehicle_code ~ '^PMS[0-9]{2}$'`);
      const vehicleCode = nextAvailableVehicleCode(
        usedRows.map((row: { vehicle_code: string }) => row.vehicle_code),
      );
      if (!vehicleCode) throw new ConflictException('PMS 兩碼通訊身分已用盡，無法建立載具');
      const now = Date.now();
      return manager.getRepository(Vehicle).save(manager.getRepository(Vehicle).create({
        vehicleCode,
        displayName,
        isActive: true,
        initialMileageKm: Number(input.initialMileageKm).toFixed(3),
        serviceEnabled: true,
        rowVersion: 1,
        createdAt: String(now),
        updatedAt: String(now),
      }));
    });
    return this.registrationDetail(vehicle);
  }

  async getRegistration(id: string) {
    const vehicle = await this.vehicles.findOne({ where: { id, isActive: true } });
    if (!vehicle) throw new NotFoundException('找不到載具');
    return this.registrationDetail(vehicle);
  }

  async updateRegistration(id: string, input: UpdateVehicleDto) {
    const displayName = this.validName(input.displayName);
    const now = Date.now();
    const result = await this.vehicles.createQueryBuilder().update(Vehicle).set({
      displayName,
      initialMileageKm: Number(input.initialMileageKm).toFixed(3),
      rowVersion: () => 'row_version + 1',
      updatedAt: String(now),
    }).where('id = :id AND is_active = true AND row_version = :version', { id, version: input.expectedVersion }).execute();
    if (!result.affected) await this.throwMissingOrConflict(id);
    return this.getRegistration(id);
  }

  async updateServiceSetting(id: string, input: UpdateVehicleServiceDto) {
    const result = await this.vehicles.createQueryBuilder().update(Vehicle).set({
      serviceEnabled: input.serviceEnabled,
      rowVersion: () => 'row_version + 1',
      updatedAt: String(Date.now()),
    }).where('id = :id AND is_active = true AND row_version = :version', { id, version: input.expectedVersion }).execute();
    if (!result.affected) await this.throwMissingOrConflict(id);
    return this.getRegistration(id);
  }

  private async throwMissingOrConflict(id: string): Promise<never> {
    const exists = await this.vehicles.exist({ where: { id, isActive: true } });
    if (!exists) throw new NotFoundException('找不到載具');
    throw new ConflictException('載具已被其他人修改，請重新開啟後再儲存');
  }

  private validName(value: string) {
    const name = String(value ?? '').trim();
    if (!name) throw new BadRequestException('載具名稱為必填');
    if (name.length > 80) throw new BadRequestException('載具名稱不可超過 80 個字元');
    return name;
  }

  private registrationDetail(vehicle: Vehicle) {
    return {
      id: vehicle.id,
      vehicleCode: vehicle.vehicleCode,
      displayName: vehicle.displayName || vehicle.vehicleCode,
      initialMileageKm: Number(vehicle.initialMileageKm),
      serviceEnabled: vehicle.serviceEnabled,
      createdAt: Number(vehicle.createdAt),
      updatedAt: vehicle.updatedAt == null ? null : Number(vehicle.updatedAt),
      version: vehicle.rowVersion,
      integration: this.integrationInfo(vehicle.vehicleCode),
    };
  }

  private integrationInfo(vehicleCode: string) {
    const brokerHost = this.config.get<string>('MQTT_PUBLIC_HOST', '').trim();
    const configuredApiBase = this.config.get<string>('PUBLIC_API_BASE_URL', '').trim();
    const apiBaseUrl = configuredApiBase || (brokerHost
      ? `http://${brokerHost}:${Number(this.config.get<string>('PUBLIC_API_PORT', '3100'))}/syncdrive-api`
      : '');
    const topic = (suffix: string) => `v1/vtms/${vehicleCode}/${suffix}`;
    return {
      vehicleCode,
      mqtt: { host: brokerHost || null, port: Number(this.config.get<string>('MQTT_PUBLIC_PORT', '8883')), tls: true, mutualTls: true },
      apiBaseUrl: apiBaseUrl || null,
      credentialEndpoint: '/syncdrive-api/auth/token',
      wikiUrl: this.config.get<string>('VEHICLE_INTEGRATION_WIKI_URL', 'document/對外介接/車端介接說明書.md'),
      publishTopics: [topic('telemetry/update'), topic('operation/update'), topic('health/heartbeat'), topic('command/ack'), topic('event/report')],
      subscribeTopics: [topic('operation/assign'), topic('operation/cancel'), topic('command/execute')],
      readiness: brokerHost && apiBaseUrl ? 'READY' : 'CONFIG_REQUIRED',
    };
  }

  private connectionStatus(row: Record<string, unknown>, now: number) {
    const hasData = row.telemetry_data_at != null || row.operation_data_at != null || row.health_data_at != null;
    if (!hasData) return 'NO_DATA';
    const lastHeartbeat = Number(row.health_fresh_received_at);
    return Number.isFinite(lastHeartbeat) && now - lastHeartbeat <= this.redis.offlineAfterMs ? 'ONLINE' : 'OFFLINE';
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
