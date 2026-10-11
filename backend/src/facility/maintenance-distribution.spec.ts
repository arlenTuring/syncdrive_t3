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

describe('buildVehicleDistribution（營運分佈）', () => {
  const task = (vehicleCode: string, businessKind: string, taskType: string, servicePurpose: 'operation' | 'maintenance' | 'standby' | null = null, purposeSource: 'order' | 'shift' | null = servicePurpose ? 'order' : null) =>
    ({ vehicleCode, orderId: `O-${vehicleCode}`, tripCode: `T-${vehicleCode}`, businessKind, taskType, servicePurpose, purposeSource });

  it('依任務用途分：正線＝營運、整備＝整備、過渡依服務的用途、沒有有效任務＝待命', () => {
    const rows = buildVehicleDistribution({
      fleetCodes: ['PMS01', 'PMS02', 'PMS03', 'PMS04', 'PMS05', 'PMS06', 'PMS07', 'PMS08'],
      currentTasks: [
        task('PMS01', 'MAINLINE', 'passenger'),
        task('PMS02', 'TRANSITION', 'dispatch', 'operation'), // 出廠，接著跑正線
        task('PMS03', 'TRANSITION', 'idle', 'operation'), // 接班前的必要等待
        task('PMS04', 'TRANSITION', 'dispatch', 'maintenance'), // 入廠去充電
        task('PMS05', 'MAINTENANCE', 'charging'),
        task('PMS06', 'TRANSITION', 'idle', 'maintenance', 'shift'), // 舊單：用途由班表補算
        task('PMS07', 'TRANSITION', 'standby', 'standby'),
        // PMS08：此刻沒有有效任務（就算整天的單都預先建好也不算營運）
      ],
    });
    expect(rows.map((row) => [row.status_code, row.vehicle_count, row.vehicles.map((v) => v.vehicle_code)])).toEqual([
      ['IN_SERVICE', 3, ['PMS01', 'PMS02', 'PMS03']],
      ['MAINTENANCE', 3, ['PMS04', 'PMS05', 'PMS06']],
      ['STANDBY', 2, ['PMS07', 'PMS08']],
    ]);
    expect(rows.reduce((sum, row) => sum + row.vehicle_count, 0)).toBe(8);
    expect(rows[1].vehicles[2].reason).toContain('班表時間線補算');
    expect(rows[2].vehicles[1].reason).toBe('此刻沒有有效任務');
    expect(rows.flatMap((row) => row.vehicles).filter((v) => v.dispatchable).map((v) => v.vehicle_code)).toEqual(['PMS07', 'PMS08']);
  });

  it('沒有訂單時看每日計畫：月台等下一班＝營運中；該有訂單卻沒有的照實標示待命', () => {
    const plan = (vehicleCode: string, taskType: string, ordersExpected: boolean, servicePurpose: 'operation' | 'maintenance' | 'standby' | null) =>
      ({ vehicleCode, orderId: '', tripCode: null, businessKind: null, taskType, servicePurpose, purposeSource: 'shift' as const, planBlock: { taskType, ordersExpected } });
    const rows = buildVehicleDistribution({
      fleetCodes: ['PMS01', 'PMS02'],
      currentTasks: [plan('PMS01', 'idle', false, 'operation'), plan('PMS02', 'passenger', true, 'operation')],
    });
    expect(rows.map((row) => [row.status_code, row.vehicles.map((v) => v.reason)])).toEqual([
      ['IN_SERVICE', ['每日計畫：暫停（不產生訂單的等待），服務營運']],
      ['STANDBY', ['每日計畫此刻是「載客」，但沒有有效訂單']],
    ]);
    // 計畫上有任務的車不算可調度
    expect(rows[1].vehicles[0].dispatchable).toBe(false);
  });

  it('過渡任務用途不明時不硬算營運或整備，並寫出原因；同一台車只算一次', () => {
    const rows = buildVehicleDistribution({
      fleetCodes: ['PMS01', 'PMS01'],
      currentTasks: [task('PMS01', 'TRANSITION', 'dispatch', null)],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status_code: 'STANDBY', vehicle_count: 1, pct: 100 });
    expect(rows[0].vehicles[0].reason).toContain('用途不明');
  });
});
