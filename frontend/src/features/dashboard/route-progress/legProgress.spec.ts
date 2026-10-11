import { beforeEach, describe, expect, it } from 'vitest';
import type { RouteStation } from '../types';
import replay from './legProgress.replay.json';
import {
  advanceLegProgress,
  clearLegProgressMemory,
  legReportFromPayload,
  recallLegProgress,
  rememberLegProgress,
  stationIndexForTarget,
  type LegProgressState,
  type LegReport,
} from './legProgress';
import { routeProgressFromCurrentLeg } from './resolveVehiclePosition';

const stationsOf = (ids: string[]): RouteStation[] =>
  ids.map((id, i) => ({ id: `json-${i}`, name: `站${i}`, stationId: id, value: ids.length > 1 ? (i * 100) / (ids.length - 1) : 0 }));
const route = stationsOf(['A', 'B', 'C', 'D']); // 錨點 0、33.3、66.7、100
const report = (orderId: string, ts: number, target: string, distanceM: number | null, etaSeconds: number | null = 5): LegReport =>
  ({ orderId, ts, target, distanceM, etaSeconds });
const step = (prev: LegProgressState | undefined, r: LegReport | null, extra: Partial<Parameters<typeof advanceLegProgress>[1]> = {}) =>
  advanceLegProgress(prev, { orderId: 'O1', stations: route, report: r, backendLegDistanceMax: {}, sql: null, ...extra });

describe('班次卡段落進度（同一張單、同一段）', () => {
  beforeEach(() => clearLegProgressMemory());

  it('依距離推進，分母取這一段第一筆（最大）距離，輪詢不重設', () => {
    let s = step(undefined, report('O1', 1, 'B', 300));
    expect(s.percent).toBeCloseTo(0, 5);
    s = step(s, report('O1', 2, 'B', 150));
    expect(s.percent).toBeCloseTo(100 / 6, 3);
    expect(s.legDistanceMax).toBe(300);
    s = step(s, report('O1', 3, 'B', 0, 0));
    expect([s.percent, s.basis]).toEqual([route[1].value, 'arrived']);
  });

  it('缺分母（新的一段還沒有距離）放在這一段起點；同一段暫缺距離時保留最後位置，不跳回起點', () => {
    let s = step(undefined, report('O1', 1, 'C', 400));
    s = step(s, report('O1', 2, 'C', 100));
    const mid = s.percent;
    s = step(s, report('O1', 3, 'C', null)); // 暫時缺欄位
    expect([s.percent, s.basis]).toEqual([mid, 'held']);
    s = step(s, report('O1', 4, 'D', null)); // 換段且沒有距離
    expect([s.percent, s.basis]).toEqual([route[2].value, 'leg-start']);
  });

  it('亂序、重送、retain 的舊回報不覆蓋目前位置', () => {
    let s = step(undefined, report('O1', 10, 'B', 300));
    s = step(s, report('O1', 12, 'B', 60));
    const now = s.percent;
    expect(step(s, report('O1', 11, 'B', 290)).percent).toBe(now); // 晚到的舊訊息
    expect(step(s, report('O1', 12, 'B', 290)).percent).toBe(now); // 重送
  });

  it('SQL 刷新與暫時斷訊：有過回報的單保留最後位置並標示 held；從沒回報過的用 SQL 同一套距離進度', () => {
    let s = step(undefined, report('O1', 1, 'C', 200));
    s = step(s, report('O1', 2, 'C', 50));
    const held = step(s, null, { sql: { segmentIndex: 0, remainPct: 100 } }); // SQL 舊值也不覆蓋
    expect([held.percent, held.basis]).toEqual([s.percent, 'held']);
    const fresh = step(undefined, null, { sql: { segmentIndex: 1, remainPct: 25 } });
    expect(fresh.basis).toBe('sql');
    expect(fresh.percent).toBeCloseTo(route[1].value + 0.75 * (route[2].value - route[1].value), 5);
    expect(step(undefined, null, { sql: { segmentIndex: 1, remainPct: null } }).basis).toBe('origin');
  });

  it('同一台車換單：下一張單從頭開始，不帶前一張的進度；別張單的回報不採用', () => {
    const first = rememberLegProgress(step(step(undefined, report('O1', 4, 'D', 100)), report('O1', 5, 'D', 10)));
    expect(first.percent).toBeGreaterThan(90);
    const second = advanceLegProgress(recallLegProgress('O2'), {
      orderId: 'O2', stations: route, report: report('O1', 6, 'D', 5), backendLegDistanceMax: {}, sql: null,
    });
    expect([second.percent, second.basis]).toEqual([0, 'origin']);
    expect(recallLegProgress('O1')?.percent).toBe(first.percent);
  });

  it('換段時重設分母，後端記的整段距離優先（卡片中途才載入也對）', () => {
    let s = step(undefined, report('O1', 1, 'B', 100));
    s = step(s, report('O1', 2, 'C', 120), { backendLegDistanceMax: { C: 480 } });
    expect(s.legDistanceMax).toBe(480);
    expect(s.percent).toBeCloseTo(route[1].value + 0.75 * (route[2].value - route[1].value), 5);
  });

  it('站點只比站點 ID；同一站出現兩次時不往回對到較早的那一次', () => {
    const loop = stationsOf(['X', 'Y', 'X', 'Z']);
    expect(stationIndexForTarget(loop, 'X', 2)).toBe(2);
    expect(stationIndexForTarget(loop, 'X', 0)).toBe(0);
    expect(stationIndexForTarget([{ id: 'a', name: 'X', stationId: 'S1', value: 0 }], 'X')).toBe(-1);
  });
});

