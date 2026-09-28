import assert from 'node:assert/strict';
import { it } from 'node:test';
import { collectPlanViolations, compareViolations, type PlanViolation } from './evaluatePlan';
import type { GeneratedScheduleBlock } from './types';

const violation = (key: string, magnitude: number): PlanViolation => ({
  key, magnitude, code: 'FACILITY_HANDOVER_GAP', severity: 'safety', resource: key, blockIds: [key],
});

it('解掉另一筆問題，不能換取既有安全問題惡化', () => {
  const result = compareViolations([violation('a', 10), violation('b', 10)], [violation('b', 100)]);
  assert.equal(result.better, false);
  assert.equal(result.safeToAdopt, false);
  assert.deepEqual(result.worsened.map((item) => item.key), ['b']);
  assert.equal(compareViolations([violation('a', 10)], [violation('a', 5)]).better, true);
});

it('同一設施交接缺少的秒數，必須反映在候選評分', () => {
  const measure = (gap: number) => collectPlanViolations({
    selectedRoutes: [], routeById: new Map(), passengerRoutes: [], minimumRecoveryTimeSeconds: 0,
    collisionProtectionSeconds: 30, intervals: [], attributes: [], scheduleRowCount: 2,
  }, [
    { row: 1, blocks: [{ id: 'a', timelineRow: 1, taskType: 'charging', plannedStartMinute: 100,
      plannedEndMinute: 110, yardFacilityNodeId: 'f' } as GeneratedScheduleBlock] },
    { row: 2, blocks: [{ id: 'b', timelineRow: 2, taskType: 'charging', plannedStartMinute: 110 + gap / 60,
      plannedEndMinute: 120, yardFacilityNodeId: 'f' } as GeneratedScheduleBlock] },
  ]).filter((item) => item.code === 'FACILITY_HANDOVER_GAP');
  assert.ok(Math.abs(measure(40)[0]!.magnitude - 20) < 1e-6);
  assert.ok(Math.abs(measure(10)[0]!.magnitude - 50) < 1e-6);
  assert.equal(compareViolations(measure(40), measure(10)).safeToAdopt, false);
});
