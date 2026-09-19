import type { TimetableTripDto } from '../operation-shift/timetable/expand-timetable';
import {
  buildOrderId,
  dispatchDecision,
  localMidnight,
  planDispatches,
  vehicleForRow,
} from './dispatch.plan';

const FLEET = ['PMS01', 'PMS02', 'PMS03'];

function trip(overrides: Partial<TimetableTripDto> = {}): TimetableTripDto {
  return {
    trip_code: 'A01-0800',
    block_id: 'block-1',
    timeline_row: 1,
    task_type: 'passenger',
    label: null,
    card_label: '環線 A',
    source: 'plan',
    route_id: 'route-a',
    route_code: 'A01',
    route_name: '正線去程',
    card_start: '08:00:00',
    card_end: '08:30:00',
    card_start_second: 8 * 3600,
    card_end_second: 8 * 3600 + 1800,
    stations: [
      {
        order: 1,
        station_id: 'st-1',
        station_name: '起站',
        role: 'origin',
        arrival: null,
        departure: '08:00:00',
        dwell_complete: '08:00:00',
        base_dwell_seconds: 0,
        dwell_seconds: 0,
        travel_to_next_seconds: 1800,
      },
      {
        order: 2,
        station_id: 'st-2',
        station_name: '終站',
        role: 'destination',
        arrival: '08:30:00',
        departure: null,
        dwell_complete: '08:31:00',
        base_dwell_seconds: 60,
        dwell_seconds: 60,
        travel_to_next_seconds: null,
      },
    ],
    ...overrides,
  } as TimetableTripDto;
}

/** 2026-08-26 當地時間，用當地零點推出來，避免測試綁死時區 */
const REFERENCE = new Date(2026, 7, 26, 12, 0, 0).getTime();
const MIDNIGHT = localMidnight(REFERENCE);

describe('vehicleForRow', () => {
  it('第 N 列對到第 N 台', () => {
    expect(vehicleForRow(1, FLEET)).toBe('PMS01');
    expect(vehicleForRow(3, FLEET)).toBe('PMS03');
  });

  it('列號超過車隊台數時回 null——寧可少一班，不要兩列共用一台', () => {
    expect(vehicleForRow(4, FLEET)).toBeNull();
  });

  it('列號不合法時回 null', () => {
    expect(vehicleForRow(0, FLEET)).toBeNull();
    expect(vehicleForRow(-1, FLEET)).toBeNull();
    expect(vehicleForRow(1.5, FLEET)).toBeNull();
  });
});

describe('buildOrderId（協議 §三）', () => {
  it('YYMMDD-tripCode，日期取發車日', () => {
    expect(
      buildOrderId('A01-0800', new Date(2026, 7, 26, 8, 0).getTime()),
    ).toBe('260826-A01-0800');
  });

  it('跨午夜的班次落在實際發車那一天，不是班表起始日', () => {
    // 班表第 25 小時 = 隔天 01:00
    const departAt = MIDNIGHT + 25 * 3600 * 1000;
    expect(buildOrderId('A01-0100', departAt)).toBe('260827-A01-0100');
  });
});

