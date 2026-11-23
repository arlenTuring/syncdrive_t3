import { describe, expect, it } from 'vitest';
import type { ShiftRecordDetail } from '../api/shiftRecordsApi';
import { buildDrivingCapabilityModel } from './buildDrivingCapabilityModel';

const T = Date.UTC(2026, 10, 22, 19, 15, 30); // 2026-11-23 03:15:30 台北

function detail(overrides: Partial<ShiftRecordDetail>): ShiftRecordDetail {
  return {
    order_id: '261123-OT040315',
    trip_code: 'OT040315',
    vehicle_code: 'PMS04',
    line_kind: 'TRANSITION',
    order_status: 'END',
    execution_status: 'completed',
    execution_status_label: '已完成',
    route_label: '出場移動 · NWU → NWU',
    depart_time: null,
    end_time: null,
    delay_minutes: 0,
    planned_start: String(T),
    planned_end: String(T),
    completed_at: String(T + 4_000),
    payload: null,
    actions: [],
    task_group: [],
    vehicle_phase: null,
    current_leg: null,
    ...overrides,
  } as ShiftRecordDetail;
}

describe('運行紀錄：0 秒的過渡單（2026-11-23 OT040315 NWU → NWU）', () => {
  it('照車端實際完成時刻算總時長，不補成 6 分鐘；起訖同一處寫「原地，不移動」', () => {
    const model = buildDrivingCapabilityModel(detail({}));
    expect(model.durationSeconds).toBe(4);
    expect(model.statusSegments).toHaveLength(1);
    expect(model.statusSegments[0].label).toBe('原地，不移動');
  });

  it('有移動、沒有站點動作的單照舊寫「行駛中」', () => {
    const model = buildDrivingCapabilityModel(detail({ route_label: 'E3 → NWD', planned_end: String(T + 300_000), completed_at: String(T + 310_000) }));
    expect(model.statusSegments[0].label).toBe('行駛中');
    expect(model.durationSeconds).toBe(310);
  });
});
