import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardMessage,
  cardRows,
  cardScale,
  directionOf,
  eventStatus,
  formatCountdown,
  nextTickDelay,
  placeLabel,
  rowTag,
  stationEtaUrl,
  visibleEvents,
  type StationEtaResponse,
  type StationEvent,
} from './stationEtaModel';

const NOW = 1_000_000_000;
const ev = (over: Partial<StationEvent>): StationEvent => ({
  key: 'k', row_key: 'r', event: 'arrive', vehicle_code: 'PMS01', trip_code: 'ST1', station_id: 't3_u', station_name: 'T3上行',
  task_label: '上行', at: NOW + 60_000, kind: 'live', at_station: false, time_state: 'countdown', ...over,
});
const resp = (events: StationEvent[], over: Partial<StationEtaResponse> = {}): StationEtaResponse => ({
  plan: { shift_name: '正線' }, stations: [{ station_id: 'x', state: 'ok', events, stale_vehicles: [] }], ...over,
});

describe('到站動態卡片：倒數格式', () => {
  it('分:秒剩餘倒數，總分鐘不取模、不提早歸零', () => {
    assert.equal(formatCountdown(549_000), '09:09');
    assert.equal(formatCountdown(60_000), '01:00');
    assert.equal(formatCountdown(1_000), '00:01');
    assert.equal(formatCountdown(1), '00:01');
    assert.equal(formatCountdown(0), '00:00');
    assert.equal(formatCountdown(-5_000), '00:00');
    assert.equal(formatCountdown(3_600_000), '60:00');
    assert.equal(formatCountdown(7_205_000), '120:05');
  });

  it('每個 tick 用 at − 營運時間重算：09:09 → 09:08 → 09:07 → 09:06；跳過 20 秒直接正確；暫停不動；校正可回升', () => {
    const at = NOW + 549_000;
    assert.deepEqual([0, 1, 2, 3].map((s) => formatCountdown(at - (NOW + s * 1000))), ['09:09', '09:08', '09:07', '09:06']);
    assert.equal(formatCountdown(at - (NOW + 20_000)), '08:49');
    assert.equal(formatCountdown(at - NOW), formatCountdown(at - NOW));
    assert.equal(formatCountdown(at + 30_000 - (NOW + 3_000)), '09:36');
  });

  it('下一次重畫時間：跟著數字跳的時刻走；倍速換算；暫停每秒看一次', () => {
    assert.equal(nextTickDelay([NOW + 549_000], NOW, 1, true), 1000);
    assert.equal(nextTickDelay([NOW + 549_300], NOW, 1, true), 305);
    assert.equal(nextTickDelay([NOW + 549_300], NOW, 10, true), 100);
    assert.equal(nextTickDelay([NOW + 549_300], NOW, 1, false), 1000);
    assert.equal(nextTickDelay([], NOW, 1, true), 1000);
  });
});

