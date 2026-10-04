import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeOperationMqttShiftRow } from './mergeOperationMqttShiftRow';

describe('mergeOperationMqttShiftRow', () => {
  it('過渡單（待命）帶著格位與整備徽章，收到車端即時資料後仍是正線／過渡卡，不變成整備卡', () => {
    const row = mergeOperationMqttShiftRow(
      { shift_key: 'SIM-1', trip_code: 'MT-E3-R7-5400', line_kind: 'transition', direction_label: '過渡', maint_type_label: '充電' },
      { order_id: 'SIM-1', trip_code: 'MT-E3-R7-5400', maint_type_label: '充電' },
    );
    assert.notEqual(String(row.line_kind).toUpperCase(), 'MAINTENANCE');
    assert.equal(row.direction_label, '過渡');
  });

  it('整備單照舊走整備卡', () => {
    const row = mergeOperationMqttShiftRow(
      { shift_key: 'SIM-2', trip_code: 'MT-M1-R3-5460', line_kind: 'maintenance', maint_type_label: '行檢' },
      { order_id: 'SIM-2', trip_code: 'MT-M1-R3-5460', maint_type_label: '行檢' },
    );
    assert.equal(String(row.line_kind).toUpperCase(), 'MAINTENANCE');
  });

  it('待發的單收到行駛中回報：卡片仍是待發（開始只認 REST），D1234 與 NT0000 一樣', () => {
    for (const trip of ['D1234', 'NT0000']) {
      const row = mergeOperationMqttShiftRow(
        { shift_key: 'ORD-9', order_id: 'ORD-9', trip_code: trip, line_kind: 'mainline', business_kind: 'MAINLINE', order_status: 'PENDING' },
        { order_id: 'ORD-9', trip_code: trip, vehicle_phase: 'TRANSITING', order_status: 'PROCESSING', current_leg: { eta_seconds: 40 } },
      );
      assert.equal(row.order_status, 'PENDING', trip);
    }
  });

  it('業務分類看 SQL 的 business_kind，不看班次代號：D 開頭的整備單仍是整備卡', () => {
    const row = mergeOperationMqttShiftRow(
      { shift_key: 'ORD-M', trip_code: 'D1234', business_kind: 'MAINTENANCE', line_kind: 'MAINTENANCE', maint_type_label: '充電' },
      { order_id: 'ORD-M', trip_code: 'D1234' },
    );
    assert.equal(String(row.line_kind).toUpperCase(), 'MAINTENANCE');
  });
});
