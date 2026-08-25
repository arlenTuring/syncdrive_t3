import { Injectable, Logger } from '@nestjs/common';
import { VTMS_VEHICLE_CODES } from '../../common/vehicle-codes';
import { OperationShiftService } from '../../operation-shift/operation-shift.service';
import { RedisService } from '../../redis/redis.service';
import { vehicleEtaConfig } from './vehicle-eta.config';
import { scheduleSecondToAt, toClock } from './vehicle-eta.clock';
import {
  dataAgeSeconds,
  resolveArrivalState,
  resolveDataQuality,
  resolveDelayState,
  type TaskGroupItem,
} from './vehicle-eta.derive';
import type {
  EtaMetaDto,
  EtaPlanDto,
  StationEtaEntryDto,
  VehicleEtaByStationResponseDto,
  VehicleEtaByVehicleResponseDto,
  VehicleEtaEntryDto,
  VehicleNextStopDto,
} from './vehicle-eta.dto';

/** 車端 operation/update 上行封包裡本服務用得到的部分 */
type OperationPayload = {
  timestamp?: number;
  order_id?: string;
  trip_code?: string;
  vehicle_phase?: string;
  current_leg?: {
    target_station_id?: string;
    distance_to_target_m?: number;
    eta_seconds?: number;
  };
  task_group?: TaskGroupItem[];
};

/** 車端 telemetry/update 上行封包裡本服務用得到的部分 */
type TelemetryPayload = {
  timestamp?: number;
  global_pose?: { latitude?: number; longitude?: number };
  local_pose?: { heading?: number };
  kinematics?: { velocity?: number };
};

/** 由班表展開出來的計畫值，以 trip_code + station_id 為鍵 */
type PlanIndex = Map<
  string,
  { arriveSecond: number | null; departSecond: number | null }
>;

/**
 * 車輛即時 ETA。
 *
 * <strong>ETA 不是這裡算出來的。</strong>車端在營運任務狀態協議的
 * <code>current_leg</code> 已經回報了目標站、剩餘距離與剩餘秒數——車上有路徑與速度，
 * 它算得比中心端準。本服務做的是把那份即時值<strong>索引成兩種視角</strong>（依站、
 * 依車），補上班表計畫值與誤差，並依規格書的門檻推導對外狀態欄位。
 *
 * 資料來源兩份：
 * <ul>
 *   <li>Redis 的車輛最新快照——1 Hz 覆寫，不設過期。失聯呈現為「資料變舊」而非
 *       「資料消失」，所以每一筆都帶 <code>data_age_seconds</code>。</li>
 *   <li>已發布班表的站點計畫 ETA——與對外的計畫值介面同一個來源，兩支 API 對同一
 *       班次的計畫時刻不會有出入。</li>
 * </ul>
 */
@Injectable()
export class VehicleEtaService {
  private readonly logger = new Logger(VehicleEtaService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly operationShiftService: OperationShiftService,
  ) {}

  async getByStation(query: {
    stationIds?: string[];
    limitPerStation: number;
  }): Promise<VehicleEtaByStationResponseDto> {
    const context = await this.loadContext();
    const wanted = query.stationIds?.length ? new Set(query.stationIds) : null;

    const stations = context.stations
      .filter((station) => !wanted || wanted.has(station.station_id))
      .map((station) => ({
        station_id: station.station_id,
        station_name: station.station_name,
        etas: [] as StationEtaEntryDto[],
      }));
    const byId = new Map(
      stations.map((station) => [station.station_id, station]),
    );

    for (const vehicle of context.vehicles) {
      const leg = vehicle.operation?.current_leg;
      const stationId = leg?.target_station_id?.trim();
      if (!stationId) continue;
      const group = byId.get(stationId);
      if (!group) continue;

      const entry = this.buildStationEntry(vehicle, context, stationId);
      group.etas.push(entry);
    }

    for (const station of stations) {
      // 依絕對抵達時刻由近到遠；UNKNOWN（沒有 eta_at）一律排在最後
      station.etas.sort((a, b) => {
        if (a.eta_at == null && b.eta_at == null) return 0;
        if (a.eta_at == null) return 1;
        if (b.eta_at == null) return -1;
        return a.eta_at - b.eta_at;
      });
      station.etas = station.etas.slice(0, query.limitPerStation);
    }

    return {
      meta: context.meta,
      station_count: stations.length,
      stations,
    };
  }

