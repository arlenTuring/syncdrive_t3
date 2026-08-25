import {
  dataAgeSeconds,
  resolveArrivalState,
  resolveDataQuality,
  resolveDelayState,
} from './vehicle-eta.derive';

/**
 * 這幾條是<strong>對外承諾的判定規則</strong>——廠商會照規格書第七章寫顯示邏輯，
 * 所以規格書裡列出的每一個判定範例都要在這裡釘住。
 */
describe('resolveArrivalState（規格書 7.7）', () => {
  const base = {
    dataAgeSeconds: 2,
    targetStationId: 'station_4',
    stationId: 'station_4',
  };

  it('時間與距離門檻均成立 → APPROACHING', () => {
    expect(
      resolveArrivalState({ ...base, etaSeconds: 25, distanceM: 120 }),
    ).toBe('APPROACHING');
  });

  it('只有時間門檻成立 → APPROACHING', () => {
    expect(
      resolveArrivalState({ ...base, etaSeconds: 45, distanceM: 350 }),
    ).toBe('APPROACHING');
  });

  it('只有距離門檻成立 → APPROACHING', () => {
    expect(
      resolveArrivalState({ ...base, etaSeconds: 90, distanceM: 180 }),
    ).toBe('APPROACHING');
  });

  it('兩項門檻均未成立 → EN_ROUTE', () => {
    expect(
      resolveArrivalState({ ...base, etaSeconds: 415, distanceM: 1840 }),
    ).toBe('EN_ROUTE');
  });

  it('資料逾時 → UNKNOWN，且蓋過任務狀態', () => {
    expect(
      resolveArrivalState({
        ...base,
        dataAgeSeconds: 120,
        etaSeconds: 5,
        distanceM: 10,
        taskGroup: [{ task_name: 'OPEN_DOORS', status: 'COMPLETED' }],
      }),
    ).toBe('UNKNOWN');
  });

  it('缺少目標站資訊 → UNKNOWN', () => {
    expect(
      resolveArrivalState({
        ...base,
        targetStationId: null,
        etaSeconds: 25,
        distanceM: 120,
      }),
    ).toBe('UNKNOWN');
  });

  it('PLATFORM_DOCKING 進行中 → DOCKING', () => {
    expect(
      resolveArrivalState({
        ...base,
        etaSeconds: 5,
        distanceM: 8,
        taskGroup: [{ task_name: 'PLATFORM_DOCKING', status: 'IN_PROGRESS' }],
      }),
    ).toBe('DOCKING');
  });

  it('OPEN_DOORS 完成且尚未關門 → AT_STATION', () => {
    expect(
      resolveArrivalState({
        ...base,
        etaSeconds: 0,
        distanceM: 0,
        taskGroup: [
          { task_name: 'PLATFORM_DOCKING', status: 'COMPLETED' },
          { task_name: 'OPEN_DOORS', status: 'COMPLETED' },
          { task_name: 'CLOSE_DOORS', status: 'PENDING' },
        ],
      }),
    ).toBe('AT_STATION');
  });

  it('STATION_DEPARTURE 完成 → DEPARTED，蓋過先前已完成的開門', () => {
    expect(
      resolveArrivalState({
        ...base,
        etaSeconds: 0,
        distanceM: 0,
        taskGroup: [
          { task_name: 'OPEN_DOORS', status: 'COMPLETED' },
          { task_name: 'CLOSE_DOORS', status: 'COMPLETED' },
          { task_name: 'STATION_DEPARTURE', status: 'COMPLETED' },
        ],
      }),
    ).toBe('DEPARTED');
  });

  it('任務狀態只適用車端當前目標站，不套到別站', () => {
    expect(
      resolveArrivalState({
        dataAgeSeconds: 2,
        targetStationId: 'station_4',
        stationId: 'station_9',
        etaSeconds: 400,
        distanceM: 1800,
        taskGroup: [{ task_name: 'OPEN_DOORS', status: 'COMPLETED' }],
      }),
    ).toBe('EN_ROUTE');
  });
});

describe('resolveDelayState（規格書 7.10 暫定門檻）', () => {
  it.each([
    [-50, 'EARLY'],
    [-30, 'ON_TIME'],
    [15, 'ON_TIME'],
    [60, 'ON_TIME'],
    [130, 'MINOR_DELAY'],
    [180, 'MINOR_DELAY'],
    [290, 'MAJOR_DELAY'],
  ])('delay_seconds=%s → %s', (seconds, expected) => {
    expect(resolveDelayState(seconds)).toBe(expected);
  });

  it('沒有計畫值 → NO_PLAN', () => {
    expect(resolveDelayState(null)).toBe('NO_PLAN');
  });
});

describe('resolveDataQuality（規格書 7.3）', () => {
  it('全部車輛新鮮 → OK', () => {
    expect(resolveDataQuality({ fleetSize: 11, freshCount: 11 })).toBe('OK');
  });

  it('部分逾時 → DEGRADED', () => {
    expect(resolveDataQuality({ fleetSize: 11, freshCount: 10 })).toBe(
      'DEGRADED',
    );
  });

  it('全部逾時或無資料 → DOWN', () => {
    expect(resolveDataQuality({ fleetSize: 11, freshCount: 0 })).toBe('DOWN');
  });

  it('分母是車隊清單而不是有回報的車——全隊失聯不能看起來正常', () => {
    expect(resolveDataQuality({ fleetSize: 0, freshCount: 0 })).toBe('DOWN');
  });
});

describe('dataAgeSeconds（規格書 7.11）', () => {
  it('四捨五入到秒', () => {
    expect(dataAgeSeconds(1786842000000, 1786841998400)).toBe(2);
  });

  it('車端時鐘略快時不給負數', () => {
    expect(dataAgeSeconds(1786842000000, 1786842003000)).toBe(0);
  });
});
