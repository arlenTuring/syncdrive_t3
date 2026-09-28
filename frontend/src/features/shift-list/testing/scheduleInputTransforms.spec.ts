import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GenerateShiftScheduleInput } from '../utils/schedule-engine/generate';
import {
  checkShiftedTemplate,
  enumFieldChanges,
  renameScheduleInput,
  shiftScheduleInputMinutes,
} from './scheduleInputTransforms';

/** 名稱、時刻都只是測試資料 */
function input(): GenerateShiftScheduleInput {
  return {
    templateBody: {
      tasks: [
        { id: 't-dawn', rowIndex: 1, taskType: 'passenger', label: '正線', startMinute: 0, durationMinutes: 180 },
        { id: 't-night', rowIndex: 2, taskType: 'charging', label: '充電', startMinute: 1380, durationMinutes: 120 },
        { id: 't-noon', rowIndex: 1, taskType: 'standby', label: '待命', startMinute: 720, durationMinutes: 30 },
      ],
      intervals: [
        { id: 'i-early', attributeId: 'a', name: '甲', startTime: '00:00', endTime: '05:00', isDraft: false },
        { id: 'i-late', attributeId: 'a', name: '甲', startTime: '23:00', endTime: '00:00', isDraft: false },
        { id: 'i-day', attributeId: 'b', name: '乙', startTime: '05:00', endTime: '23:00', isDraft: false },
      ],
      attributes: [],
      scheduleRowCount: 2,
    },
    draft: { routeGroups: { selectedRoutes: [] }, maintenanceTask: { sectionCodeBySection: { charging: '充電' } } },
    pointTopology: {
      nodes: [
        { id: 'n1', label: 'DockingPoint', kind: 'docking', stationId: 's1' },
        { id: 'n2', label: '入口', kind: 'waypoint' },
      ],
      edges: [{ id: 'e1', fromNodeId: 'n1', toNodeId: 'n2', avgTravelTimeSeconds: 30, minTravelTimeSeconds: 30 }],
    },
    areas: [{ id: 'area-1', name: '場區', facilities: [{ id: 'n1', type: 'DockingPoint', name: 'DockingPoint' }] }],
  } as unknown as GenerateShiftScheduleInput;
}

const tasksOf = (value: GenerateShiftScheduleInput) =>
  (value.templateBody as unknown as { tasks: Array<{ id: string; startMinute: number; durationMinutes: number }> }).tasks;
const intervalsOf = (value: GenerateShiftScheduleInput) =>
  (value.templateBody as unknown as { intervals: Array<{ id: string; startTime: string; endTime: string }> }).intervals;

describe('整體平移', () => {
  it('提早 90 分：開始時刻繞回日循環、持續時間不變，解析後語意正確', () => {
    const original = input();
    const shifted = shiftScheduleInputMinutes(original, -90);
    assert.deepEqual(
      tasksOf(shifted).map((task) => [task.id, task.startMinute, task.durationMinutes]),
      [['t-dawn', 1350, 180], ['t-night', 1290, 120], ['t-noon', 630, 30]],
    );
    assert.deepEqual(
      intervalsOf(shifted).map((interval) => [interval.startTime, interval.endTime]),
      [['22:30', '03:30'], ['21:30', '22:30'], ['03:30', '21:30']],
    );
    assert.deepEqual(checkShiftedTemplate(original, shifted, -90), []);
  });

  it('直接相減產生負數：解析器會把它截成 00:00，檢查要抓得到', () => {
    const original = input();
    const naive = structuredClone(original);
    for (const task of tasksOf(naive)) task.startMinute -= 90;
    const problems = checkShiftedTemplate(original, naive, -90);
    assert.ok(problems.some((line) => line.includes('t-dawn')), problems.join('\n'));
  });

  it('跨午夜任務延後後仍跨午夜；平移後再反向平移回到原本', () => {
    const original = input();
    const later = shiftScheduleInputMinutes(original, 90);
    assert.equal(tasksOf(later).find((task) => task.id === 't-night')!.startMinute, 30);
    assert.deepEqual(checkShiftedTemplate(original, later, 90), []);
    const back = shiftScheduleInputMinutes(later, -90);
    assert.deepEqual(back.templateBody, original.templateBody);
  });

  it('全天時段（起＝訖）平移後仍是全天', () => {
    const original = input();
    intervalsOf(original)[2] = { ...intervalsOf(original)[2]!, startTime: '05:00', endTime: '05:00' };
    const shifted = shiftScheduleInputMinutes(original, 45);
    assert.deepEqual(checkShiftedTemplate(original, shifted, 45), []);
  });
});

describe('改名', () => {
  for (const mode of ['prefix', 'opaque'] as const) {
    it(`${mode}：列舉欄位（type／kind／taskType）完全不變，名稱與識別碼參照一起改`, () => {
      const original = input();
      const renamed = renameScheduleInput(original, mode).input;
      assert.deepEqual(enumFieldChanges(original, renamed), []);
      const facility = (renamed.areas as unknown as Array<{ facilities: Array<{ id: string; type: string; name: string }> }>)[0]!
        .facilities[0]!;
      assert.equal(facility.type, 'DockingPoint');
      assert.notEqual(facility.name, 'DockingPoint');
      const topology = renamed.pointTopology!;
      assert.equal(topology.nodes[0]!.kind, 'docking');
      assert.equal(topology.edges[0]!.fromNodeId, topology.nodes[0]!.id);
      assert.equal(facility.id, topology.nodes[0]!.id);
      assert.notEqual(topology.nodes[0]!.id, 'n1');
      assert.deepEqual(tasksOf(renamed).map((task) => (task as unknown as { taskType: string }).taskType),
        ['passenger', 'charging', 'standby']);
    });
  }

  it('只改顯示名稱時識別碼不動', () => {
    const original = input();
    const renamed = renameScheduleInput(original, 'prefix', true).input;
    assert.equal(renamed.pointTopology!.nodes[0]!.id, 'n1');
    assert.equal(renamed.pointTopology!.nodes[0]!.label, '改名DockingPoint');
    assert.deepEqual(enumFieldChanges(original, renamed), []);
  });
});
