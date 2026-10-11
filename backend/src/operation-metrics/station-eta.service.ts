import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { VTMS_VEHICLE_CODES } from '../common/vehicle-codes';
import { DispatchEngineService } from '../dispatch/dispatch-engine.service';
import { OperatingClockService } from '../operating-day/operating-clock.service';
import { operatingDayReference } from '../operating-day/operating-day';
import { RedisService } from '../redis/redis.service';
import { MapService } from '../map/map.service';
import { resolveMapIdFromShiftBody } from '../operation-shift/timetable/station-alias';
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
    /** 班表引用的地圖：站點 ID 屬於這張圖 */
    mapId: string | null;
  } | null = null;

  constructor(
    private readonly engine: DispatchEngineService,
    private readonly clock: OperatingClockService,
    private readonly redis: RedisService,
    private readonly dataSource: DataSource,
    private readonly mapService: MapService,
  ) {}

  async byStation(stations: Array<{ stationId: string; events: StationEventKind[] }>, limit: number) {
    const operatingNow = this.clock.now();
    const day = this.clock.operatingDay();
    const adoption = await this.engine.ensureDailyPlan(day);
    const plan = adoption ? await this.plannedArrivals(day, adoption.shift_id, adoption.plan_digest) : null;

    // 模擬器／車端路徑使用圖資 facility id（如 156），班表使用營運 station id（如 t3_u）。
    // 兩者都來自同一張啟用圖資，在來源層正規化後再做事件關聯。
    const activeMapId = this.mapService.getActiveMapLibraryStatus().activeMapId;
    const stationIdByReportedId = new Map<string, string>();
    for (const station of this.mapService.getOperationNodes(activeMapId).stations) {
      stationIdByReportedId.set(station.facilityId, station.stationId);
      stationIdByReportedId.set(station.stationId, station.stationId);
    }
    const normalizeStationId = (value: string | null) => value == null ? null : (stationIdByReportedId.get(value) ?? value);
    const live = (await this.liveVehicles()).map((vehicle) => ({
      ...vehicle,
      targetStationId: normalizeStationId(vehicle.targetStationId),
    }));
    const tripStates = new Map<string, TripState>();
    if (adoption) {
      /*
       * 班次代號只在「同一營運日、同一份計畫」內唯一（E021830 每天都有）；重播時再限定這一次執行，
       * 同一天跑過的前幾輪不會跟這一輪串在一起（跟運能統計同一個條件）。
       */
      const params: unknown[] = [day, adoption.shift_id, adoption.plan_digest];
      const replay = this.clock.replayRun();
      let runFilter = '';
      if (replay?.runId) {
        params.push(replay.runId);
        runFilter = `AND payload->>'plan_run_id' = $${params.length}`;
      }
      const rows: Array<{ trip_code: string; status: string; closed_reason: string | null; last_dwell_station_id: string | null }> = await this.dataSource.query(
        `SELECT COALESCE(payload->>'plan_trip_code', trip_code) AS trip_code, status::text AS status,
                payload->>'closed_reason' AS closed_reason,
                payload->'last_confirmed_dwell'->>'station_id' AS last_dwell_station_id
         FROM operation_orders
         WHERE payload->>'operating_day' = $1
           AND payload->>'plan_shift_id' = $2
           AND payload->>'plan_digest' = $3
           ${runFilter}
         ORDER BY created_at ASC`,
        params,
      );
      // 同一班重發：以最後一張為準
      for (const row of rows) tripStates.set(row.trip_code, {
        status: row.status,
        closedReason: row.closed_reason,
        lastDwellStationId: normalizeStationId(row.last_dwell_station_id),
      });
    }

    /*
     * 站名在這裡（快取之後）才解析：同一張圖、同一個站點 ID 的最新保存名稱優先，圖上沒有才用班表
     * 展開時的快照。計畫快取只以班表版本為鍵，圖資改名不會改版本，所以名稱不能跟著快取。
     */
    const currentNames = this.mapService.stationNameIndex(plan?.mapId ?? activeMapId);
    const nameOf = (stationId: string, snapshot: string) => currentNames.get(stationId) ?? snapshot;
    const stationNames = new Map<string, string>();
    for (const [stationId, snapshot] of plan?.names ?? []) stationNames.set(stationId, nameOf(stationId, snapshot));
    for (const station of stations) {
      const current = currentNames.get(station.stationId);
      if (current && !stationNames.has(station.stationId)) stationNames.set(station.stationId, current);
    }
    const groups = mergeStationEvents({
      stations,
      stationNames,
      // 保留完整計畫，mergeStationEvents 才能判斷某張舊待發單是否已被後續實際任務超越。
      planned: (plan?.stops ?? []).map((stop) => ({ ...stop, stationName: nameOf(stop.stationId, stop.stationName) })),
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
    this.planCache = { key, stops, stopsByTrip, names, mapId: resolveMapIdFromShiftBody(plan.body ?? {}) };
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