  async getByVehicle(query: {
    vehicleCodes?: string[];
    nextStops: number;
  }): Promise<VehicleEtaByVehicleResponseDto> {
    const context = await this.loadContext();
    const wanted = query.vehicleCodes?.length
      ? new Set(query.vehicleCodes)
      : null;

    const vehicles: VehicleEtaEntryDto[] = [];
    for (const vehicle of context.vehicles) {
      if (wanted && !wanted.has(vehicle.vehicleCode)) continue;
      vehicles.push(this.buildVehicleEntry(vehicle, context, query.nextStops));
    }

    return {
      meta: context.meta,
      vehicle_count: vehicles.length,
      vehicles,
    };
  }

  /** 這一站的清單裡，這台車的那一筆 */
  private buildStationEntry(
    vehicle: VehicleSnapshot,
    context: EtaContext,
    stationId: string,
  ): StationEtaEntryDto {
    const stop = this.buildStop({ vehicle, context, stationId, sequence: 1 });
    const route = context.routeOf(vehicle.operation?.trip_code);
    return {
      vehicle_code: vehicle.vehicleCode,
      order_id: vehicle.operation?.order_id ?? null,
      trip_code: vehicle.operation?.trip_code ?? null,
      route_code: route.code,
      route_name: route.name,
      vehicle_phase: vehicle.stale
        ? null
        : (vehicle.operation?.vehicle_phase ?? null),
      arrival_state: stop.arrival_state,
      eta_seconds: stop.eta_seconds,
      eta_at: stop.eta_at,
      eta_clock: stop.eta_clock,
      distance_to_station_m: stop.distance_to_station_m,
      plan: stop.plan,
      observed_at: vehicle.observedAt,
      observed_clock: toClock(vehicle.observedAt)!,
      data_age_seconds: vehicle.ageSeconds,
    };
  }

  private buildVehicleEntry(
    vehicle: VehicleSnapshot,
    context: EtaContext,
    nextStops: number,
  ): VehicleEtaEntryDto {
    const route = context.routeOf(vehicle.operation?.trip_code);
    const targetStationId =
      vehicle.operation?.current_leg?.target_station_id?.trim();

    /**
     * 第 2 站以後的外推。
     *
     * 規格書 7.13 寫明：sequence=1 直接用車端值，之後由中心端依班表站間旅行時間
     * 外推。所以這裡走的是<strong>班表的站序</strong>，不是地圖路線——班表已經把
     * 這一班要停哪些站、每站幾點到算好了，用它推最接近實際排定。
     */
    const upcoming = targetStationId
      ? context.upcomingStationsOf(
          vehicle.operation?.trip_code,
          targetStationId,
          nextStops,
        )
      : [];

    const stops: VehicleNextStopDto[] = upcoming.map((stationId, index) => {
      const stop = this.buildStop({
        vehicle,
        context,
        stationId,
        sequence: index + 1,
      });
      return {
        sequence: index + 1,
        station_id: stationId,
        station_name: context.nameOf(stationId),
        arrival_state: stop.arrival_state,
        eta_seconds: stop.eta_seconds,
        eta_at: stop.eta_at,
        eta_clock: stop.eta_clock,
        distance_to_station_m: stop.distance_to_station_m,
        plan: stop.plan,
      };
    });

    return {
      vehicle_code: vehicle.vehicleCode,
      vehicle_phase: vehicle.stale
        ? null
        : (vehicle.operation?.vehicle_phase ?? null),
      order_id: vehicle.operation?.order_id ?? null,
      trip_code: vehicle.operation?.trip_code ?? null,
      route_code: route.code,
      route_name: route.name,
      position: vehicle.stale ? null : vehicle.position,
      next_stops: stops,
      observed_at: vehicle.observedAt,
      observed_clock: toClock(vehicle.observedAt)!,
      data_age_seconds: vehicle.ageSeconds,
    };
  }

