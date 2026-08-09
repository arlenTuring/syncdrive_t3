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
  it('extends through 保養→行檢 chain at the junction', () => {
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
    assert.equal(policy.alignRotationToExitStation, false, '保養靠外掛送車，輪不改起點');
    assert.equal(policy.allowEntryService, true);
    assert.deepEqual(policy.entryServiceExitStationIds, ['station_4']);
  });

  it('lets 行檢 (inspection) produce a post-maintenance dispatch trip too', () => {
    // 行檢設施（H1）同樣離正線起點站有距離，做完之後車要開過去才能上工，
    // 因此與保養一樣要產生調度營運班次（代號 P）。舊版把 inspection 寫死為不允許。
    const policy = resolveYardPostTaskPolicy({
      taskType: 'inspection',
      origins: ORIGINS,
      maintenanceBody: BODY,
    });
    assert.equal(policy.allowEntryService, true);
    assert.deepEqual(policy.entryServiceExitStationIds, ['station_4']);
  });

  it('keeps 充電/待命 without dispatch trips (facilities are near the origin)', () => {
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
    // 2026-08-08：預設 purpose='align' 只含「車真的停在出場站、沒有外掛可送」的類型。
    // 保養／行檢有外掛班次會把車送到首發站，輪不從出場站起算，所以不列入相位對齊。
    assert.equal(map.servicing, undefined);
    assert.equal(map.inspection, undefined);
    assert.equal(map.charging, 'station_2');

    const validateMap = buildYardRotationExitByTaskType({
      origins: ORIGINS,
      maintenanceBody: BODY,
      purpose: 'validate',
    });
    assert.equal(validateMap.servicing, 'station_4', '驗證用要知道車實際停在哪');
    assert.equal(validateMap.inspection, 'station_4');
  });
});
