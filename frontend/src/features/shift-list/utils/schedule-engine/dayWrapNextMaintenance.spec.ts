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
 * 一天是循環的：日尾的正線時段之後，接的是隔天一開始的整備。
 *
 * 模板上「正線 …–24:00」後面如果是「充電 00:00–…」，最後一輪不能跑過午夜去吃充電——
 * 跟白天任何一次交班一樣（充電準時開始、不縮短）。只看當天的話，日尾時段後面看起來
 * 什麼都沒有，最後一輪就會被放行。
 */

const DAY_MINUTES = 24 * 60;

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

/** 時間線 1：充電（隔天一開始或稍晚）… 正線 21:05–24:00。一輪 14 分鐘，最後一個脈衝 23:50 會跑到 00:04 */
function input(chargingStartMinute: number): GenerateShiftScheduleInput {
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
    { id: 'charge', rowIndex: 1, taskType: 'charging', startMinute: chargingStartMinute, durationMinutes: 60, label: '充電' },
    { id: 'pax', rowIndex: 1, taskType: 'passenger', startMinute: 21 * 60 + 5, durationMinutes: 175, label: '正線' },
  ] as ScheduleTask[];
  return {
    draft,
    templateBody: {
      editorVersion: 1,
      vehicleCapacity: 50,
      scheduleRowCount: 1,
      attributes: [
        { id: 'attr-1', name: '離峰', color: '#00ff00', headwaySeconds: 900, capacityPphpd: 200, isDraft: false },
      ],
      intervals: [
        { id: 'slot-1', attributeId: 'attr-1', name: '夜間', startTime: '21:05', endTime: '00:00', isDraft: false },
      ],
      tasks,
    },
    passengerTimetableMode: 'template',
  };
}

function run(chargingStartMinute: number) {
  const issues: FeasibilityIssue[] = [];
  const engineInput = normalizeEngineInput(
    { ...input(chargingStartMinute), passengerTimetableMode: 'template' },
    issues,
  );
  assert.ok(engineInput, issues.map((issue) => issue.message).join('\n'));
  return engineInput!;
}

const lastPassengerEndMinute = (engineInput: ReturnType<typeof run>) =>
  Math.max(
    ...engineInput.confirmedTasks
      .filter((task) => task.taskType === 'passenger')
      .map((task) => task.startMinute + task.durationMinutes),
  );

describe('日尾的正線時段：下一個整備是隔天最早的那一個', () => {
  it('隔天 00:00 就是充電：最後一輪不跑過午夜，充電照模板不動', () => {
    const engineInput = run(0);
    assert.ok(
      lastPassengerEndMinute(engineInput) <= DAY_MINUTES + 1e-6,
      `最後一班應該在午夜前收班，實際 ${lastPassengerEndMinute(engineInput)}`,
    );
    const charging = engineInput.confirmedTasks.find((task) => task.id === 'charge')!;
    assert.equal(charging.startMinute, 0);
    assert.equal(charging.durationMinutes, 60);
    // 跑不完的那一個脈衝是「沒有車承接」，不是悄悄消失
    const unserved = engineInput.servicePulses.filter((pulse) => pulse.status !== 'assigned');
    assert.ok(unserved.length > 0);
  });

  it('對照組：隔天的充電 02:00 才開始，最後一輪可以跑過午夜（不是一律切在午夜）', () => {
    const engineInput = run(120);
    assert.ok(
      lastPassengerEndMinute(engineInput) > DAY_MINUTES,
      `充電還很久才開始，最後一輪應該照跑，實際 ${lastPassengerEndMinute(engineInput)}`,
    );
  });
});
