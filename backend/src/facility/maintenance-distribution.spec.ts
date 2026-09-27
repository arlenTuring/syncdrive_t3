import { buildMaintenanceDistribution, buildVehicleDistribution, plannedYardTasksNow } from './maintenance-distribution';

const shift = {
  shiftId: 'S1',
  shiftName: '班表',
  body: {
    maintenanceTaskId: 'MT-1',
    maintenanceSectionEnabled: { charging: true, carWash: true, maintenance: true, preTrip: true, mobile: true },
    maintenanceSectionCardLabelBySection: { charging: '充電', carWash: '洗車', maintenance: '保養', preTrip: '行檢', mobile: '待命' },
    maintenanceSectionCodeBySection: { charging: 'E', carWash: 'W', maintenance: 'M', preTrip: 'P', mobile: 'S' },
  },
};
const maintenanceBody = {
  charging: { equipmentRows: [{ mapCode: 'E2' }, { mapCode: 'E1' }] },
  carWash: { equipmentRows: [{ mapCode: 'W1' }] },
  maintenance: { equipmentRows: [{ mapCode: 'M3' }] },
  preTrip: { equipmentRows: [{ mapCode: 'M1' }] },
  // 待命清單也列了正線月台：那不是格位，不能出現在整備分佈
  mobile: { equipmentRows: [{ mapCode: 'M1' }, { mapCode: 'D1' }, { mapCode: 'N2W下行出發' }, { mapCode: 'E1' }] },
};
const facilities = [
  { mapCode: 'E1', equipmentId: '147' },
  { mapCode: 'E2', equipmentId: '148' },
  { mapCode: 'W1', equipmentId: '151' },
  { mapCode: 'M1', equipmentId: '145' },
  { mapCode: 'M3', equipmentId: '142' },
  { mapCode: 'D1', equipmentId: '132' },
];

function build(
  vehicleLocations: Array<{ vehicleCode: string; facilityId: string }>,
  currentTasks: Array<{ vehicleCode: string; taskType: string | null; cardLabel?: string | null }> = [],
) {
  return buildMaintenanceDistribution({ shift, maintenanceBody, facilities, vehicleLocations, currentTasks });
}

describe('buildMaintenanceDistribution', () => {
  it('類別與名稱跟著部署班表；格位只留地圖上有的設施，依代號自然排序', () => {
    const result = build([]);
    expect(result.categories.map((c) => c.label)).toEqual(['充電', '洗車', '保養', '行檢', '待命']);
    expect(result.categories[0]!.slots.map((s) => s.code)).toEqual(['E1', 'E2']);
    expect(result.categories[4]!.slots.map((s) => s.code)).toEqual(['D1', 'E1', 'M1']);
    expect(result.headerLine).toBe('0 / 5');
  });

  it('車停在格位裡：亮在它正在做的整備那一類，數字與標題跟著算', () => {
    const result = build(
      [{ vehicleCode: 'PMS01', facilityId: '147' }, { vehicleCode: 'PMS02', facilityId: '151' }],
      [{ vehicleCode: 'PMS01', taskType: 'charging' }, { vehicleCode: 'PMS02', taskType: 'washing' }],
    );
    const charging = result.categories.find((c) => c.key === 'charging')!;
    const mobile = result.categories.find((c) => c.key === 'mobile')!;
    expect(charging.slots.find((s) => s.code === 'E1')).toMatchObject({ occupied: true, vehicleCode: 'PMS01' });
    expect(mobile.slots.find((s) => s.code === 'E1')!.occupied).toBe(false);
    expect(charging.occupiedCount).toBe(1);
    expect(result.headerLine).toBe('2 / 5');
  });

  it('沒有進行中的整備：這一格待命可停就算待命', () => {
    const result = build([{ vehicleCode: 'PMS03', facilityId: '145' }]);
    expect(result.categories.find((c) => c.key === 'mobile')!.occupiedCount).toBe(1);
    expect(result.categories.find((c) => c.key === 'preTrip')!.occupiedCount).toBe(0);
  });

  it('停用的區塊不出現；沒有部署班表時如實回報', () => {
    const disabled = buildMaintenanceDistribution({
      shift: { ...shift, body: { ...shift.body, maintenanceSectionEnabled: { ...shift.body.maintenanceSectionEnabled, carWash: false } } },
      maintenanceBody, facilities, vehicleLocations: [], currentTasks: [],
    });
    expect(disabled.categories.map((c) => c.key)).not.toContain('carWash');
    const none = buildMaintenanceDistribution({ shift: null, maintenanceBody: null, facilities, vehicleLocations: [], currentTasks: [] });
    expect(none.categories).toEqual([]);
    expect(none.message).toBe('目前沒有部署中的班表');
  });

  it('舊訂單沒有任務類型：用卡片名稱對回區塊；沒有訂單時看班表此刻排的整備', () => {
    const byLabel = build(
      [{ vehicleCode: 'PMS01', facilityId: '145' }],
      [{ vehicleCode: 'PMS01', taskType: null, cardLabel: '行檢' }],
    );
    expect(byLabel.categories.find((c) => c.key === 'preTrip')!.occupiedCount).toBe(1);

    const planned = buildMaintenanceDistribution({
      shift, maintenanceBody, facilities,
      vehicleLocations: [{ vehicleCode: 'PMS01', facilityId: '147' }],
      currentTasks: [],
      plannedTasks: [{ vehicleCode: 'PMS01', taskType: 'charging' }],
    });
    expect(planned.categories.find((c) => c.key === 'charging')!.occupiedCount).toBe(1);
    expect(planned.categories.find((c) => c.key === 'mobile')!.occupiedCount).toBe(0);
  });
});

