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
    assert.ok(summary.criteria.some((line) => line.includes('硬閘')));
    assert.ok(summary.criteria.some((line) => line.includes('qualityPassed')));
  });
});
