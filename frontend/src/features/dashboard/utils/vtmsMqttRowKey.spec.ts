import { describe, expect, it } from 'vitest';
import { operationRowKey } from './vtmsMqttRowKey';

describe('operationRowKey', () => {
  it('只有距離在變（倍速下 ETA 整數秒相同）也算新內容，不能被去重丟掉', () => {
    const base = { vehicle_code: 'PMS03', order_id: 'O1', current_leg: { target_station_id: '156', eta_seconds: 4, distance_to_target_m: 300 } };
    const moved = { ...base, current_leg: { ...base.current_leg, distance_to_target_m: 260 } };
    expect(operationRowKey(moved)).not.toBe(operationRowKey(base));
    // 停站時內容完全一樣才去重
    expect(operationRowKey({ ...base, timestamp: 2 })).toBe(operationRowKey({ ...base, timestamp: 1 }));
  });
});
