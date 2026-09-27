import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FeasibilityIssue, GeneratedScheduleBlock, GeneratedSchedulePlan } from './types';
import { validateVehicleLocationContinuity } from './validate';

function card(partial: Partial<GeneratedScheduleBlock> & {
  id: string;
  plannedStartMinute: number;
  plannedEndMinute: number;
}): GeneratedScheduleBlock {
  return {
    timelineRow: 1,
    taskType: 'charging',
    label: partial.id,
    source: 'template_bar',
    travelSeconds: 0,
    dwellSeconds: 0,
    anchorStartMinute: partial.plannedStartMinute,
    ...partial,
  } as GeneratedScheduleBlock;
}

function run(blocks: GeneratedScheduleBlock[], explained?: string[]): FeasibilityIssue[] {
  const errors: FeasibilityIssue[] = [];
  validateVehicleLocationContinuity({
    timelines: [{ row: 1, blocks }] as GeneratedSchedulePlan['timelines'],
    selectedRoutes: [],
    errors,
    explainedBlockIds: explained ? new Set(explained) : undefined,
  });
  return errors;
}

describe('validateVehicleLocationContinuity', () => {
  it('跨午夜的零長度整備間轉場（24:00 出廠＋入廠）接得起來', () => {
    const errors = run([
      card({ id: 'stby', taskType: 'standby', plannedStartMinute: 0, plannedEndMinute: 90, yardFacilityNodeId: 'D1' }),
      card({ id: 'chg', plannedStartMinute: 1320, plannedEndMinute: 1440, yardFacilityNodeId: 'E1' }),
      card({ id: 'out', taskType: 'dispatch', source: 'yard_exit_move', plannedStartMinute: 1440, plannedEndMinute: 1440 }),
      card({ id: 'in', taskType: 'dispatch', source: 'yard_entry_move', plannedStartMinute: 1440, plannedEndMinute: 1440 }),
      card({ id: 'out2', taskType: 'dispatch', source: 'yard_exit_move', plannedStartMinute: 90, plannedEndMinute: 90 }),
      card({ id: 'in2', taskType: 'dispatch', source: 'yard_entry_move', plannedStartMinute: 90, plannedEndMinute: 90 }),
    ]);
    assert.deepEqual(errors, []);
  });

  it('換格卻沒有移動卡：回報', () => {
    const errors = run([
      card({ id: 'a', plannedStartMinute: 600, plannedEndMinute: 630, yardFacilityNodeId: 'E1' }),
      card({ id: 'b', taskType: 'standby', plannedStartMinute: 630, plannedEndMinute: 700, yardFacilityNodeId: 'D1' }),
      card({ id: 'mv', taskType: 'dispatch', source: 'yard_exit_move', plannedStartMinute: 700, plannedEndMinute: 701 }),
    ]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.code, 'VEHICLE_LOCATION_DISCONTINUITY');
    assert.equal((errors[0]!.detail as { fromBlockId: string }).fromBlockId, 'a');
  });

  it('暫停卡夾在中間：同一段停留生成時已講過原因，不重複報', () => {
    const blocks = [
      card({ id: 'chg', plannedStartMinute: 600, plannedEndMinute: 630, yardFacilityNodeId: 'E2' }),
      card({ id: 'hold', taskType: 'idle', source: 'hold', plannedStartMinute: 630, plannedEndMinute: 640, yardFacilityNodeId: 'E2' }),
      card({ id: 'stby', taskType: 'standby', plannedStartMinute: 640, plannedEndMinute: 700, yardFacilityNodeId: 'D1' }),
      card({ id: 'mv', taskType: 'dispatch', source: 'yard_exit_move', plannedStartMinute: 700, plannedEndMinute: 700 }),
    ];
    assert.equal(run(blocks).length, 1);
    assert.equal(run(blocks, ['chg']).length, 0);
  });

  it('同一格續留（整備接暫停接待命）不需要移動', () => {
    const errors = run([
      card({ id: 'chg', plannedStartMinute: 600, plannedEndMinute: 630, yardFacilityNodeId: 'E2' }),
      card({ id: 'hold', taskType: 'idle', source: 'hold', plannedStartMinute: 630, plannedEndMinute: 640, yardFacilityNodeId: 'E2' }),
      card({ id: 'stby', taskType: 'standby', plannedStartMinute: 640, plannedEndMinute: 700, yardFacilityNodeId: 'E2' }),
    ]);
    assert.deepEqual(errors, []);
  });
});
