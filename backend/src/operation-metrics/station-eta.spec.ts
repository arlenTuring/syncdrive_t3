import { mergeStationEvents, type LiveVehicle, type PlannedStop, type StationEventKind } from './station-eta';

const T = new Date(2026, 9, 6, 7, 0, 0).getTime();
const MIN = 60_000;
const SEQ = ['t3_u', 'n2w_d_end', 'n2w_d_start'];
const stopsByTrip = new Map(['TN01', 'TN02', 'TN03', 'TN04'].map((t) => [t, SEQ]));
/** TN 班：T3上行 出發 → N2W上行停靠（到站、停 2 分）→ N2W下行出發（終點，到站） */
const trip = (tripCode: string, vehicleCode: string, startMin: number): PlannedStop[] => [
  { tripCode, vehicleCode, stationId: 't3_u', stationName: 'T3上行', stopIndex: 0, arriveAt: null, departAt: T + startMin * MIN },
  { tripCode, vehicleCode, stationId: 'n2w_d_end', stationName: 'N2W上行停靠', stopIndex: 1, arriveAt: T + (startMin + 3) * MIN, departAt: T + (startMin + 5) * MIN },
  { tripCode, vehicleCode, stationId: 'n2w_d_start', stationName: 'N2W下行出發', stopIndex: 2, arriveAt: T + (startMin + 6) * MIN, departAt: null },
];
const live = (patch: Partial<LiveVehicle>): LiveVehicle => ({
  vehicleCode: 'PMS01', tripCode: 'TN01', orderId: 'O1', targetStationId: 'n2w_d_end', etaSeconds: 150,
  distanceM: 300, vehiclePhase: 'TRANSITING', observedOp: T, ageSeconds: 1, ...patch,
});
const run = (args: Partial<Parameters<typeof mergeStationEvents>[0]>, events: StationEventKind[] = ['arrive', 'depart'], stationId = 'n2w_d_end') =>
  mergeStationEvents({
    stations: [{ stationId, events }], stationNames: new Map(), planned: [], stopsByTrip, live: [], tripStates: new Map(),
    operatingNow: T, staleAfterSeconds: 90, limit: 4, ...args,
  })[0]!;
const brief = (g: ReturnType<typeof run>) => g.events.map((e) => [e.trip_code, e.event, e.kind, (e.at - T) / 1000]);

