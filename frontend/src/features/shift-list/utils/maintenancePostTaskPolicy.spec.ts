import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MaintenanceFirstTripOrigin } from './maintenanceFirstTripOrigins';
import {
  buildYardRotationExitByTaskType,
  isStandbyDispatchableForMainline,
  resolveYardPostTaskPolicy,
  rowHasPassengerTemplateAtOrAfter,
  shouldApplyYardExitRotationAlign,
} from './maintenancePostTaskPolicy';

const origins: MaintenanceFirstTripOrigin[] = [
  {
    stationId: 'T3-D',
    label: 'T3下行',
    deadheadSeconds: 120,
    facilityNodeIds: ['fac-insp', 'fac-w1'],
    facilityLabels: ['INSP', 'W1'],
  },
  {
    stationId: 'N2W-D',
    label: 'N2W下行',
    deadheadSeconds: 180,
    facilityNodeIds: ['fac-e1', 'fac-p1'],
    facilityLabels: ['E1', 'P1'],
  },
  {
    stationId: 'S2W-U',
    label: 'S2W上行',
    deadheadSeconds: 150,
    facilityNodeIds: ['fac-m1'],
    facilityLabels: ['M1'],
  },
];

describe('resolveYardPostTaskPolicy', () => {
  it('inspection: phase-align to preTrip exit; no entry service', () => {
    const policy = resolveYardPostTaskPolicy({
      taskType: 'inspection',
      origins,
      maintenanceBody: {
        preTrip: {
          stepEnabled: true,
          equipmentRows: [{ id: '1', mapCode: 'INSP', waypointCode: '' }],
        },
      },
    });
    assert.equal(policy.rotationExitStationId, 'T3-D');
    assert.equal(policy.allowEntryService, false);
  });

  it('charging: phase-align only when unique exit', () => {
    const unique = resolveYardPostTaskPolicy({
      taskType: 'charging',
      origins,
      maintenanceBody: {
        charging: {
          stepEnabled: true,
          equipmentRows: [{ id: '1', mapCode: 'E1', waypointCode: '' }],
        },
      },
    });
    assert.equal(unique.rotationExitStationId, 'N2W-D');
    assert.equal(unique.allowEntryService, false);

    const multi = resolveYardPostTaskPolicy({
      taskType: 'charging',
      origins,
      maintenanceBody: {
        charging: {
          stepEnabled: true,
          equipmentRows: [
            { id: '1', mapCode: 'E1', waypointCode: '' },
            { id: '2', mapCode: 'INSP', waypointCode: '' },
          ],
        },
      },
    });
    assert.equal(multi.rotationExitStationId, null);
  });

  it('servicing: entry service with filtered exits; no phase align', () => {
    const policy = resolveYardPostTaskPolicy({
      taskType: 'servicing',
      origins,
      maintenanceBody: {
        maintenance: {
          stepEnabled: true,
          equipmentRows: [{ id: '1', mapCode: 'M1', waypointCode: '' }],
        },
        carWash: {
          stepEnabled: true,
          equipmentRows: [{ id: '2', mapCode: 'W1', waypointCode: '' }],
        },
      },
    });
    assert.equal(policy.rotationExitStationId, null);
    assert.equal(policy.allowEntryService, true);
    assert.deepEqual(
      [...policy.entryServiceExitStationIds].sort(),
      ['S2W-U', 'T3-D'].sort(),
    );
  });

  it('servicing falls back to all topology exits when no facility codes', () => {
    const policy = resolveYardPostTaskPolicy({
      taskType: 'servicing',
      origins,
      maintenanceBody: {},
    });
    assert.equal(policy.allowEntryService, true);
    assert.equal(policy.entryServiceExitStationIds.length, 3);
  });
});

describe('buildYardRotationExitByTaskType', () => {
  it('includes inspection / charging / standby when exits resolve', () => {
    const map = buildYardRotationExitByTaskType({
      origins,
      maintenanceBody: {
        preTrip: {
          stepEnabled: true,
          equipmentRows: [{ id: '1', mapCode: 'INSP', waypointCode: '' }],
        },
        charging: {
          stepEnabled: true,
          equipmentRows: [{ id: '2', mapCode: 'E1', waypointCode: '' }],
        },
        mobile: {
          stepEnabled: true,
          equipmentRows: [{ id: '3', mapCode: 'P1', waypointCode: '' }],
        },
      },
    });
    assert.equal(map.inspection, 'T3-D');
    assert.equal(map.charging, 'N2W-D');
    assert.equal(map.standby, 'N2W-D');
    assert.equal(map.servicing, undefined);
  });
});

describe('yard exit align / standby dispatch gates', () => {
  const tasks = [
    { rowIndex: 1, taskType: 'inspection', startMinute: 0 },
    { rowIndex: 1, taskType: 'standby', startMinute: 60 },
    { rowIndex: 2, taskType: 'inspection', startMinute: 0 },
    { rowIndex: 2, taskType: 'standby', startMinute: 60 },
    { rowIndex: 2, taskType: 'passenger', startMinute: 120 },
  ];

  it('rowHasPassengerTemplateAtOrAfter detects later mainline only', () => {
    assert.equal(rowHasPassengerTemplateAtOrAfter(tasks, 1, 30), false);
    assert.equal(rowHasPassengerTemplateAtOrAfter(tasks, 2, 30), true);
    assert.equal(rowHasPassengerTemplateAtOrAfter(tasks, 2, 120), true);
    assert.equal(rowHasPassengerTemplateAtOrAfter(tasks, 2, 121), false);
  });

  it('pure standby is not dispatchable; standby before passenger is', () => {
    assert.equal(
      isStandbyDispatchableForMainline(tasks, { rowIndex: 1, startMinute: 60 }),
      false,
    );
    assert.equal(
      isStandbyDispatchableForMainline(tasks, { rowIndex: 2, startMinute: 60 }),
      true,
    );
  });

  it('exit rotation align only when mainline follows the yard', () => {
    assert.equal(
      shouldApplyYardExitRotationAlign({
        exitStationId: 'T3-D',
        templateTasks: tasks,
        row: 1,
        yardEndMinute: 30,
      }),
      false,
    );
    assert.equal(
      shouldApplyYardExitRotationAlign({
        exitStationId: 'T3-D',
        templateTasks: tasks,
        row: 2,
        yardEndMinute: 30,
      }),
      true,
    );
    assert.equal(
      shouldApplyYardExitRotationAlign({
        exitStationId: null,
        templateTasks: tasks,
        row: 2,
        yardEndMinute: 30,
      }),
      false,
    );
  });
});
