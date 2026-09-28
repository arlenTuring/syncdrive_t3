import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeScheduleGateOk,
  evaluateScheduleAcceptance,
  resolveIssueDisplayLayerFromIssue,
} from './scheduleAcceptance.ts';
import type { FeasibilityIssue } from './schedule-engine/types.ts';

describe('scheduleAcceptance', () => {
  it('gate passes only when there are no errors', () => {
    assert.equal(computeScheduleGateOk([]), true);
    assert.equal(
      computeScheduleGateOk([
        {
          code: 'STATION_BERTH_COLLISION',
          severity: 'error',
          message: '碰撞',
        },
      ]),
      false,
    );
  });

  it('treats policy berth warnings as noise layer; pulses as limit', () => {
    assert.equal(
      resolveIssueDisplayLayerFromIssue({
        code: 'STATION_BERTH_DELAYED',
        severity: 'warning',
      }),
      'policy',
    );
    assert.equal(
      resolveIssueDisplayLayerFromIssue({
        code: 'HEADWAY_BELOW_TARGET',
        severity: 'warning',
      }),
      'limit',
    );
    assert.equal(
      resolveIssueDisplayLayerFromIssue({
        code: 'STATION_BERTH_COLLISION',
        severity: 'error',
      }),
      'hard',
    );
  });

  it('quality fails on unserved pulse / headway-below but gate can still pass', () => {
    const warnings: FeasibilityIssue[] = [
      {
        code: 'UNSERVED_SERVICE_PULSE',
        severity: 'warning',
        message: '脈衝未承接',
      },
      {
        code: 'STATION_BERTH_DELAYED',
        severity: 'warning',
        message: '延後 10 秒',
      },
    ];
    const summary = evaluateScheduleAcceptance({
      ok: true,
      errors: [],
      warnings,
    });
    assert.equal(summary.gatePassed, true);
    assert.equal(summary.qualityPassed, false);
    assert.equal(summary.qualityFailByCode.UNSERVED_SERVICE_PULSE, 1);
    assert.equal(summary.policyNoiseCount, 1);
  });

  it('documents acceptance criteria lines', () => {
    const summary = evaluateScheduleAcceptance({
      ok: false,
      errors: [
        {
          code: 'ROTATION_CYCLE_INCOMPLETE',
          severity: 'error',
          message: '未完輪',
        },
      ],
      warnings: [],
    });
    assert.equal(summary.gatePassed, false);
    assert.ok(summary.criteria.some((line) => line.includes('禁止發布')));
    assert.ok(summary.criteria.some((line) => line.includes('班距')));
  });

  it('設施交接、轉折點、缺移動、必要轉場失敗都擋發布（不只站位）', () => {
    for (const code of [
      'FACILITY_HANDOVER_GAP',
      'FACILITY_SLOT_COLLISION',
      'MOVE_JUNCTION_CONFLICT',
      'VEHICLE_LOCATION_DISCONTINUITY',
      'MAINTENANCE_TRANSFER_REQUIRED_MISSING',
    ] as const) {
      const severity = code === 'FACILITY_HANDOVER_GAP' || code === 'MOVE_JUNCTION_CONFLICT'
        ? 'warning' as const
        : 'error' as const;
      const issue = { code, severity, message: code } as FeasibilityIssue;
      const summary = evaluateScheduleAcceptance({
        ok: severity !== 'error',
        errors: severity === 'error' ? [issue] : [],
        warnings: severity === 'warning' ? [issue] : [],
      });
      assert.equal(summary.publishSafe, false, `${code} 應擋發布`);
      assert.equal(summary.gatePassed, false, `${code} 不得顯示驗收通過`);
    }
  });

  it('其他硬錯誤也不得顯示可安全發布', () => {
    const summary = evaluateScheduleAcceptance({ ok: false, warnings: [], errors: [
      { code: 'STATION_TIMING_INFEASIBLE', severity: 'error', message: '時間不足' },
    ] });
    assert.equal(summary.publishSafe, false);
  });

  it('「不需要轉場卡」的策略說明不擋發布', () => {
    const summary = evaluateScheduleAcceptance({
      ok: true,
      errors: [],
      warnings: [{ code: 'MAINTENANCE_TRANSFER_UNRESOLVED', severity: 'warning', kind: 'policy', message: 'x' }],
    });
    assert.equal(summary.publishSafe, true);
  });
});