  /**
   * 一台車對某一個停靠點的完整推估。
   *
   * <code>sequence === 1</code>（車端當前目標站）直接採用車端回報的剩餘秒數與距離；
   * 之後的站沒有車端值，改由班表計畫時刻推——距離無從得知，照規格回 null。
   */
  private buildStop(args: {
    vehicle: VehicleSnapshot;
    context: EtaContext;
    stationId: string;
    sequence: number;
  }): {
    arrival_state: string;
    eta_seconds: number | null;
    eta_at: number | null;
    eta_clock: string | null;
    distance_to_station_m: number | null;
    plan: EtaPlanDto;
  } {
    const { vehicle, context, stationId, sequence } = args;
    const leg = vehicle.operation?.current_leg;
    const targetStationId = leg?.target_station_id?.trim() ?? null;
    const isCurrentTarget = sequence === 1 && targetStationId === stationId;

    const plan = context.planOf(vehicle.operation?.trip_code, stationId);
    const plannedArrivalAt = scheduleSecondToAt(
      plan?.arriveSecond,
      context.generatedAt,
    );
    const plannedDepartureAt = scheduleSecondToAt(
      plan?.departSecond,
      context.generatedAt,
    );

    let etaSeconds: number | null = null;
    let distance: number | null = null;
    if (isCurrentTarget) {
      etaSeconds = numberOrNull(leg?.eta_seconds);
      distance = numberOrNull(leg?.distance_to_target_m);
    } else if (plannedArrivalAt != null) {
      // 外推：以班表計畫抵達為準，換算成「自車端回報時刻起算還有幾秒」
      etaSeconds = Math.max(
        0,
        Math.round((plannedArrivalAt - vehicle.observedAt) / 1000),
      );
    }

    const arrivalState = resolveArrivalState({
      dataAgeSeconds: vehicle.ageSeconds,
      targetStationId,
      stationId,
      etaSeconds,
      distanceM: distance,
      taskGroup: vehicle.operation?.task_group,
    });

    // 規格書 7.8：UNKNOWN 時三個 ETA 欄位皆為 null
    const usable = arrivalState !== 'UNKNOWN' && etaSeconds != null;
    const etaAt = usable ? vehicle.observedAt + etaSeconds! * 1000 : null;
    const delaySeconds =
      etaAt != null && plannedArrivalAt != null
        ? Math.round((etaAt - plannedArrivalAt) / 1000)
        : null;

    return {
      arrival_state: arrivalState,
      eta_seconds: usable ? etaSeconds : null,
      eta_at: etaAt,
      eta_clock: toClock(etaAt),
      distance_to_station_m: usable ? distance : null,
      plan: {
        planned_arrival_at: plannedArrivalAt,
        planned_arrival_clock: toClock(plannedArrivalAt),
        // 規格書 7.9：發車時刻只在起站或停靠中才有意義
        planned_departure_at:
          plan?.arriveSecond == null || arrivalState === 'AT_STATION'
            ? plannedDepartureAt
            : null,
        planned_departure_clock:
          plan?.arriveSecond == null || arrivalState === 'AT_STATION'
            ? toClock(plannedDepartureAt)
            : null,
        delay_seconds: delaySeconds,
        delay_state: resolveDelayState(delaySeconds),
      },
    };
  }

  /** 一次備齊兩份資料來源，兩支 API 共用 */
  private async loadContext(): Promise<EtaContext> {
    const generatedAt = Date.now();
    const snapshot = await this.redisService.getAllVehiclesSnapshot([
      ...VTMS_VEHICLE_CODES,
    ]);

    const vehicles: VehicleSnapshot[] = [];
    let freshCount = 0;
    for (const vehicleCode of VTMS_VEHICLE_CODES) {
      const entry = snapshot[vehicleCode] as
        | { telemetry?: TelemetryPayload; operation?: OperationPayload }
        | undefined;
      const operation = entry?.operation ?? null;
      const telemetry = entry?.telemetry ?? null;
      if (!operation && !telemetry) continue;

      // 規格書 7.11：車端未提供時間戳時，改以中心端收訊時刻替代
      const observedAt =
        numberOrNull(operation?.timestamp) ??
        numberOrNull(telemetry?.timestamp) ??
        generatedAt;
      const ageSeconds = dataAgeSeconds(generatedAt, observedAt);
      const stale = ageSeconds > vehicleEtaConfig.dataStaleSeconds;
      if (!stale) freshCount += 1;

      vehicles.push({
        vehicleCode,
        operation,
        observedAt,
        ageSeconds,
        stale,
        position:
          telemetry?.global_pose?.latitude == null
            ? null
            : {
                latitude: telemetry.global_pose.latitude,
                longitude: telemetry.global_pose?.longitude ?? 0,
                heading: telemetry.local_pose?.heading ?? 0,
                velocity_kph: telemetry.kinematics?.velocity ?? 0,
              },
      });
    }

    const timetable = await this.loadTimetable();
    const meta: EtaMetaDto = {
      generated_at: generatedAt,
      generated_clock: toClock(generatedAt)!,
      shift_id: timetable.shiftId,
      source: timetable.source,
      data_quality: resolveDataQuality({
        fleetSize: VTMS_VEHICLE_CODES.length,
        freshCount,
      }),
    };

    return {
      generatedAt,
      meta,
      vehicles,
      stations: timetable.stations,
      nameOf: (stationId) => timetable.nameById.get(stationId) ?? stationId,
      /**
       * 計畫值以 <code>trip_code</code> 直接對上班表。
       *
       * 車端與班表用的是同一套代號（路線代號＋HHMM，見營運任務狀態協議 §三與車輛
       * 即時 ETA 規格書 3.1），所以這裡不需要任何格式轉換。對不上就是真的沒有計畫值
       * ——例如加班車、調度車，或班表尚未載入，照規格回 NO_PLAN。
       */
      planOf: (tripCode, stationId) =>
        tripCode
          ? (timetable.plan.get(`${tripCode.trim()}|${stationId}`) ?? null)
          : null,
      routeOf: (tripCode) =>
        (tripCode ? timetable.routeByTrip.get(tripCode.trim()) : null) ?? {
          code: null,
          name: null,
        },
      upcomingStationsOf: (tripCode, fromStationId, count) => {
        const sequence = tripCode
          ? timetable.stopsByTrip.get(tripCode.trim())
          : null;
        if (!sequence?.length) return [fromStationId];
        const index = sequence.indexOf(fromStationId);
        if (index < 0) return [fromStationId];
        return sequence.slice(index, index + count);
      },
    };
  }

