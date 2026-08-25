import { VehicleEtaService } from './vehicle-eta.service';

/**
 * 服務層的行為驗證，不連 Redis 也不連資料庫。
 *
 * 兩個相依都是<strong>純讀取</strong>的資料來源（車輛最新快照、班表計畫 ETA），
 * 用假物件餵進去就能把整段推導跑完——包含分組、排序、截斷、計畫值比對與降級。
 */

/** 用建構出來的當地 09:00:00，不用魔術數字——時區不同時 *_clock 的期望值才不會歪 */
const NOW = new Date(2026, 7, 17, 9, 0, 0, 0).getTime();

beforeEach(() => {
  // 服務以 Date.now() 當 generated_at；不凍結時間，所有資料都會被判成逾時
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});
const MIDNIGHT = (() => {
  const date = new Date(NOW);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
})();
const second = (at: number): number => Math.round((at - MIDNIGHT) / 1000);

function makeService(args: {
  snapshot: Record<string, unknown>;
  stationEtas?: unknown;
  stationEtasThrows?: boolean;
}): VehicleEtaService {
  const redis = {
    getAllVehiclesSnapshot: () => Promise.resolve(args.snapshot),
  };
  const operationShift = {
    getStationEtas: () =>
      args.stationEtasThrows
        ? Promise.reject(new Error('no shift'))
        : Promise.resolve(args.stationEtas ?? defaultStationEtas()),
  };
  return new VehicleEtaService(redis as never, operationShift as never);
}

function defaultStationEtas() {
  return {
    meta: { shift_id: 'OS-TEST-0001', source: 'published' },
    stations: [
      {
        station_id: 'station_4',
        station_alias: 'T3上行',
        station_name: 'T3上行',
      },
      {
        station_id: 'station_9',
        station_alias: 'N2W上行停靠',
        station_name: 'N2W',
      },
    ],
    etas: [
      {
        trip_code: 'ST0007',
        station_id: 'station_4',
        route_code: 'ST',
        route_name: 'S2W上行 > T3上行',
        // 計畫 09:00:10 抵達
        eta_arrive_second: second(NOW + 10_000),
        eta_depart_second: second(NOW + 60_000),
      },
      {
        trip_code: 'ST0007',
        station_id: 'station_9',
        route_code: 'ST',
        route_name: 'S2W上行 > T3上行',
        eta_arrive_second: second(NOW + 300_000),
        eta_depart_second: null,
      },
    ],
  };
}

/** 一台正常回報、正朝 station_4 前進的車 */
function movingVehicle(overrides: Record<string, unknown> = {}) {
  return {
    operation: {
      timestamp: NOW - 2000,
      order_id: '260816-ST0007',
      trip_code: 'ST0007',
      vehicle_phase: 'TRANSITING',
      current_leg: {
        target_station_id: 'station_4',
        distance_to_target_m: 120,
        eta_seconds: 25,
      },
      ...overrides,
    },
    telemetry: {
      timestamp: NOW - 2000,
      global_pose: { latitude: 25.077612, longitude: 121.232545 },
      local_pose: { heading: 1.49 },
      kinematics: { velocity: 10.5 },
    },
  };
}

