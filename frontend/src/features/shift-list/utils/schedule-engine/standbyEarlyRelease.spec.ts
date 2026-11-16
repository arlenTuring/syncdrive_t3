import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  emptyShiftScheduleCreateDraft,
  type ShiftScheduleCreateDraft,
  type ShiftScheduleSelectedRoute,
} from '../../types/create';
import type { ScheduleTask } from '../../../time-templates/types/editor';
import type { GenerateShiftScheduleInput } from './generate';
import { normalizeEngineInput, STANDBY_RELEASE_CUT_ROW, type AssignmentCut } from './normalizeInput';
import type { FeasibilityIssue } from './types';
import { withListedOrderRelationGraph } from '../../testing/relationGraphFixture';

/**
 * 待命提早結束接班。
 *
 * 交班時要去充電的車必須提早收班（充電準時開始、不縮短），接手的車如果等到待命整點結束才出來，
 * 交班前那幾個脈衝就沒有車開。規則：值勤中的車都開不了時，「待命後緊接正線」的車可以讓待命的
 * 尾巴提早結束，最多提早一整輪（加上交班車進充電要預留的時間）。
 *
 * 這條規則預設關閉（原因見 NormalizeInputArgs.allowStandbyEarlyRelease）；這裡測的是打開之後的行為。
 */

function route(id: string, name: string, order: number): ShiftScheduleSelectedRoute {
  const stations = order === 1 ? ['a', 'b', 'c'] : ['c', 'b', 'a'];
  return {
    routeId: id,
    routeName: name,
    groupId: 'g1',
    groupName: 'G1',
    stationIds: stations,
    stationDwells: stations.map((stationId) => ({ stationId, stationName: `站${stationId}`, dwellSeconds: 36 })),
    stationDwellsConfirmed: true,
    stationLegTravels: [],
    avgTravelTimeSeconds: 320,
    minTravelTimeSeconds: 265,
    executionOrder: order,
    switchBufferAfterSeconds: 20,
    dwellSlackSeconds: 10,
  };
}

const HANDOVER_MINUTE = 175;
const HANDOVER_SECOND = HANDOVER_MINUTE * 60;

/** 時間線 1：正線 → 充電；時間線 2：待命 → 正線（或 充電 → 正線，當對照組） */
function input(incomingBefore: 'standby' | 'charging'): GenerateShiftScheduleInput {
  const base = emptyShiftScheduleCreateDraft();
  const draft: ShiftScheduleCreateDraft = {
    ...base,
    timeTemplate: { ...base.timeTemplate, templateId: 'TT-1', templateName: '模板' },
    // 這裡測的不是讓渡：把「正線優先讓渡餘裕」設成 0（充電也不超過一小時，不套用長整備讓一輪），
    // 充電就得準時開始，離線前那一輪才會跑不完
    maintenanceTask: {
      ...base.maintenanceTask,
      entrySlackBySection: { charging: '0', carWash: '0', maintenance: '0', preTrip: '0', mobile: '0' },
    },
    routeGroups: {
      mapId: 'map-1',
      selectedRoutes: [route('down', '下行', 1), route('up', '上行', 2)],
      minimumRecoveryTimeSeconds: 30,
      collisionProtectionSeconds: 30,
    },
  };
  draft.routeGroups = withListedOrderRelationGraph(draft.routeGroups);
  const tasks = [
    // 一輪 14 分鐘、每 15 分鐘一個脈衝；交班點 02:55 落在 02:45 那一輪的中間
    { id: 'out-pax', rowIndex: 1, taskType: 'passenger', startMinute: 0, durationMinutes: HANDOVER_MINUTE, label: '正線' },
    { id: 'out-charge', rowIndex: 1, taskType: 'charging', startMinute: HANDOVER_MINUTE, durationMinutes: 60, label: '充電' },
    { id: 'in-wait', rowIndex: 2, taskType: incomingBefore, startMinute: 60, durationMinutes: HANDOVER_MINUTE - 60, label: '接手前' },
    { id: 'in-pax', rowIndex: 2, taskType: 'passenger', startMinute: HANDOVER_MINUTE, durationMinutes: 180, label: '正線' },
  ] as ScheduleTask[];
  return {
    draft,
    templateBody: {
      editorVersion: 1,
      vehicleCapacity: 50,
      scheduleRowCount: 2,
      attributes: [
        { id: 'attr-1', name: '離峰', color: '#00ff00', headwaySeconds: 900, capacityPphpd: 200, isDraft: false },
      ],
      intervals: [
        { id: 'slot-1', attributeId: 'attr-1', name: '全日', startTime: '00:00', endTime: '06:00', isDraft: false },
      ],
      tasks,
    },
    passengerTimetableMode: 'template',
  };
}

function run(
  incomingBefore: 'standby' | 'charging',
  assignmentCuts: AssignmentCut[] = [],
  allowStandbyEarlyRelease = true,
) {
  const issues: FeasibilityIssue[] = [];
  const engineInput = normalizeEngineInput(
    { ...input(incomingBefore), passengerTimetableMode: 'template', assignmentCuts, allowStandbyEarlyRelease },
    issues,
  );
  assert.ok(engineInput, issues.map((issue) => issue.message).join('\n'));
  return engineInput!;
}


