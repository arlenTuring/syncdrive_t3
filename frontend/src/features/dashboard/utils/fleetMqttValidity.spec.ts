import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FLEET_MQTT_STALE_AFTER_MS, isFleetEntryExpired, judgeFleetMessage, payloadTimestampMs } from './fleetMqttValidity';
import { mergeMainlineShiftRoster, mergeMaintenanceShiftRoster } from './mergeShiftRosterRows';

const NOW = 1_790_000_000_000;

describe('車隊 MQTT 有效性', () => {
  it('時間戳：秒、毫秒、ISO 都看得懂', () => {
    assert.equal(payloadTimestampMs({ timestamp: NOW }), NOW);
    assert.equal(payloadTimestampMs({ timestamp: NOW / 1000 }), NOW);
    assert.equal(payloadTimestampMs({ updated_at: new Date(NOW).toISOString() }), NOW);
    assert.equal(payloadTimestampMs({}), null);
  });

  it('重置前產生的訊息不收', () => {
    const verdict = judgeFleetMessage({ payload: { timestamp: NOW - 1000 }, receivedAt: NOW, resetAt: NOW - 500, lastTimestamp: null });
    assert.deepEqual(verdict, { accept: false, reason: 'before-reset' });
  });

  it('retain 補送的舊快照（遠早於收到時間）不收', () => {
    const verdict = judgeFleetMessage({ payload: { timestamp: NOW - 3_600_000 }, receivedAt: NOW, resetAt: 0, lastTimestamp: null });
    assert.deepEqual(verdict, { accept: false, reason: 'old-snapshot' });
  });

  it('同一時間戳重送不算新訊息（不會刷新有效期限）', () => {
    const verdict = judgeFleetMessage({ payload: { timestamp: NOW - 100 }, receivedAt: NOW, resetAt: 0, lastTimestamp: NOW - 100 });
    assert.deepEqual(verdict, { accept: false, reason: 'retained-duplicate' });
  });

  it('新訊息收下', () => {
    const verdict = judgeFleetMessage({ payload: { timestamp: NOW - 100 }, receivedAt: NOW, resetAt: NOW - 5000, lastTimestamp: NOW - 1100 });
    assert.deepEqual(verdict, { accept: true, timestamp: NOW - 100 });
  });

  it('超過期限就過期；從沒收過也算無效', () => {
    assert.equal(isFleetEntryExpired(NOW - FLEET_MQTT_STALE_AFTER_MS + 1, NOW), false);
    assert.equal(isFleetEntryExpired(NOW - FLEET_MQTT_STALE_AFTER_MS - 1, NOW), true);
    assert.equal(isFleetEntryExpired(undefined, NOW), true);
  });
});

describe('SQL＋MQTT 合併：SQL 決定卡片，MQTT 只更新同一張單', () => {
  const live = (orderId: string, vehicle: string) => ({
    order_id: orderId, vehicle_code: vehicle, trip_code: 'D0830', order_status: 'RUNNING',
  });

  it('SQL 沒有訂單：MQTT 再多也是 0 張', () => {
    const mqtt = new Map([['PMS01', live('ORD-OLD', 'PMS01')]]);
    assert.deepEqual(mergeMainlineShiftRoster([], mqtt), []);
    assert.deepEqual(mergeMaintenanceShiftRoster([], mqtt), []);
  });

  it('同車不同單：上一班的回報不套到下一班', () => {
    const sqlRow = { shift_key: 'ORD-NEW', order_id: 'ORD-NEW', vehicle_code: 'PMS01', trip_code: 'D0900', status_label: '待發' };
    const mqtt = new Map([['PMS01', live('ORD-OLD', 'PMS01')]]);
    const [row] = mergeMainlineShiftRoster([sqlRow], mqtt);
    assert.equal(row, sqlRow);
    assert.equal(row.shift_key, 'ORD-NEW');
    assert.equal(row.trip_code, 'D0900');
  });

  it('同一張單：用回報更新欄位，列數不變；訂單狀態仍是 SQL 的（MQTT 不改狀態）', () => {
    const sqlRow = { shift_key: 'ORD-1', order_id: 'ORD-1', vehicle_code: 'PMS01', trip_code: 'D0830', line_kind: 'MAINLINE', order_status: 'PROCESSING' };
    const mqtt = new Map([['PMS01', { ...live('ORD-1', 'PMS01'), vehicle_phase: 'TRANSITING', current_leg: { eta_seconds: 30 } }]]);
    const rows = mergeMainlineShiftRoster([sqlRow], mqtt);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0], sqlRow);
    assert.equal(rows[0].order_status, 'PROCESSING');
  });

  it('套不套回報只看單號，D0830 與 NT0830 一樣', () => {
    for (const trip of ['D0830', 'NT0830', 'MT-E3-R7-5400']) {
      const sqlRow = { shift_key: 'ORD-1', order_id: 'ORD-1', vehicle_code: 'PMS01', trip_code: trip, line_kind: 'MAINLINE', order_status: 'PROCESSING' };
      const mqtt = new Map([['PMS01', { order_id: 'ORD-1', vehicle_code: 'PMS01', trip_code: trip, vehicle_phase: 'TRANSITING' }]]);
      const [row] = mergeMainlineShiftRoster([sqlRow], mqtt);
      assert.notEqual(row, sqlRow, `${trip} 的回報要套用`);
    }
  });

  it('SQL 有單、沒有回報：原樣顯示，不補假回報', () => {
    const sqlRow = { shift_key: 'ORD-2', vehicle_code: 'PMS02', trip_code: 'D1000' };
    assert.deepEqual(mergeMainlineShiftRoster([sqlRow], new Map()), [sqlRow]);
  });
});