describe('VehicleEtaService.getByStation', () => {
  it('一律列出全部停靠點，無車駛近者為空陣列', async () => {
    const service = makeService({ snapshot: { 'PMS-05': movingVehicle() } });
    const result = await service.getByStation({ limitPerStation: 3 });

    expect(result.station_count).toBe(2);
    expect(result.stations.map((s) => s.station_id)).toEqual([
      'station_4',
      'station_9',
    ]);
    expect(result.stations[1].etas).toEqual([]);
  });

  it('車端回報的 eta 與距離原值帶出，eta_at 恆等於 observed_at + eta_seconds×1000', async () => {
    const service = makeService({ snapshot: { 'PMS-05': movingVehicle() } });
    const result = await service.getByStation({ limitPerStation: 3 });
    const entry = result.stations[0].etas[0];

    expect(entry.vehicle_code).toBe('PMS-05');
    expect(entry.eta_seconds).toBe(25);
    expect(entry.distance_to_station_m).toBe(120);
    expect(entry.arrival_state).toBe('APPROACHING');
    expect(entry.eta_at).toBe(entry.observed_at + 25_000);
    expect(entry.eta_clock).toBe('09:00:23');
  });

  it('計畫值取自班表，delay_seconds 為即時值減計畫值', async () => {
    const service = makeService({ snapshot: { 'PMS-05': movingVehicle() } });
    const result = await service.getByStation({ limitPerStation: 3 });
    const plan = result.stations[0].etas[0].plan;

    // 計畫 09:00:10、預計 09:00:23 → 晚 13 秒
    expect(plan.planned_arrival_clock).toBe('09:00:10');
    expect(plan.delay_seconds).toBe(13);
    expect(plan.delay_state).toBe('ON_TIME');
  });

  it('依 eta_at 由近到遠排序，並截斷到 limit_per_station', async () => {
    const service = makeService({
      snapshot: {
        'PMS-01': movingVehicle({
          current_leg: {
            target_station_id: 'station_4',
            distance_to_target_m: 3520,
            eta_seconds: 790,
          },
        }),
        'PMS-05': movingVehicle(),
        'PMS-09': movingVehicle({
          current_leg: {
            target_station_id: 'station_4',
            distance_to_target_m: 1840,
            eta_seconds: 415,
          },
        }),
      },
    });
    const result = await service.getByStation({ limitPerStation: 2 });
    const etas = result.stations[0].etas;

    expect(etas.map((entry) => entry.vehicle_code)).toEqual([
      'PMS-05',
      'PMS-09',
    ]);
    expect(etas).toHaveLength(2);
  });

  it('station_id 指定時只回那一站', async () => {
    const service = makeService({ snapshot: { 'PMS-05': movingVehicle() } });
    const result = await service.getByStation({
      stationIds: ['station_9'],
      limitPerStation: 3,
    });

    expect(result.station_count).toBe(1);
    expect(result.stations[0].station_id).toBe('station_9');
  });

  it('資料逾時的車：arrival_state 為 UNKNOWN，三個 ETA 欄位皆為 null', async () => {
    const stale = movingVehicle();
    stale.operation.timestamp = NOW - 120_000;
    stale.telemetry.timestamp = NOW - 120_000;
    const service = makeService({ snapshot: { 'PMS-05': stale } });
    const result = await service.getByStation({ limitPerStation: 3 });
    const entry = result.stations[0].etas[0];

    expect(entry.arrival_state).toBe('UNKNOWN');
    expect(entry.eta_seconds).toBeNull();
    expect(entry.eta_at).toBeNull();
    expect(entry.eta_clock).toBeNull();
    expect(entry.vehicle_phase).toBeNull();
    // 逾時仍要回這一筆——失聯是以「資料變舊」呈現，不是以「資料消失」呈現
    expect(entry.data_age_seconds).toBe(120);
  });

  it('沒有任何車輛新鮮時 data_quality 為 DOWN', async () => {
    const service = makeService({ snapshot: {} });
    const result = await service.getByStation({ limitPerStation: 3 });
    expect(result.meta.data_quality).toBe('DOWN');
  });

  it('部分車輛回報時為 DEGRADED——分母是車隊清單，不是有回報的車', async () => {
    const service = makeService({ snapshot: { 'PMS-05': movingVehicle() } });
    const result = await service.getByStation({ limitPerStation: 3 });
    expect(result.meta.data_quality).toBe('DEGRADED');
  });

  it('班表讀不到時不整支失敗：source 為 none、計畫值全 null', async () => {
    const service = makeService({
      snapshot: { 'PMS-05': movingVehicle() },
      stationEtasThrows: true,
    });
    const result = await service.getByStation({ limitPerStation: 3 });

    expect(result.meta.source).toBe('none');
    expect(result.meta.shift_id).toBeNull();
    // 沒有班表就沒有停靠點清單，但即時值本身仍然成立
    expect(result.stations).toEqual([]);
  });
});

