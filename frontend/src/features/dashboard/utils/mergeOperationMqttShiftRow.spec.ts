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
});
