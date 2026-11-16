import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  emptyShiftScheduleCreateDraft,
  type ShiftScheduleCreateDraft,
  type ShiftScheduleSelectedRoute,
} from '../../types/create';
import type { ScheduleTask } from '../../../time-templates/types/editor';
import type { GenerateShiftScheduleInput } from './generate';
import { normalizeEngineInput } from './normalizeInput';
import type { FeasibilityIssue } from './types';
import { withListedOrderRelationGraph } from '../../testing/relationGraphFixture';

/**
 * 同樣準時的時候，在線車優先於從整備區叫出來的新車。
 *
 * 以前同分是比「誰空得比較久」，永遠是還在整備區的新車贏：新車一上線就把班次拿光，原本在線的車
 * 回到終點站沒有班可發，停在月台上乾等。這條規則只當同分時的先後，不拿班次延遲去換。
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

/** 新車上線的時刻（分）：時間線 2 待命到這時候，之後才是正線 */
const JOIN_MINUTE = 60;

/**
 * 時間線 1 整段都在線上；時間線 2 待命到 01:00 才上線。一輪 14 分鐘。
 * 01:00 之前班距固定 15 分鐘（一台車跑得完），01:00 之後的班距由參數決定。
 */
function input(headwayAfterJoinSeconds: number): GenerateShiftScheduleInput {
  const base = emptyShiftScheduleCreateDraft();
  const draft: ShiftScheduleCreateDraft = {
    ...base,
    timeTemplate: { ...base.timeTemplate, templateId: 'TT-1', templateName: '模板' },
    routeGroups: {
      mapId: 'map-1',
      selectedRoutes: [route('down', '下行', 1), route('up', '上行', 2)],
      minimumRecoveryTimeSeconds: 30,
      collisionProtectionSeconds: 30,
    },
  };
  draft.routeGroups = withListedOrderRelationGraph(draft.routeGroups);
  const tasks = [
    { id: 'on-pax', rowIndex: 1, taskType: 'passenger', startMinute: 0, durationMinutes: 240, label: '正線' },
    { id: 'new-wait', rowIndex: 2, taskType: 'standby', startMinute: 0, durationMinutes: JOIN_MINUTE, label: '待命' },
    { id: 'new-pax', rowIndex: 2, taskType: 'passenger', startMinute: JOIN_MINUTE, durationMinutes: 180, label: '正線' },
  ] as ScheduleTask[];
  return {
    draft,
    templateBody: {
      editorVersion: 1,
      vehicleCapacity: 50,
      scheduleRowCount: 2,
      attributes: [
        { id: 'attr-1', name: '上線前', color: '#00ff00', headwaySeconds: 900, capacityPphpd: 200, isDraft: false },
        { id: 'attr-2', name: '上線後', color: '#0000ff', headwaySeconds: headwayAfterJoinSeconds, capacityPphpd: 200, isDraft: false },
      ],
      intervals: [
        { id: 'slot-1', attributeId: 'attr-1', name: '上線前', startTime: '00:00', endTime: '01:00', isDraft: false },
        { id: 'slot-2', attributeId: 'attr-2', name: '上線後', startTime: '01:00', endTime: '03:00', isDraft: false },
      ],
      tasks,
    },
    passengerTimetableMode: 'template',
  };
}

function run(headwayAfterJoinSeconds: number, preferCirculatingVehicles?: boolean) {
  const issues: FeasibilityIssue[] = [];
  const engineInput = normalizeEngineInput(
    { ...input(headwayAfterJoinSeconds), passengerTimetableMode: 'template', preferCirculatingVehicles },
    issues,
  );
  assert.ok(engineInput, issues.map((issue) => issue.message).join('\n'));
  return engineInput!;
}

const afterJoin = (engineInput: ReturnType<typeof run>) =>
  engineInput.servicePulses.filter((pulse) => pulse.departureSecond >= JOIN_MINUTE * 60 && pulse.status === 'assigned');

describe('同樣準時的時候，在線車優先', () => {
  it('在線的車每一班都趕得上（班距 15 分、一輪 14 分）：新車上線後不搶班次', () => {
    const pulses = afterJoin(run(900));
    assert.ok(pulses.length > 0);
    assert.deepEqual(
      pulses.filter((pulse) => pulse.assignedRow === 2).map((pulse) => pulse.departureSecond),
      [],
      '在線的時間線 1 都能準時接，時間線 2 不該被叫出來',
    );
    assert.ok(pulses.every((pulse) => pulse.actualStartSecond === pulse.departureSecond), '每一班都準時');
  });

  it('對照：關掉這條規則，新車一上線就把班次拿走', () => {
    const pulses = afterJoin(run(900, false));
    assert.ok(
      pulses.some((pulse) => pulse.assignedRow === 2),
      '舊的同分規則是誰空得久誰先，剛上線的時間線 2 會拿到班次',
    );
  });

  it('不拿延遲去換：在線的車趕不上的那一班（班距 7.5 分），由新車準時開', () => {
    const pulses = afterJoin(run(450));
    // 01:00 那一班兩台都準時：給在線的時間線 1
    assert.equal(pulses.find((pulse) => pulse.departureSecond === JOIN_MINUTE * 60)?.assignedRow, 1);
    const byNew = pulses.filter((pulse) => pulse.assignedRow === 2);
    assert.ok(byNew.length > 0, '一台車跑不完 7.5 分鐘班距，新車必須出來');
    // 在線的車還在跑、趕不上的下一班（01:07:30）由新車開，而且準時
    assert.equal(byNew[0]!.departureSecond, JOIN_MINUTE * 60 + 450);
    assert.equal(byNew[0]!.actualStartSecond, byNew[0]!.departureSecond);
  });
});
