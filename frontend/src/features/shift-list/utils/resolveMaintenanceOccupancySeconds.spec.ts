import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveMaintenanceOccupancySeconds } from './resolveMaintenanceOccupancySeconds';

describe('resolveMaintenanceOccupancySeconds', () => {
  it('does not let 行前 body duration override the template bar', () => {
    assert.equal(
      resolveMaintenanceOccupancySeconds('inspection', {
        preTrip: {
          stepEnabled: true,
          operationDurationMinutes: '20',
        },
      }),
      null,
    );
  });

  it('standby follows template by default; override when follow is off', () => {
    assert.equal(
      resolveMaintenanceOccupancySeconds('standby', {
        mobile: {
          stepEnabled: true,
          durationFollowTemplate: true,
          operationDurationMinutes: '20',
        },
      }),
      null,
    );
    assert.equal(
      resolveMaintenanceOccupancySeconds('standby', {
        mobile: {
          stepEnabled: true,
          durationFollowTemplate: false,
          operationDurationMinutes: '20',
        },
      }),
      20 * 60,
    );
  });
});
