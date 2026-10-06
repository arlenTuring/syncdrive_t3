import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { VTMS_VEHICLE_CODES } from '../common/vehicle-codes';
import { DispatchEngineService } from '../dispatch/dispatch-engine.service';
import { OperatingClockService } from '../operating-day/operating-clock.service';
import { operatingDayReference } from '../operating-day/operating-day';
import { RedisService } from '../redis/redis.service';
import { vehicleEtaConfig } from '../vehicle/eta/vehicle-eta.config';
import {
  mergeStationEvents,
  type LiveVehicle,
  type PlannedStop,
  type StationEventKind,
  type TripState,
} from './station-eta';

function num(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * 儀表板的站點到站／出發清單（規則見 station-eta.ts）。
 *
 * 登入端用的內部端點：跟對外的車輛即時 ETA（/vehicles/eta，需要 x-api-key）讀同一份車端快照，
 * 但不把任何金鑰放到瀏覽器。時間一律是營運時間；計畫取每日計畫（跟班次中心同一份）。
 */
@Injectable()
export class StationEtaService {
  private planCache: {
    key: string;
    stops: PlannedStop[];
    stopsByTrip: Map<string, string[]>;
    names: Map<string, string>;
  } | null = null;

  constructor(
    private readonly engine: DispatchEngineService,
    private readonly clock: OperatingClockService,
    private readonly redis: RedisService,
    private readonly dataSource: DataSource,
  ) {}

  async byStation(stations: Array<{ stationId: string; events: StationEventKind[] }>, limit: number) {
    const stationIds = stations.map((s) => s.stationId);
    const operatingNow = this.clock.now();
    const day = this.clock.operatingDay();
    const adoption = await this.engine.ensureDailyPlan(day);
    const plan = adoption ? await this.plannedArrivals(day, adoption.shift_id, adoption.plan_digest) : null;

    const live = await this.liveVehicles();
    const tripStates = new Map<string, TripState>();
    if (adoption) {
      const rows: Array<{ trip_code: string; status: string; closed_reason: string | null }> = await this.dataSource.query(
        `SELECT COALESCE(payload->>'plan_trip_code', trip_code) AS trip_code, status::text AS status,
                payload->>'closed_reason' AS closed_reason
         FROM operation_orders
         WHERE payload->>'operating_day' = $1 AND payload->>'plan_shift_id' = $2
         ORDER BY created_at ASC`,
        [day, adoption.shift_id],
      );
      // 同一班重發：以最後一張為準
      for (const row of rows) tripStates.set(row.trip_code, { status: row.status, closedReason: row.closed_reason });
    }

    const groups = mergeStationEvents({
      stations,
      stationNames: plan?.names ?? new Map(),
      planned: (plan?.stops ?? []).filter((a) => stationIds.includes(a.stationId)),
      stopsByTrip: plan?.stopsByTrip ?? new Map(),
      live,
      tripStates,
      operatingNow,
      staleAfterSeconds: vehicleEtaConfig.dataStaleSeconds,
      limit,
    });
    const clock = this.clock.snapshot();
    return {
      operating_day: day,
      operating_now: operatingNow,
      clock: { mode: clock.mode, rate: clock.rate, paused: clock.paused, stale: clock.stale },
      plan: adoption ? { shift_id: adoption.shift_id, shift_name: adoption.shift_name } : null,
      source: '每日計畫站序＋車端即時回報（營運時間）',
      stations: groups,
      events: groups.flatMap((group) => group.events),
    };
  }

  /** 每日計畫展開後各站的計畫到站（營運時刻）；同一版本只算一次 */
  private async plannedArrivals(day: string, shiftId: string, digest: string) {
    const key = `${day}|${shiftId}|${digest}`;
    if (this.planCache?.key === key) return this.planCache;
    const reference = operatingDayReference(day) ?? Date.now();
    const plan = await this.engine.planForShift(shiftId, reference);
    const stops: PlannedStop[] = [];
    const stopsByTrip = new Map<string, string[]>();
    const names = new Map<string, string>();
    for (const item of plan.planned) {
      stopsByTrip.set(item.tripCode, item.stations.map((s) => s.stationId));
      item.stations.forEach((station, index) => {
        names.set(station.stationId, station.stationName);
        if (station.arriveAt == null && station.departAt == null) return;
        stops.push({
          tripCode: item.tripCode,
          vehicleCode: item.vehicleCode,
          stationId: station.stationId,
          stationName: station.stationName,
          taskLabel: item.cardLabel || item.routeName || item.tripCode,
          stopIndex: index,
          arriveAt: station.arriveAt ?? null,
          departAt: station.departAt ?? null,
        });
      });
    }
    this.planCache = { key, stops, stopsByTrip, names };
    return this.planCache;
  }

  private async liveVehicles(): Promise<LiveVehicle[]> {
    const snapshot = await this.redis.getAllVehiclesSnapshot([...VTMS_VEHICLE_CODES]);
    const realNow = Date.now();
    const out: LiveVehicle[] = [];
    for (const vehicleCode of VTMS_VEHICLE_CODES) {
      const entry = snapshot[vehicleCode] as { telemetry?: Record<string, any>; operation?: Record<string, any> } | undefined;
      const operation = entry?.operation;
      if (!operation) continue;
      // 訊息時刻是實際時間（技術判斷用）；換成營運時刻才能跟計畫比
      const observedAt = num(operation.timestamp) ?? num(entry?.telemetry?.timestamp) ?? realNow;
      const leg = operation.current_leg as Record<string, unknown> | undefined;
      out.push({
        vehicleCode,
        tripCode: str(operation.trip_code),
        orderId: str(operation.order_id),
        targetStationId: str(leg?.target_station_id),
        etaSeconds: num(leg?.eta_seconds),
        distanceM: num(leg?.distance_to_target_m),
        vehiclePhase: str(operation.vehicle_phase),
        observedOp: this.clock.toOperating(observedAt),
        ageSeconds: Math.max(0, (realNow - observedAt) / 1000),
      });
    }
    return out;
  }
}