describe('planDispatches', () => {
  it('把班次換算成絕對時刻的待下訂單', () => {
    const { planned } = planDispatches({
      trips: [trip()],
      fleet: FLEET,
      taskTypes: ['passenger'],
      reference: REFERENCE,
    });

    expect(planned).toHaveLength(1);
    const item = planned[0];
    expect(item.orderId).toBe('260826-A01-0800');
    expect(item.vehicleCode).toBe('PMS01');
    expect(item.cardLabel).toBe('環線 A');
    expect(item.departAt).toBe(MIDNIGHT + 8 * 3600 * 1000);
    expect(item.arriveAt).toBe(MIDNIGHT + (8 * 3600 + 1800) * 1000);
  });

  it('起訖點就是首末站，車端靠這兩點自己規劃路徑', () => {
    const { planned } = planDispatches({
      trips: [trip()],
      fleet: FLEET,
      taskTypes: ['passenger'],
      reference: REFERENCE,
    });

    expect(planned[0].origin?.name).toBe('起站');
    expect(planned[0].origin?.departAt).toBe(MIDNIGHT + 8 * 3600 * 1000);
    expect(planned[0].destination?.name).toBe('終站');
    expect(planned[0].destination?.arriveAt).toBe(
      MIDNIGHT + (8 * 3600 + 1800) * 1000,
    );
  });

  it('末站沒有 departure 時改用 dwell_complete', () => {
    const { planned } = planDispatches({
      trips: [trip()],
      fleet: FLEET,
      taskTypes: ['passenger'],
      reference: REFERENCE,
    });

    expect(planned[0].destination?.departAt).toBe(
      MIDNIGHT + (8 * 3600 + 1860) * 1000,
    );
  });

  it('不在 taskTypes 內的任務不下訂單', () => {
    const { planned, skipped } = planDispatches({
      trips: [trip({ task_type: 'charging', trip_code: 'CHG-1' })],
      fleet: FLEET,
      taskTypes: ['passenger'],
      reference: REFERENCE,
    });

    expect(planned).toHaveLength(0);
    // 整備任務是「本來就不發」，不算被跳過的異常
    expect(skipped).toHaveLength(0);
  });

  it('列號超出車隊時記進 skipped 而不是靜默消失', () => {
    const { planned, skipped } = planDispatches({
      trips: [trip({ timeline_row: 9, trip_code: 'A09-0800' })],
      fleet: FLEET,
      taskTypes: ['passenger'],
      reference: REFERENCE,
    });

    expect(planned).toHaveLength(0);
    expect(skipped).toEqual([
      {
        tripCode: 'A09-0800',
        reason: '時間線第 9 列沒有對應車輛（車隊只有 3 台）',
      },
    ]);
  });

  it('依發車時刻排序', () => {
    const { planned } = planDispatches({
      trips: [
        trip({ trip_code: 'LATE', card_start_second: 10 * 3600 }),
        trip({ trip_code: 'EARLY', card_start_second: 6 * 3600 }),
      ],
      fleet: FLEET,
      taskTypes: ['passenger'],
      reference: REFERENCE,
    });

    expect(planned.map((item) => item.tripCode)).toEqual(['EARLY', 'LATE']);
  });

  it('跨午夜班次（秒數 > 86400）換算成隔天的絕對時刻', () => {
    const { planned } = planDispatches({
      trips: [trip({ trip_code: 'A01-0100', card_start_second: 25 * 3600 })],
      fleet: FLEET,
      taskTypes: ['passenger'],
      reference: REFERENCE,
    });

    const departAt = new Date(planned[0].departAt);
    expect(departAt.getDate()).toBe(27);
    expect(departAt.getHours()).toBe(1);
  });
});

describe('dispatchDecision', () => {
  const base = { leadSeconds: 90, catchUpSeconds: 300 };
  const now = REFERENCE;

  it('離發車還久 → 等', () => {
    expect(dispatchDecision({ ...base, now, departAt: now + 600_000 })).toBe(
      'wait',
    );
  });

  it('進入提前量 → 下訂單', () => {
    expect(dispatchDecision({ ...base, now, departAt: now + 60_000 })).toBe(
      'dispatch',
    );
  });

  it('剛好在提前量邊界上 → 下訂單', () => {
    expect(dispatchDecision({ ...base, now, departAt: now + 90_000 })).toBe(
      'dispatch',
    );
  });

  it('已經過了發車時刻但還在補發窗口 → 補發', () => {
    expect(dispatchDecision({ ...base, now, departAt: now - 120_000 })).toBe(
      'dispatch',
    );
  });

  it('過太久 → 這班不用跑了', () => {
    expect(dispatchDecision({ ...base, now, departAt: now - 600_000 })).toBe(
      'expired',
    );
  });
});
