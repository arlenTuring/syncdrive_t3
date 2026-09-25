import { buildChargingLookup } from './dispatch.charging';
import { extractYardTasks } from './dispatch.yard-tasks';

const template = (charging: Record<string, unknown>) => ({ id: 'MT-1', body: { charging } });

describe('buildChargingLookup', () => {
  const charging = {
    stepEnabled: true,
    upperLimitDetectionEnabled: true,
    upperLimitPercent: '90',
    equipmentRows: [
      { mapCode: 'E1', chargeRateKwhPerMin: '3' },
      { mapCode: 'e2', chargeRateKwhPerMin: '' },
    ],
  };

  it('依格位代號取出速率與上限', () => {
    expect(buildChargingLookup(template(charging))('E1')).toEqual({
      equipmentCode: 'E1',
      rateKwhPerMin: 3,
      upperLimitPercent: 90,
      maintenanceTaskId: 'MT-1',
      error: null,
    });
  });

  it('設備沒有速率時明確回報，不補預設值', () => {
    const spec = buildChargingLookup(template(charging))('E2');
    expect(spec.rateKwhPerMin).toBeNull();
    expect(spec.error).toContain('E2');
  });

  it('設備不在清單上時明確回報', () => {
    expect(buildChargingLookup(template(charging))('E4').error).toContain('沒有 E4');
  });

  it('未啟用上限偵測時上限為 100%', () => {
    const spec = buildChargingLookup(template({ ...charging, upperLimitDetectionEnabled: false }))('E1');
    expect(spec.upperLimitPercent).toBe(100);
  });

  it('班表沒有綁定整備任務時每張充電單都帶著原因', () => {
    expect(buildChargingLookup(null)('E1').error).toContain('沒有綁定整備任務');
  });
});

describe('extractYardTasks', () => {
  it('保留班表卡的任務類型，充電不靠卡片文字判斷', () => {
    const body = {
      scheduleOutput: {
        plan: {
          timelines: [
            {
              blocks: [
                { id: 'b1', taskType: 'charging', label: '待命', yardFacilityNodeId: 'n1', yardFacilityLabel: 'E3', plannedStartMinute: 60, plannedEndMinute: 90, timelineRow: 1 },
                { id: 'b2', taskType: 'standby', label: '充電', yardFacilityNodeId: 'n2', yardFacilityLabel: 'H1', plannedStartMinute: 60, plannedEndMinute: 90, timelineRow: 2 },
              ],
            },
          ],
        },
      },
    };
    const { tasks } = extractYardTasks(body);
    expect(tasks.map((t) => [t.yardSlotId, t.taskType])).toEqual([['E3', 'charging'], ['H1', 'standby']]);
  });
});