describe('到站動態卡片：狀態與方向', () => {
  it('即時 60 秒內即將到站；遠的是到站倒數；歸零不算已到站；計畫值快到了也不說即將到站', () => {
    assert.deepEqual(eventStatus(ev({ at: NOW + 59_000 }), NOW), { text: '即將到站', tone: 'normal' });
    assert.deepEqual(eventStatus(ev({ at: NOW + 300_000 }), NOW), { text: '到站倒數', tone: 'normal' });
    assert.deepEqual(eventStatus(ev({ at: NOW + 30_000, kind: 'plan' }), NOW), { text: '到站倒數', tone: 'normal' });
    assert.deepEqual(eventStatus(ev({ at: NOW - 10_000 }), NOW), { text: '即將到站', tone: 'normal' });
  });

  it('卡片不畫誤點／延誤與即時／計畫：延誤 135 分、overdue 的車照樣只顯示動作；車端資料過期改說資料中斷', () => {
    const late = [
      ev({ at: NOW + 300_000, delay_seconds: 8100, kind: 'live', time_state: 'overdue' }),
      ev({ at: NOW + 30_000, delay_seconds: 7740, kind: 'live' }),
      ev({ at: NOW + 400_000, delay_seconds: 7740, kind: 'plan' }),
    ];
    const texts = late.flatMap((e) => [eventStatus(e, NOW).text, rowTag(e)?.text ?? '']).join('|');
    assert.doesNotMatch(texts, /延誤|誤點|晚點|即時|計畫|\d+ ?分/);
    assert.deepEqual(late.map((e) => eventStatus(e, NOW).text), ['到站倒數', '即將到站', '到站倒數']);
    assert.deepEqual(eventStatus(ev({ kind: 'plan', time_state: 'stale' }), NOW), { text: '資料中斷', tone: 'stale' });
  });

  it('出發：停靠中倒數、時間到即將出發（拖再久也不標延誤），不會說成到站', () => {
    const dep = (at: number) => ev({ event: 'depart', at_station: true, at });
    assert.equal(eventStatus(dep(NOW + 42_000), NOW).text, '停靠中 出發倒數');
    assert.equal(eventStatus(dep(NOW - 5_000), NOW).text, '即將出發');
    assert.equal(eventStatus(dep(NOW - 600_000), NOW).text, '即將出發');
  });

  it('後續列只標出發與資料中斷；到站不另外標', () => {
    assert.equal(rowTag(ev({ at: NOW + 30_000 })), null);
    assert.equal(rowTag(ev({ at: NOW + 300_000, delay_seconds: 120 })), null);
    assert.deepEqual(rowTag(ev({ event: 'depart', at_station: true, at: NOW + 60_000 })), { text: '出發', tone: 'normal' });
    assert.deepEqual(rowTag(ev({ event: 'depart', at_station: true, at: NOW - 120_000 })), { text: '出發', tone: 'normal' });
    assert.deepEqual(rowTag(ev({ kind: 'plan', time_state: 'stale' })), { text: '資料中斷', tone: 'stale' });
  });

  it('卡片比例：320×256、字級 12 是設計稿 1×；寬或高不足取小的，卡片較寬不放大字', () => {
    assert.equal(cardScale(320, 256, 12), 1);
    assert.equal(cardScale(160, 256, 12), 0.5);
    assert.equal(cardScale(600, 129, 12), 0.5);
    assert.equal(cardScale(320, 256, 18), 1.5);
    assert.equal(cardScale(320, 280, undefined), 1);
  });

  it('方向只看 task_label；判不出來不猜', () => {
    assert.equal(directionOf({ task_label: '上行' }), 'up');
    assert.equal(directionOf({ task_label: '下行' }), 'down');
    assert.equal(directionOf({ task_label: '整備' }), null);
    assert.equal(directionOf({}), null);
  });

  it('方向／停靠點文字：屬性填的名稱優先，否則後端站名；名稱沒帶上／下才補', () => {
    assert.equal(placeLabel(ev({}), [{ stationId: 't3_u', label: 't3_u' }]), 'T3上行');
    assert.equal(placeLabel(ev({ station_id: 'n2w_d_end', station_name: 'NW上停1' }), []), 'NW上停1');
    assert.equal(placeLabel(ev({ station_id: 't3_u', station_name: 'T3' }), []), 'T3 上行');
    assert.equal(placeLabel(ev({}), [{ stationId: 't3_u', label: 'T3 月台A' }]), 'T3 月台A 上行');
  });
});