describe('待命提早結束接班', () => {
  const released = run('standby');
  const control = run('charging');
  const unservedBeforeHandover = (engineInput: typeof released) =>
    engineInput.servicePulses.filter(
      (pulse) => pulse.status !== 'assigned' && pulse.departureSecond < HANDOVER_SECOND,
    );

  it('對照組：接手的車前一段是充電時，交班前的脈衝沒有車開（充電不能提早結束）', () => {
    assert.ok(unservedBeforeHandover(control).length > 0, '這個情境本來應該有交班前開不了的脈衝');
  });

  it('預設關閉：沒有打開時，待命照模板整點結束，交班前的脈衝沒有車開', () => {
    const off = run('standby', [], false);
    assert.ok(unservedBeforeHandover(off).length > 0);
    assert.equal(off.servicePulses.filter((pulse) => pulse.standbyRelease).length, 0);
    const standby = off.confirmedTasks.find((task) => task.id === 'in-wait')!;
    assert.equal(standby.startMinute + standby.durationMinutes, HANDOVER_MINUTE);
  });

  it('接手的車前一段是待命：交班前的脈衝由它提早出來承接', () => {
    assert.deepEqual(unservedBeforeHandover(released).map((pulse) => pulse.departureSecond), []);
    const early = released.servicePulses.filter(
      (pulse) => pulse.assignedRow === 2 && (pulse.actualStartSecond ?? 0) < HANDOVER_SECOND,
    );
    assert.ok(early.length > 0, '時間線 2 應該在待命結束前就開出第一班');
  });

  it('值勤中的車開得了的脈衝，不會改派給待命的車', () => {
    const control1 = control.servicePulses.filter((pulse) => pulse.assignedRow === 1).map((pulse) => pulse.pulseId);
    const released1 = released.servicePulses.filter((pulse) => pulse.assignedRow === 1).map((pulse) => pulse.pulseId);
    assert.deepEqual(released1, control1);
  });

  it('待命卡的尾巴收到第一班發車為止，開頭不動，而且沒有被吃光', () => {
    const standby = released.confirmedTasks.find((task) => task.id === 'in-wait')!;
    const firstTrip = released.confirmedTasks
      .filter((task) => task.rowIndex === 2 && task.taskType === 'passenger')
      .sort((a, b) => a.startMinute - b.startMinute)[0]!;
    assert.equal(standby.startMinute, 60);
    assert.ok(standby.durationMinutes > 0);
    assert.ok(Math.abs(standby.startMinute + standby.durationMinutes - firstTrip.startMinute) < 1e-6);
  });

  it('最多提早一整輪：第一輪跑完時，自己的正線時段已經開始', () => {
    const firstCycle = released.confirmedTasks
      .filter((task) => task.rowIndex === 2 && task.taskType === 'passenger')
      .sort((a, b) => a.startMinute - b.startMinute);
    const chainId = firstCycle[0]!.cycleChainId;
    const lastLeg = firstCycle.filter((task) => task.cycleChainId === chainId).at(-1)!;
    assert.ok((lastLeg.startMinute + lastLeg.durationMinutes) * 60 >= HANDOVER_SECOND);
  });

  it('應開服務明細標出哪一班是提早接班的', () => {
    const marked = released.servicePulses.filter((pulse) => pulse.standbyRelease);
    assert.equal(marked.length, 1);
    assert.equal(marked[0]!.assignedRow, 2);
    assert.ok((marked[0]!.actualStartSecond ?? 0) < HANDOVER_SECOND);
    assert.equal(control.servicePulses.filter((pulse) => pulse.standbyRelease).length, 0);
  });

  it('試排發現出廠移動排不出來：這一班撤回提早接班，待命照模板整點結束', () => {
    const pulse = released.servicePulses.find((item) => item.standbyRelease)!;
    const withdrawn = run('standby', [
      { pulseId: pulse.pulseId, row: STANDBY_RELEASE_CUT_ROW, reason: '測試：出廠移動排不出來' },
    ]);
    const again = withdrawn.servicePulses.find((item) => item.pulseId === pulse.pulseId)!;
    assert.notEqual(again.status, 'assigned');
    assert.equal(withdrawn.servicePulses.filter((item) => item.standbyRelease).length, 0);
    const standby = withdrawn.confirmedTasks.find((task) => task.id === 'in-wait')!;
    assert.equal(standby.startMinute + standby.durationMinutes, HANDOVER_MINUTE);
  });

  it('要去充電的那台車：充電照模板準時開始、長度不變', () => {
    const charging = released.confirmedTasks.find((task) => task.id === 'out-charge')!;
    assert.equal(charging.startMinute, HANDOVER_MINUTE);
    assert.equal(charging.durationMinutes, 60);
  });
});