describe('trip_code 兩份協議格式不一致時的接合', () => {
  /**
   * 車端依營運任務狀態協議送「[方向][時間]」（U1149），班表與 ETA 規格書用
   * 「[路線代號][HHMM]」（TN1149）。直接比對永遠對不上，計畫值會全部是 null。
   */
  it('車端方向式代號要能接上班表的路線式代號', async () => {
    const service = makeService({
      snapshot: {
        'PMS-05': movingVehicle({
          trip_code: 'U0007',
          current_leg: {
            target_station_id: 'station_4',
            distance_to_target_m: 120,
            eta_seconds: 25,
          },
        }),
      },
      stationEtas: {
        ...defaultStationEtas(),
        etas: defaultStationEtas().etas.map((eta) => ({
          ...eta,
          trip_code: 'ST0007',
        })),
      },
    });
    const result = await service.getByStation({ limitPerStation: 3 });
    const entry = result.stations[0].etas[0];

    expect(entry.plan.planned_arrival_clock).toBe('09:00:10');
    expect(entry.plan.delay_seconds).toBe(13);
    expect(entry.route_code).toBe('ST');
    // 對外一律給班表上的代號——廠商要拿它去查計畫值 API
    expect(entry.trip_code).toBe('ST0007');
  });

  it('對不上班表時退回車端原值，不憑空捏造', async () => {
    const service = makeService({
      snapshot: { 'PMS-05': movingVehicle({ trip_code: 'U9999' }) },
    });
    const result = await service.getByStation({ limitPerStation: 3 });
    const entry = result.stations[0].etas[0];

    expect(entry.trip_code).toBe('U9999');
    expect(entry.plan.planned_arrival_at).toBeNull();
    expect(entry.plan.delay_state).toBe('NO_PLAN');
  });
});

describe('VehicleEtaService.getByVehicle', () => {
  it('sequence 1 用車端值，之後的站由班表外推', async () => {
    const service = makeService({ snapshot: { 'PMS-05': movingVehicle() } });
    const result = await service.getByVehicle({ nextStops: 3 });
    const vehicle = result.vehicles[0];

    expect(vehicle.next_stops.map((stop) => stop.station_id)).toEqual([
      'station_4',
      'station_9',
    ]);
    const [first, secondStop] = vehicle.next_stops;
    expect(first.sequence).toBe(1);
    expect(first.eta_seconds).toBe(25);
    expect(first.distance_to_station_m).toBe(120);
    // 第 2 站沒有車端值：距離無從得知，時間由計畫抵達推回
    expect(secondStop.sequence).toBe(2);
    expect(secondStop.distance_to_station_m).toBeNull();
    expect(secondStop.eta_clock).toBe('09:05:00');
  });

  it('next_stops 截斷到指定站數', async () => {
    const service = makeService({ snapshot: { 'PMS-05': movingVehicle() } });
    const result = await service.getByVehicle({ nextStops: 1 });
    expect(result.vehicles[0].next_stops).toHaveLength(1);
  });

  it('vehicle_code 指定時只回那幾台', async () => {
    const service = makeService({
      snapshot: { 'PMS-01': movingVehicle(), 'PMS-05': movingVehicle() },
    });
    const result = await service.getByVehicle({
      vehicleCodes: ['PMS-05'],
      nextStops: 3,
    });
    expect(result.vehicle_count).toBe(1);
    expect(result.vehicles[0].vehicle_code).toBe('PMS-05');
  });

  it('位置取自 telemetry；資料逾時時為 null', async () => {
    const service = makeService({ snapshot: { 'PMS-05': movingVehicle() } });
    const fresh = await service.getByVehicle({ nextStops: 3 });
    expect(fresh.vehicles[0].position).toEqual({
      latitude: 25.077612,
      longitude: 121.232545,
      heading: 1.49,
      velocity_kph: 10.5,
    });

    const stale = movingVehicle();
    stale.operation.timestamp = NOW - 120_000;
    stale.telemetry.timestamp = NOW - 120_000;
    const staleResult = await makeService({
      snapshot: { 'PMS-05': stale },
    }).getByVehicle({ nextStops: 3 });
    expect(staleResult.vehicles[0].position).toBeNull();
  });
});
