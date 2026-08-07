import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildYardRotationExitByTaskType,
  resolveContiguousYardBusyUntilMinute,
  resolveYardPostTaskPolicy,
} from './maintenancePostTaskPolicy.ts';
import type { MaintenanceFirstTripOrigin } from './maintenanceFirstTripOrigins.ts';

const ORIGINS: MaintenanceFirstTripOrigin[] = [
  {
    stationId: 'station_2',
    label: 'N2W下行出發',
    deadheadSeconds: 0,
    facilityNodeIds: ['e1'],
    facilityLabels: ['E1', 'E2'],
  },
  {
    stationId: 'station_4',
    label: 'T3上行',
    deadheadSeconds: 0,
    facilityNodeIds: ['m1'],
    facilityLabels: ['M1', 'M2', 'M3', 'M4', 'H1'],
  },
];

const BODY = {
  maintenance: {
    stepEnabled: true,
    equipmentRows: [
      { mapCode: 'M1' },
      { mapCode: 'M2' },
    ],
  },
  preTrip: {
    stepEnabled: true,
    equipmentRows: [{ mapCode: 'H1' }],
  },
  charging: {
    stepEnabled: true,
    equipmentRows: [{ mapCode: 'E1' }],
  },
};

describe('resolveContiguousYardBusyUntilMinute', () => {
  it('extends through 保養→行前 chain at the junction', () => {
    const tasks = [
      {
        rowIndex: 1,
        taskType: 'servicing',
        startMinute: 2 * 60,
        durationMinutes: 7 * 60 + 30,
      },
      {
        rowIndex: 1,
        taskType: 'inspection',
        startMinute: 9 * 60 + 30,
        durationMinutes: 30,
      },
    ];
    assert.equal(
      resolveContiguousYardBusyUntilMinute(tasks, 1, 9 * 60 + 30),
      10 * 60,
    );
    assert.equal(
      resolveContiguousYardBusyUntilMinute(tasks, 1, 9 * 60 + 29),
      10 * 60,
    );
  });

  it('returns null outside yard occupation', () => {
    const tasks = [
      {
        rowIndex: 1,
        taskType: 'servicing',
        startMinute: 2 * 60,
        durationMinutes: 7 * 60 + 30,
      },
    ];
    assert.equal(
      resolveContiguousYardBusyUntilMinute(tasks, 1, 10 * 60),
      null,
    );
  });
});

describe('resolveYardPostTaskPolicy servicing exit', () => {
  it('aligns servicing rotation exit to T3上行 for M-series facilities', () => {
    const policy = resolveYardPostTaskPolicy({
      taskType: 'servicing',
      origins: ORIGINS,
      maintenanceBody: BODY,
    });
    assert.equal(policy.rotationExitStationId, 'station_4');
    assert.equal(policy.allowEntryService, true);
    assert.deepEqual(policy.entryServiceExitStationIds, ['station_4']);
  });

  it('lets 行前 (inspection) produce a post-maintenance dispatch trip too', () => {
    // 行前設施（H1）同樣離正線起點站有距離，做完之後車要開過去才能上工，
    // 因此與保養一樣要產生調度營運班次（代號 P）。舊版把 inspection 寫死為不允許。
    const policy = resolveYardPostTaskPolicy({
      taskType: 'inspection',
      origins: ORIGINS,
      maintenanceBody: BODY,
    });
    assert.equal(policy.allowEntryService, true);
    assert.deepEqual(policy.entryServiceExitStationIds, ['station_4']);
  });

  it('keeps 充電/機動 without dispatch trips (facilities are near the origin)', () => {
    for (const taskType of ['charging', 'standby'] as const) {
      const policy = resolveYardPostTaskPolicy({
        taskType,
        origins: ORIGINS,
        maintenanceBody: BODY,
      });
      assert.equal(
        policy.allowEntryService,
        false,
        `${taskType} must not produce a dispatch trip`,
      );
    }
  });

  it('includes servicing in yardRotationExitByTaskType map', () => {
    const map = buildYardRotationExitByTaskType({
      origins: ORIGINS,
      maintenanceBody: BODY,
    });
    assert.equal(map.servicing, 'station_4');
    assert.equal(map.inspection, 'station_4');
    assert.equal(map.charging, 'station_2');
  });
});
