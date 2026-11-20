import type { PlannedDispatch } from '../dispatch/dispatch.plan';
import { buildStationPlan } from './station-eta.plan';
import { mergeStationEvents } from './station-eta';

/**
 * 進站動態：只要車要到那一站就要有資料，不分卡片種類（使用者 2026-11-20）。
 * 意圖照排班卡片對應：載客上行／載客下行、終點下車、出場、入廠、通過；出發前在站上的暫停／待命另外標。
 */
const T = new Date(2026, 10, 20, 2, 0, 0).getTime();
const S = 1000;
const station = (id: string, name: string) => ({ id, name, kind: 'station' as const, arriveAt: null, departAt: null });
const facility = (id: string, name: string) => ({ id, name, kind: 'facility' as const, arriveAt: null, departAt: null });
const base = (patch: Partial<PlannedDispatch>): PlannedDispatch => ({
  kind: 'passenger', maintenance: null, orderId: `261120-${patch.tripCode}`, tripCode: 'X', vehicleCode: 'PMS02', timelineRow: 2,
  taskType: 'passenger', cardLabel: '', routeCode: null, routeName: '', departAt: T, arriveAt: T, origin: null, destination: null, stations: [],
  ...patch,
} as PlannedDispatch);

// 02:00 上行 T3U → NWU 抵達 02:03:30；02:03:30–02:13:30 在 NWU 暫停；02:13:30 入廠 NWU → E1（沒有途經站）
const up = base({
  tripCode: 'ST0200', cardLabel: '上行', departAt: T, arriveAt: T + 210 * S,
  stations: [
    { order: 1, stationId: 't3_u', stationName: 'T3U', role: 'origin', arriveAt: null, departAt: T, dwellSeconds: 0 },
    { order: 2, stationId: 's2w_u', stationName: 'SWU', role: 'intermediate', arriveAt: T + 100 * S, departAt: T + 130 * S, dwellSeconds: 30 },
    { order: 3, stationId: 'n2w_u', stationName: 'NWU', role: 'terminal', arriveAt: T + 210 * S, departAt: null, dwellSeconds: 0 },
  ],
});
const hold = base({
  kind: 'maintenance', tripCode: 'WT020203', taskType: 'idle', cardLabel: '暫停', stationHold: true,
  departAt: T + 210 * S, arriveAt: T + 810 * S, origin: station('n2w_u', 'NWU'), destination: station('n2w_u', 'NWU'),
});
const entry = base({
  kind: 'movement', tripCode: 'IN020213', taskType: 'dispatch', cardLabel: '整備入廠 · → E1', transitionPurpose: 'yard_entry',
  departAt: T + 810 * S, arriveAt: T + 1000 * S, origin: station('n2w_u', 'NWU'), destination: facility('130', 'E1'),
});
// 充電站開回 H1，經過 NWD（停留 0 秒）
const passBy = base({
  kind: 'movement', tripCode: 'IN020220', vehicleCode: 'PMS05', timelineRow: 5, taskType: 'dispatch', transitionPurpose: 'yard_entry',
  departAt: T + 1200 * S, arriveAt: T + 1500 * S, origin: station('160', 'CHG'), destination: facility('132', 'H1'),
  stations: [
    { order: 1, stationId: '160', stationName: 'CHG', role: 'origin', arriveAt: null, departAt: T + 1200 * S, dwellSeconds: 0 },
    { order: 2, stationId: 'n2w_d', stationName: 'NWD', role: 'intermediate', arriveAt: T + 1250 * S, departAt: T + 1250 * S, dwellSeconds: 0 },
    { order: 3, stationId: '132', stationName: 'H1', role: 'terminal', arriveAt: T + 1500 * S, departAt: null, dwellSeconds: 0 },
  ],
});
// 出場 E4 → NWD（沒有途經站）
const exit = base({
  kind: 'movement', tripCode: 'OT040230', vehicleCode: 'PMS04', timelineRow: 4, taskType: 'dispatch', transitionPurpose: 'yard_exit',
  departAt: T + 1800 * S, arriveAt: T + 1900 * S, origin: facility('136', 'E4'), destination: station('n2w_d', 'NWD'),
});
// 場區充電：不是站，不列
const charging = base({
  kind: 'maintenance', tripCode: 'E080000', taskType: 'maintenance', departAt: T, arriveAt: T + 3600 * S,
  origin: facility('131', 'E2'), destination: facility('131', 'E2'),
});