describe('實錄重播（模擬器 10 倍速）', () => {
  type Ev = { kind: 'mqtt'; at: number; payload: Record<string, unknown> } | { kind: 'sql'; at: number; row: Record<string, unknown> };
  const events = (replay as { events: Ev[] }).events;

  function run(compute: 'old' | 'new') {
    clearLegProgressMemory();
    const sqlByOrder = new Map<string, Record<string, unknown>>();
    const shown = new Map<string, { percent: number; leg: string | null }>();
    const backward: Array<{ order: string; from: number; to: number }> = [];
    let maxStep = 0;
    for (const ev of events) {
      if (ev.kind === 'sql') { sqlByOrder.set(String(ev.row.shift_key), ev.row); continue; }
      const orderId = String(ev.payload.order_id);
      const row = sqlByOrder.get(orderId);
      if (!row || row.order_status !== 'PROCESSING') continue;
      const stations = stationsOf(row.route_stations as string[]);
      let percent: number | undefined;
      const leg = String((ev.payload.current_leg as Record<string, unknown>).target_station_id);
      if (compute === 'old') {
        const lem = JSON.parse(String(row.leg_eta_max ?? '{}')) as Record<string, number>;
        percent = routeProgressFromCurrentLeg({ ...(ev.payload.current_leg as object), leg_eta_max: lem[leg] }, stations);
      } else {
        const next = advanceLegProgress(recallLegProgress(orderId), {
          orderId, stations, report: legReportFromPayload(ev.payload), backendLegDistanceMax: {}, sql: null,
        });
        rememberLegProgress(next);
        percent = next.percent;
      }
      if (percent === undefined) continue;
      const before = shown.get(orderId);
      if (before && before.leg === leg && percent < before.percent - 1) backward.push({ order: orderId, from: before.percent, to: percent });
      if (before && before.leg === leg) maxStep = Math.max(maxStep, Math.abs(percent - before.percent));
      shown.set(orderId, { percent, leg });
    }
    return { backward, maxStep };
  }

  it('舊算法（ETA 比值＋SQL 分母）同一段內會突然大跳；新算法同一段只往前、沒有大跳', () => {
    const old = run('old');
    const now = run('new');
    // 舊：分母還沒進 SQL 時停在這一段起點，下一輪刷新後一次跳到接近終點（實錄 PMS04 往 156：66.7% → 92%）
    expect(old.maxStep).toBeGreaterThan(20);
    expect(now.backward).toEqual([]);
    // 新：步幅反映真實位移（10 倍速、短段會走得快），遠小於舊算法的跳躍
    expect(old.maxStep).toBeGreaterThan(now.maxStep * 1.5);
  });
});