describe('到站動態卡片：列與空狀態', () => {
  it('排序穩定、同一次停靠不重複、同車不同停靠保留、筆數上限', () => {
    const rows = visibleEvents(resp([
      ev({ key: 'b', row_key: 'r2', at: NOW + 90_000 }),
      ev({ key: 'a', row_key: 'r1', at: NOW + 90_000 }),
      ev({ key: 'a-dup', row_key: 'r1', at: NOW + 95_000 }),
      ev({ key: 'c', row_key: 'r3', at: NOW + 30_000 }),
      ev({ key: 'd', row_key: 'r4', at: NOW + 500_000 }),
    ]), NOW, 3);
    assert.deepEqual(rows.map((r) => r.key), ['c', 'a', 'b']);
  });

  it('延誤的即時事件不因前端 30 秒門檻消失；過期的計畫值拿掉；停靠中的出發保留', () => {
    const rows = visibleEvents(resp([
      ev({ key: 'live-late', row_key: '1', at: NOW - 120_000, kind: 'live' }),
      ev({ key: 'plan-old', row_key: '2', at: NOW - 31_000, kind: 'plan' }),
      ev({ key: 'plan-recent', row_key: '3', at: NOW - 10_000, kind: 'plan' }),
      ev({ key: 'dwell', row_key: '4', event: 'depart', at_station: true, at: NOW - 600_000, kind: 'live' }),
    ]), NOW, 10);
    assert.deepEqual(rows.map((r) => r.key).sort(), ['dwell', 'live-late', 'plan-recent']);
  });

  it('空、未部署、過期、失敗、未設定各自不同', () => {
    const base = { url: '/x', isEditMode: false, loading: false, error: null, rows: 0 };
    assert.equal(cardMessage({ ...base, url: '' , response: null })?.text, '未設定站點');
    assert.equal(cardMessage({ ...base, response: null, loading: true })?.text, '載入中…');
    assert.deepEqual(cardMessage({ ...base, response: null, error: 'HTTP 500' }), { text: '資料載入失敗', tone: 'error', detail: 'HTTP 500' });
    assert.equal(cardMessage({ ...base, response: resp([], { plan: null }) })?.text, '尚未部署每日計畫');
    assert.equal(cardMessage({ ...base, response: { plan: { shift_name: 'x' }, stations: [{ station_id: 'a', state: 'stale', events: [], stale_vehicles: ['PMS01'] }] } })?.text, '車端資料過期');
    assert.equal(cardMessage({ ...base, response: resp([]) })?.text, '暫無資料');
    assert.equal(cardMessage({ ...base, response: resp([ev({})]), rows: 1 }), null);
  });

  it('網址：到站、出發的站點各自帶上；舊設定沒有 events 只列到站', () => {
    const url = stationEtaUrl({
      dataUrl: '/syncdrive-api/operation-metrics/station-eta',
      limit: 3,
      stations: [
        { stationId: 'n2w_d_end', label: '上行停靠', events: ['arrive'] },
        { stationId: 'n2w_d_start', label: '下行出發', events: ['depart'] },
        { stationId: 't3_u', label: '上行', events: ['arrive', 'depart'] },
        { stationId: 's2w_d_end', label: '下行停靠' },
      ],
    });
    assert.equal(url, '/syncdrive-api/operation-metrics/station-eta?arrive=n2w_d_end,t3_u,s2w_d_end&depart=n2w_d_start,t3_u&limit=3');
  });

  it('卡片列：由近到遠最多三列；即將到站才放大；兩班即將到站只排兩列；出發與計畫值不放大', () => {
    const shape = (rows: StationEvent[]) => cardRows(rows, NOW).map((r) => `${r.event.key}${r.big ? '*' : ''}`);
    const a = ev({ key: 'a', at: NOW + 30_000 });
    const b = ev({ key: 'b', at: NOW + 50_000 });
    const c = ev({ key: 'c', at: NOW + 200_000 });
    const d = ev({ key: 'd', at: NOW + 400_000 });
    assert.deepEqual(shape([a, c, d, ev({ key: 'e', at: NOW + 900_000 })]), ['a*', 'c', 'd']);
    assert.deepEqual(shape([c, d, ev({ key: 'e', at: NOW + 900_000 })]), ['c', 'd', 'e']);
    assert.deepEqual(shape([a, b, c]), ['a*', 'b*']);
    assert.deepEqual(shape([ev({ key: 'p', at: NOW + 30_000, kind: 'plan' }), c]), ['p', 'c']);
    assert.deepEqual(shape([ev({ key: 'x', event: 'depart', at_station: true, at: NOW - 5_000 }), a]), ['x', 'a*']);
    assert.deepEqual(shape([a]), ['a*']);
  });
});