const plan = buildStationPlan([{ operatingDay: '2026-11-20', planned: [up, hold, entry, passBy, exit, charging] }]);
const merge = (stationId: string, operatingNow = T - 60 * S, extra: Partial<Parameters<typeof mergeStationEvents>[0]> = {}) =>
  mergeStationEvents({
    stations: [{ stationId, events: ['arrive', 'depart'] }], stationNames: plan.names, planned: plan.stops, stopsByTrip: plan.stopsByTrip,
    live: [], tripStates: new Map(), holds: plan.holds, operatingNow, staleAfterSeconds: 90, limit: 10, ...extra,
  })[0]!.events.map((e) => [e.vehicle_code, e.event_label, (e.at - T) / 1000, e.intent, e.hold_label]);

describe('進站動態：所有卡片都算，意圖照卡片', () => {
  it('載客：中途站載客上行、終點下車；起站出發載客上行', () => {
    expect(merge('s2w_u')).toEqual([['PMS02', '抵達', 100, '載客上行', null]]);
    expect(merge('t3_u')).toEqual([]);
    const intents = plan.stops.filter((s) => s.tripCode === 'ST0200').map((s) => [s.stationId, s.arriveIntent, s.departIntent]);
    expect(intents).toEqual([['t3_u', '載客上行', '載客上行'], ['s2w_u', '載客上行', '載客上行'], ['n2w_u', '終點下車', '載客上行']]);
  });

  it('沒有途經站的入廠卡也算：停在 NWU 暫停的車照樣看得到，出發那一筆標暫停、意圖入廠', () => {
    expect(merge('n2w_u')).toEqual([['PMS02', '抵達', 210, '終點下車', null]]);
    // 車已確認停在 NWU（上行正常結案、入廠待發）
    const states = new Map([
      ['2026-11-20|ST0200', { status: 'END', closedReason: null }],
      ['2026-11-20|IN020213', { status: 'PENDING', closedReason: null }],
    ]);
    expect(merge('n2w_u', T + 300 * S, { tripStates: states })).toEqual([['PMS02', '出發', 810, '入廠', '暫停']]);
  });

  it('經過不停的移動卡列一筆「通過」；出場開到月台是抵達「出場」', () => {
    expect(merge('n2w_d')).toEqual([
      ['PMS05', '通過', 1250, '通過', null],
      ['PMS04', '抵達', 1900, '出場', null],
    ]);
  });

  it('經過之後（車已開往後面的站）就拿掉', () => {
    const live = [{ vehicleCode: 'PMS05', tripCode: 'IN020220', tripKey: '2026-11-20|IN020220', orderId: '261120-IN020220', targetStationId: '132',
      etaSeconds: 200, distanceM: 500, vehiclePhase: 'TRANSITING', observedOp: T + 1260 * S, ageSeconds: 1 }];
    expect(merge('n2w_d', T + 1260 * S, { live })).toEqual([['PMS04', '抵達', 1900, '出場', null]]);
  });

  it('場區整備不是站、月台暫停卡不另外產生到站出發', () => {
    expect(plan.stops.some((s) => s.tripCode === 'E080000' || s.tripCode === 'WT020203')).toBe(false);
    expect(plan.holds).toEqual([{ vehicleCode: 'PMS02', stationId: 'n2w_u', startAt: T + 210 * S, endAt: T + 810 * S, label: '暫停' }]);
  });

  it('前一天延續到凌晨的卡跟今天同代號的卡分開', () => {
    const y = buildStationPlan([
      { operatingDay: '2026-11-19', planned: [up] },
      { operatingDay: '2026-11-20', planned: [{ ...up, orderId: '261120-ST0200b', departAt: T + 86_400_000 }] },
    ]);
    expect([...y.stopsByTrip.keys()]).toEqual(['2026-11-19|ST0200', '2026-11-20|ST0200']);
    expect(y.keyByOrderId.get('261120-ST0200')).toBe('2026-11-19|ST0200');
  });
});
