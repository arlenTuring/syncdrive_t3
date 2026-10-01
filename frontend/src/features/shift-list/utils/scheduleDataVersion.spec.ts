import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildShiftScheduleDraftFromStored, emptyShiftScheduleCreateDraft, serializeShiftScheduleBody } from '../types/create';
import type { ShiftScheduleCreateDraft } from '../types/create';
import type { GenerateShiftScheduleInput } from './schedule-engine/generate';
import {
  fingerprintScheduleEngineInput,
  resolveScheduleDataSelectionKey,
  verifyScheduleDataVersion,
} from './scheduleDataVersion';

/** 白皮書 MAP-04：生成用的必須是路線群組檢查過的那一版資料 */

function draft(): ShiftScheduleCreateDraft {
  const base = emptyShiftScheduleCreateDraft();
  base.timeTemplate = { ...base.timeTemplate, templateId: 'tt-1' };
  base.maintenanceTask = { ...base.maintenanceTask, taskId: 'mt-1', skipped: false };
  base.routeGroups = {
    ...base.routeGroups,
    mapId: 'map-x',
    selectedRoutes: [{
      instanceId: 'r1', routeId: 'r1', routeName: 'A>B', groupId: 'g', groupName: 'g',
      stationIds: ['st-a', 'st-b'], stationDwells: [], stationDwellsConfirmed: true, stationLegTravels: [],
      avgTravelTimeSeconds: 60, minTravelTimeSeconds: 50, executionOrder: 1, switchBufferAfterSeconds: 0,
    }] as never,
  };
  return base;
}

function input(forDraft: ShiftScheduleCreateDraft, edgeSeconds = 60): GenerateShiftScheduleInput {
  return {
    draft: forDraft,
    templateBody: { tasks: [] },
    maintenanceTaskBody: { mobile: { equipmentRows: [{ mapCode: 'D1' }] } },
    turnaroundLimitSeconds: null,
    passengerTimetableMode: 'template',
    firstTripOrigins: [],
    pointTopology: {
      version: 1,
      nodes: [{ id: 'n-a', kind: 'docking', label: 'A', stationId: 'st-a', x: 0, y: 0, color: '#111' }],
      edges: [{ id: 'e', fromNodeId: 'n-a', toNodeId: 'n-b', avgTravelTimeSeconds: edgeSeconds, minTravelTimeSeconds: edgeSeconds, distanceMeters: null }],
    },
    areas: [],
  } as unknown as GenerateShiftScheduleInput;
}

function checked(forDraft: ShiftScheduleCreateDraft, ok = true): ShiftScheduleCreateDraft {
  return {
    ...forDraft,
    routeGroups: {
      ...forDraft.routeGroups,
      dataCheck: {
        selectionKey: resolveScheduleDataSelectionKey(forDraft),
        fingerprint: fingerprintScheduleEngineInput(input(forDraft)),
        mapId: 'map-x',
        checkedAt: '2026-09-30T10:00:00.000Z',
        ok,
        issues: ok ? [] : [{ message: '缺路段時間', scope: 'selection' }],
      },
    },
  };
}

describe('verifyScheduleDataVersion', () => {
  it('檢查過、選取與資料都沒變：放行', () => {
    const d = checked(draft());
    assert.equal(verifyScheduleDataVersion(d, input(d)), null);
  });

  it('沒有檢查紀錄（舊草稿、沒進過路線群組）：擋，請回路線群組', () => {
    const issue = verifyScheduleDataVersion(draft(), input(draft()));
    assert.equal(issue?.code, 'SCHEDULE_DATA_INCOMPLETE');
    assert.equal(issue?.detail?.reason, 'not-checked');
  });

  it('檢查沒過：擋', () => {
    const d = checked(draft(), false);
    assert.equal(verifyScheduleDataVersion(d, input(d))?.detail?.reason, 'check-failed');
  });

  it('檢查後換了路線：擋，要重新檢查', () => {
    const d = checked(draft());
    const changed = {
      ...d,
      routeGroups: {
        ...d.routeGroups,
        selectedRoutes: d.routeGroups.selectedRoutes.map((route) => ({ ...route, stationIds: ['st-b', 'st-a'] })),
      },
    };
    assert.equal(verifyScheduleDataVersion(changed, input(changed))?.detail?.reason, 'selection-changed');
  });

  it('檢查後換了整備任務：擋', () => {
    const d = checked(draft());
    const changed = { ...d, maintenanceTask: { ...d.maintenanceTask, taskId: 'mt-2' } };
    assert.equal(verifyScheduleDataVersion(changed, input(changed))?.detail?.reason, 'selection-changed');
  });

  it('同一張地圖在檢查後被改了路段時間：擋（選取沒變，但資料不是檢查過的那一版）', () => {
    const d = checked(draft());
    const issue = verifyScheduleDataVersion(d, input(d, 75));
    assert.equal(issue?.detail?.reason, 'data-changed');
    assert.match(issue!.message, /檢查之後被修改過/);
  });

  it('指紋不受物件鍵順序影響', () => {
    const d = draft();
    const a = input(d);
    const b = { ...a, maintenanceTaskBody: { mobile: { equipmentRows: [{ mapCode: 'D1' }] } } };
    const reordered = Object.fromEntries(Object.entries(b).reverse()) as unknown as GenerateShiftScheduleInput;
    assert.equal(fingerprintScheduleEngineInput(a), fingerprintScheduleEngineInput(reordered));
  });

  it('檢查紀錄隨草稿存檔、讀回後仍可比對', () => {
    const d = checked(draft());
    const restored = buildShiftScheduleDraftFromStored('測試', serializeShiftScheduleBody(d));
    assert.deepEqual(restored.routeGroups.dataCheck, d.routeGroups.dataCheck);
  });
});
