import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FeasibilityIssue, GeneratedScheduleBlock, GeneratedSchedulePlan } from './types';
import { validateFacilityOccupancy, validateYardWorkPreserved } from './validate';
import { collectFacilityOccupancies } from '../stationBerthOccupancy';

/**
 * 白皮書 YARD-03、YARD-07：整備不能被刪或壓成零；提早到設施是等待，等待也佔格位。
 * 名稱與時刻都只是測試資料。
 */
function block(partial: Partial<GeneratedScheduleBlock> & { id: string; plannedStartMinute: number; plannedEndMinute: number }): GeneratedScheduleBlock {
  return {
    timelineRow: 1,
    taskType: 'charging',
    label: partial.id,
    anchorStartMinute: partial.plannedStartMinute,
    travelSeconds: 0,
    dwellSeconds: 0,
    source: 'template_bar',
    ...partial,
  } as GeneratedScheduleBlock;
}

const task = (id: string, taskType: string, startMinute: number, durationMinutes: number, templateStartMinute?: number) => ({
  id, rowIndex: 1, taskType, label: id, startMinute, durationMinutes, templateStartMinute,
});

describe('validateYardWorkPreserved', () => {
  it('模板上的整備在班表裡不見了：錯誤', () => {
    const errors: FeasibilityIssue[] = [];
    validateYardWorkPreserved({
      timelines: [{ row: 1, blocks: [] }],
      yardTasks: [task('ch', 'charging', 60, 30)],
      maintenanceBody: null,
      errors,
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.code, 'MAINTENANCE_WORK_INSUFFICIENT');
    assert.equal(errors[0]!.severity, 'error');
  });

  it('低於設定作業時長不擋（移動可佔用開頭，使用者 2026-09-30）；歸零才擋', () => {
    const body = { preTrip: { operationDurationMinutes: '15' } };
    const errors: FeasibilityIssue[] = [];
    validateYardWorkPreserved({
      timelines: [{ row: 1, blocks: [block({ id: 'insp', taskType: 'inspection', plannedStartMinute: 70, plannedEndMinute: 80 })] }],
      yardTasks: [task('insp', 'inspection', 60, 20)],
      maintenanceBody: body,
      errors,
    });
    assert.equal(errors.length, 0, '剩 10 分鐘 < 設定 15 分鐘：揭露但不擋');
    validateYardWorkPreserved({
      timelines: [{ row: 1, blocks: [block({ id: 'insp', taskType: 'inspection', plannedStartMinute: 80, plannedEndMinute: 80 })] }],
      yardTasks: [task('insp', 'inspection', 60, 20)],
      maintenanceBody: body,
      errors,
    });
    assert.equal(errors.length, 1, '歸零要擋');
  });

  it('生成階段已讓渡縮短的整備，用模板原起點核對（templateStartMinute）', () => {
    const errors: FeasibilityIssue[] = [];
    // 模板 60–80，讓渡後 task 記成 78 起 2 分鐘：實際剩 2 分鐘 > 一個刻度，沒有設定作業時長 → 通過
    validateYardWorkPreserved({
      timelines: [{ row: 1, blocks: [block({ id: 'ch', plannedStartMinute: 78, plannedEndMinute: 80 })] }],
      yardTasks: [task('ch', 'charging', 78, 2, 60)],
      maintenanceBody: null,
      errors,
    });
    assert.equal(errors.length, 0);
    // 壓到零（開始＝結束）→ 錯誤
    validateYardWorkPreserved({
      timelines: [{ row: 1, blocks: [block({ id: 'ch', plannedStartMinute: 80, plannedEndMinute: 80 })] }],
      yardTasks: [task('ch', 'charging', 78, 2, 60)],
      maintenanceBody: null,
      errors,
    });
    assert.equal(errors.length, 1);
  });
});

describe('提早到設施是等待，等待也佔格位', () => {
  const plan = (otherEntersAt: number): GeneratedSchedulePlan['timelines'] => [
    {
      row: 1,
      blocks: [
        block({ id: 'in1', taskType: 'dispatch', source: 'yard_entry_move', plannedStartMinute: 99, plannedEndMinute: 100, yardExitFacilityNodeId: 'E1' }),
        block({ id: 'ch1', plannedStartMinute: 110, plannedEndMinute: 150, yardFacilityNodeId: 'E1' }),
      ],
    },
    {
      row: 2,
      blocks: [
        block({ id: 'ch2', timelineRow: 2, plannedStartMinute: otherEntersAt - 20, plannedEndMinute: otherEntersAt, yardFacilityNodeId: 'E1' }),
        block({ id: 'out2', timelineRow: 2, taskType: 'dispatch', source: 'yard_exit_move', plannedStartMinute: otherEntersAt, plannedEndMinute: otherEntersAt + 1 }),
      ],
    },
  ];

  it('佔用從抵達算起，不是整備開始', () => {
    const occupancy = collectFacilityOccupancies(plan(80)).find((item) => item.blockIds.includes('ch1'))!;
    assert.equal(occupancy.startMinute, 100);
  });

  it('別台車在等待期間還在格子裡：抓得到重疊', () => {
    const errors: FeasibilityIssue[] = [];
    // row2 在 E1 待到 105 才走；row1 100 就到了，整備 110 才開始——等待那段重疊
    validateFacilityOccupancy(plan(105), errors, { collisionProtectionSeconds: 0 });
    assert.equal(errors.filter((item) => item.code === 'FACILITY_SLOT_COLLISION').length, 1);
  });
});