describe('站點到站／出發清單', () => {
  it('開往這一站：到站用車端剩餘秒數；出發取計畫出發與即時到站的較晚者', () => {
    const g = run({ planned: [...trip('TN01', 'PMS01', -1), ...trip('TN02', 'PMS02', 4)], live: [live({ etaSeconds: 150 })] });
    expect(brief(g)).toEqual([
      ['TN01', 'arrive', 'live', 150],
      ['TN01', 'depart', 'live', 240],
      ['TN02', 'arrive', 'plan', 420],
      ['TN02', 'depart', 'plan', 540],
    ]);
  });

  it('晚到時出發也跟著晚：即時到站晚於計畫出發，出發＝即時到站', () => {
    const g = run({ planned: trip('TN01', 'PMS01', -1), live: [live({ etaSeconds: 300 })] });
    expect(brief(g)).toEqual([['TN01', 'arrive', 'live', 300], ['TN01', 'depart', 'live', 300]]);
  });

  it('停在站上：到站那一筆移除；出發照計畫，已經過了就是現在並標示停靠中', () => {
    const g = run({ planned: trip('TN01', 'PMS01', -1), live: [live({ distanceM: 1, etaSeconds: 0 })] });
    expect(brief(g)).toEqual([['TN01', 'depart', 'live', 240]]);
    expect(g.events[0]!.at_station).toBe(true);
    const late = run({ planned: trip('TN01', 'PMS01', -10), live: [live({ vehiclePhase: 'DWELLING' })] });
    expect(brief(late)).toEqual([['TN01', 'depart', 'live', 0]]);
  });

  it('已經開往後面的站：這一站的到站、出發都移除；班次結束、取消也移除', () => {
    expect(run({ planned: trip('TN01', 'PMS01', -1), live: [live({ targetStationId: 'n2w_d_start' })] }).events).toEqual([]);
    expect(run({ planned: trip('TN01', 'PMS01', 1), tripStates: new Map([['TN01', { status: 'END', closedReason: null }]]) }).events).toEqual([]);
    expect(run({ planned: trip('TN01', 'PMS01', 1), tripStates: new Map([['TN01', { status: 'FAULTED', closedReason: 'cancelled_by_center' }]]) }).events).toEqual([]);
  });

  it('只要到站或只要出發：照每一站的設定列', () => {
    const planned = [...trip('TN01', 'PMS01', 1), ...trip('TN02', 'PMS02', 7)];
    expect(run({ planned }, ['arrive']).events.every((e) => e.event === 'arrive')).toBe(true);
    // 起站只有出發、終站只有到站
    expect(brief(run({ planned }, ['arrive', 'depart'], 't3_u'))).toEqual([['TN01', 'depart', 'plan', 60], ['TN02', 'depart', 'plan', 420]]);
    expect(brief(run({ planned }, ['arrive', 'depart'], 'n2w_d_start'))).toEqual([['TN01', 'arrive', 'plan', 420], ['TN02', 'arrive', 'plan', 780]]);
  });

  it('班與班接續的站只列一次：前一班終點的出發、後一班起站的到站都不列', () => {
    // ST 終點 T3上行 有到站 07:10、出發 07:11（計畫照樣記了出發）；TN 起站 T3上行 07:11 出發
    const st: PlannedStop = { tripCode: 'ST01', vehicleCode: 'PMS01', stationId: 't3_u', stationName: 'T3上行', stopIndex: 1, arriveAt: T + 10 * MIN, departAt: T + 11 * MIN };
    const tn: PlannedStop = { tripCode: 'TN01', vehicleCode: 'PMS01', stationId: 't3_u', stationName: 'T3上行', stopIndex: 0, arriveAt: T + 10 * MIN, departAt: T + 11 * MIN };
    const g = run({ planned: [st, tn], stopsByTrip: new Map([['ST01', ['s2w_d_start', 't3_u']], ['TN01', SEQ]]) }, ['arrive', 'depart'], 't3_u');
    expect(brief(g)).toEqual([['ST01', 'arrive', 'plan', 600], ['TN01', 'depart', 'plan', 660]]);
  });

  it('同一台車循環再到同一站是另一筆，不當重複刪掉', () => {
    const g = run({ planned: [...trip('TN01', 'PMS01', 1), ...trip('TN03', 'PMS01', 30)] }, ['arrive']);
    expect(g.events.map((e) => e.trip_code)).toEqual(['TN01', 'TN03']);
  });

  it('車端資料過期：不當即時，退回計畫並標示過期；沒有任何車：no_vehicle', () => {
    const g = run({ planned: trip('TN01', 'PMS01', -1), live: [live({ ageSeconds: 300 })] }, ['arrive']);
    expect(brief(g)).toEqual([['TN01', 'arrive', 'plan', 120]]);
    expect(g.stale_vehicles).toEqual(['PMS01']);
    expect(run({}).state).toBe('no_vehicle');
  });

  it('計畫時刻已過、又沒有即時資料：不列，也不佔前幾筆的名額', () => {
    expect(run({ planned: trip('TN01', 'PMS01', -20) }).events).toEqual([]);
    // TN01 的到站（07:02）已過、出發（07:04）還沒到：只剩出發，接著是 TN02
    const g = run({ planned: [...trip('TN01', 'PMS01', -1), ...trip('TN02', 'PMS02', 4), ...trip('TN03', 'PMS03', 10)], operatingNow: T + 3 * MIN }, ['arrive', 'depart']);
    expect(brief(g).slice(0, 3)).toEqual([['TN01', 'depart', 'plan', 240], ['TN02', 'arrive', 'plan', 420], ['TN02', 'depart', 'plan', 540]]);
  });
});
