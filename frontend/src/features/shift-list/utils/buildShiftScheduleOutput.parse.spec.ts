import assert from 'node:assert/strict';
import { it } from 'node:test';
import { parseShiftScheduleStoredOutput } from './buildShiftScheduleOutput';

/**
 * 草稿重新開啟後再存檔，應開服務明細不能掉：少了它，標成已完成／發布前的核對會判成
 * SERVICE_DEMAND_UNVERIFIABLE（2026-11-24「模擬正線_1124」班表本身沒變，卻被擋下）。
 */
it('讀回草稿時保留應開服務明細與演算法標記（主班表與調整歷史都要）', () => {
  const plan = {
    shiftId: 'S1',
    generatedAt: '2026-11-24T01:19:17.937Z',
    scheduleRowCount: 1,
    timelines: [{ row: 1, blocks: [] }],
    servicePulses: [{ pulseId: 'p1', departureSecond: 0, status: 'assigned', assignedRow: 1 }],
    routeAssignmentAlgorithm: 'a',
    timetableGenerationAlgorithm: 'b',
  };
  const parsed = parseShiftScheduleStoredOutput({
    outputVersion: 1,
    generatedAt: plan.generatedAt,
    plan,
    feasibilityReport: { ok: true, errors: [], warnings: [] },
    maintenanceTaskBinding: { taskId: 't', taskName: 'n' },
    timeTemplateRef: { templateId: 'tpl', templateName: 'x' },
    routeGroupsRef: {},
    planAdjustHistory: [{ plan, feasibilityReport: { ok: true, errors: [], warnings: [] } }],
    planAdjustHistoryIndex: 0,
  });
  assert.ok(parsed?.plan);
  assert.deepEqual(parsed.plan.servicePulses, plan.servicePulses);
  assert.equal(parsed.plan.routeAssignmentAlgorithm, 'a');
  assert.equal(parsed.plan.timetableGenerationAlgorithm, 'b');
  assert.deepEqual(parsed.planAdjustHistory?.[0]?.plan.servicePulses, plan.servicePulses);
});
