import { mergeStationArrivals, type LiveVehicle, type PlannedArrival } from './station-eta';

const T = new Date(2026, 9, 6, 7, 0, 0).getTime();
const MIN = 60_000;
const stops = new Map([
  ['TN01', ['t3_u', 'n2w_d_end', 'n2w_d_start']],
  ['TN02', ['t3_u', 'n2w_d_end', 'n2w_d_start']],
  ['TN03', ['t3_u', 'n2w_d_end', 'n2w_d_start']],
]);
const plan = (tripCode: string, vehicleCode: string, stationId: string, stopIndex: number, atMin: number): PlannedArrival => ({
  tripCode, vehicleCode, stationId, stationName: stationId, stopIndex, arriveAt: T + atMin * MIN,
});
const live = (patch: Partial<LiveVehicle>): LiveVehicle => ({
  vehicleCode: 'PMS01', tripCode: 'TN01', orderId: 'O1', targetStationId: 'n2w_d_end', etaSeconds: 120,
  distanceM: 300, vehiclePhase: 'TRANSITING', observedOp: T, ageSeconds: 1, ...patch,
});
const run = (args: Partial<Parameters<typeof mergeStationArrivals>[0]>) => mergeStationArrivals({
  stationIds: ['n2w_d_end'], stationNames: new Map(), planned: [], stopsByTrip: stops, live: [], tripStates: new Map(),
  operatingNow: T, staleAfterSeconds: 90, limit: 3, ...args,
})[0]!;

describe('站點到站清單', () => {
  it('目前目標站用車端剩餘秒數（營運時間），其餘照計畫；依到站時刻排序、最多三筆', () => {
    const g = run({
      planned: [plan('TN01', 'PMS01', 'n2w_d_end', 1, 3), plan('TN02', 'PMS02', 'n2w_d_end', 1, 8), plan('TN03', 'PMS03', 'n2w_d_end', 1, 5), plan('TN04', 'PMS04', 'n2w_d_end', 1, 20)],
      live: [live({})],
    });
    expect(g.arrivals.map((a) => [a.trip_code, a.kind])).toEqual([['TN01', 'live'], ['TN03', 'plan'], ['TN02', 'plan']]);
    expect(g.arrivals[0]!.eta_at).toBe(T + 120_000);
    expect(g.arrivals[0]!.delay_seconds).toBe(-60);
  });

  it('同一台車循環再到同一站是另一筆，不當重複刪掉', () => {
    const g = run({ planned: [plan('TN01', 'PMS01', 'n2w_d_end', 1, 3), plan('TN02', 'PMS01', 'n2w_d_end', 1, 40)] });
    expect(g.arrivals.map((a) => a.trip_code)).toEqual(['TN01', 'TN02']);
  });

  it('已到站（停靠中或距離很近）、已經開往後面的站、班次已結束或取消：移除', () => {
    const planned = [plan('TN01', 'PMS01', 'n2w_d_end', 1, 3)];
    expect(run({ planned, live: [live({ distanceM: 2 })] }).arrivals).toEqual([]);
    expect(run({ planned, live: [live({ vehiclePhase: 'DWELLING' })] }).arrivals).toEqual([]);
    expect(run({ planned, live: [live({ targetStationId: 'n2w_d_start' })] }).arrivals).toEqual([]);
    expect(run({ planned, tripStates: new Map([['TN01', { status: 'END', closedReason: null }]]) }).arrivals).toEqual([]);
    expect(run({ planned, tripStates: new Map([['TN01', { status: 'FAULTED', closedReason: 'cancelled_by_center' }]]) }).arrivals).toEqual([]);
  });

  it('車端資料過期：不當成即時，退回計畫並標示過期；只剩過期資料時狀態為 stale', () => {
    const g = run({ planned: [plan('TN01', 'PMS01', 'n2w_d_end', 1, 3)], live: [live({ ageSeconds: 300 })] });
    expect(g.arrivals[0]!.kind).toBe('plan');
    expect(g.stale_vehicles).toEqual(['PMS01']);
    const none = run({ planned: [], live: [] });
    expect(none.state).toBe('no_vehicle');
  });

  it('計畫時刻早就過了、也沒有執行資料：不列為即將到站', () => {
    const g = run({ planned: [plan('TN01', 'PMS01', 'n2w_d_end', 1, -10)] });
    expect(g.arrivals).toEqual([]);
    expect(g.state).toBe('no_vehicle');
  });
});