describe('plannedYardTasksNow', () => {
  it('時間線第 N 列對車隊排序後第 N 台；只取此刻的整備卡，跨午夜的卡也算', () => {
    const body = {
      scheduleOutput: {
        plan: {
          timelines: [
            { row: 1, blocks: [{ taskType: 'charging', plannedStartMinute: 600, plannedEndMinute: 660 }] },
            { row: 2, blocks: [{ taskType: 'passenger', plannedStartMinute: 600, plannedEndMinute: 660 }] },
            { row: 3, blocks: [{ taskType: 'standby', plannedStartMinute: 1400, plannedEndMinute: 1500 }] },
          ],
        },
      },
    };
    // 台北 10:30（UTC 02:30）
    const at1030 = Date.UTC(2026, 8, 27, 2, 30);
    expect(plannedYardTasksNow(body, ['PMS03', 'PMS01', 'PMS02'], at1030)).toEqual([
      { vehicleCode: 'PMS01', taskType: 'charging' },
    ]);
    // 台北 00:30：第 3 列 23:20–25:00 的待命延續到今天
    const at0030 = Date.UTC(2026, 8, 26, 16, 30);
    expect(plannedYardTasksNow(body, ['PMS01', 'PMS02', 'PMS03'], at0030)).toEqual([
      { vehicleCode: 'PMS03', taskType: 'standby' },
    ]);
  });
});

describe('buildVehicleDistribution', () => {
  it('正線訂單＝營運中、空車移動與整備＝整備中、待命訂單＝待命中；沒有訂單時看整備分佈', () => {
    const maintenance = build(
      [{ vehicleCode: 'PMS05', facilityId: '147' }, { vehicleCode: 'PMS06', facilityId: '132' }],
      [],
    );
    // PMS05 停在 E1、沒有訂單 → 班表也沒排 → 待命清單有 E1 → 待命；改用班表排的充電
    const withPlan = buildMaintenanceDistribution({
      shift, maintenanceBody, facilities,
      vehicleLocations: [{ vehicleCode: 'PMS05', facilityId: '147' }, { vehicleCode: 'PMS06', facilityId: '132' }],
      currentTasks: [],
      plannedTasks: [{ vehicleCode: 'PMS05', taskType: 'charging' }],
    });
    const rows = buildVehicleDistribution({
      fleetCodes: ['PMS01', 'PMS02', 'PMS03', 'PMS04', 'PMS05', 'PMS06'],
      processingOrders: [
        { vehicleCode: 'PMS01', lineKind: 'MAINLINE', kind: 'passenger', taskType: null, cardLabel: null },
        { vehicleCode: 'PMS02', lineKind: 'MAINTENANCE', kind: 'movement', taskType: null, cardLabel: null },
        { vehicleCode: 'PMS03', lineKind: 'MAINTENANCE', kind: 'maintenance', taskType: 'standby', cardLabel: '待命' },
        { vehicleCode: 'PMS04', lineKind: 'MAINTENANCE', kind: 'maintenance', taskType: null, cardLabel: '洗車' },
      ],
      maintenance: withPlan,
    });
    expect(rows).toEqual([
      { status_code: 'IN_SERVICE', pct: 16.7, vehicle_count: 1 },
      { status_code: 'MAINTENANCE', pct: 50, vehicle_count: 3 },
      { status_code: 'STANDBY', pct: 33.3, vehicle_count: 2 },
    ]);
    // 沒有班表計畫時，停在 E1 的車算待命
    const standbyOnly = buildVehicleDistribution({ fleetCodes: ['PMS05'], processingOrders: [], maintenance });
    expect(standbyOnly).toEqual([{ status_code: 'STANDBY', pct: 100, vehicle_count: 1 }]);
  });
});