  /**
   * 班表側資料。
   *
   * 班表讀不到不是致命錯誤——即時值本身仍然有效，只是沒有計畫值可比。這種情況
   * 回 <code>source: 'none'</code>、<code>plan</code> 全 null，由使用方自行判讀，
   * 不整支 API 失敗（規格書 9.3 降級原則）。
   */
  private async loadTimetable(): Promise<{
    shiftId: string | null;
    source: 'published' | 'draft_fallback' | 'none';
    stations: Array<{ station_id: string; station_name: string }>;
    nameById: Map<string, string>;
    plan: PlanIndex;
    stopsByTrip: Map<string, string[]>;
    routeByTrip: Map<string, { code: string | null; name: string | null }>;
  }> {
    const empty = {
      shiftId: null,
      source: 'none' as const,
      stations: [],
      nameById: new Map<string, string>(),
      plan: new Map() as PlanIndex,
      stopsByTrip: new Map<string, string[]>(),
      routeByTrip: new Map<
        string,
        { code: string | null; name: string | null }
      >(),
    };

    try {
      const result = await this.operationShiftService.getStationEtas({});
      const nameById = new Map<string, string>();
      for (const station of result.stations) {
        nameById.set(
          station.station_id,
          station.station_alias || station.station_name,
        );
      }

      const plan: PlanIndex = new Map();
      const stopsByTrip = new Map<string, string[]>();
      const routeByTrip = new Map<
        string,
        { code: string | null; name: string | null }
      >();
      // etas 已依時間排序，逐筆推進即可還原每一班的站序
      for (const eta of result.etas) {
        const key = `${eta.trip_code}|${eta.station_id}`;
        if (!plan.has(key)) {
          plan.set(key, {
            arriveSecond: eta.eta_arrive_second,
            departSecond: eta.eta_depart_second,
          });
        }
        const stops = stopsByTrip.get(eta.trip_code) ?? [];
        if (!stops.includes(eta.station_id)) stops.push(eta.station_id);
        stopsByTrip.set(eta.trip_code, stops);
        if (!routeByTrip.has(eta.trip_code)) {
          routeByTrip.set(eta.trip_code, {
            code: eta.route_code ?? null,
            name: eta.route_name ?? null,
          });
        }
      }

      return {
        shiftId: result.meta.shift_id ?? null,
        source:
          result.meta.source === 'published' ? 'published' : 'draft_fallback',
        stations: result.stations.map((station) => ({
          station_id: station.station_id,
          station_name: station.station_alias || station.station_name,
        })),
        nameById,
        plan,
        stopsByTrip,
        routeByTrip,
      };
    } catch (error) {
      this.logger.warn(
        `班表計畫值讀取失敗，改以 source=none 回應：${(error as Error)?.message ?? error}`,
      );
      return empty;
    }
  }
}

type VehicleSnapshot = {
  vehicleCode: string;
  operation: OperationPayload | null;
  observedAt: number;
  ageSeconds: number;
  stale: boolean;
  position: {
    latitude: number;
    longitude: number;
    heading: number;
    velocity_kph: number;
  } | null;
};

type EtaContext = {
  generatedAt: number;
  meta: EtaMetaDto;
  vehicles: VehicleSnapshot[];
  stations: Array<{ station_id: string; station_name: string }>;
  nameOf: (stationId: string) => string;
  planOf: (
    tripCode: string | undefined,
    stationId: string,
  ) => { arriveSecond: number | null; departSecond: number | null } | null;
  routeOf: (tripCode: string | undefined) => {
    code: string | null;
    name: string | null;
  };
  upcomingStationsOf: (
    tripCode: string | undefined,
    fromStationId: string,
    count: number,
  ) => string[];
};

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
