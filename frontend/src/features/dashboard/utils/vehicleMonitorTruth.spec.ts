import { describe, expect, it } from 'vitest';
import { resolveVehicleLocationLabel } from './resolveVehicleLocationLabel';
import { resolveVehicleMonitorBadge } from './resolveVehicleMonitorBadge';

describe('vehicle monitor live truth', () => {
  it('uses the backend-persisted location instead of recalculating from MQTT', () => {
    expect(resolveVehicleLocationLabel({
      telemetry: { yard_slot_id: 'E2' },
      operation: { yard_slot_id: 'E2', line_kind: 'MAINTENANCE' },
      variables: { segment_label: 'D1', yard_slot_id: 'E2', badge_kind: 'maintenance' },
    })).toBe('D1');
  });

  it('keeps the deployed schedule label even when operation MQTT is IDLE', () => {
    expect(resolveVehicleMonitorBadge(
      {
        order_status: 'PENDING',
        line_kind: 'MAINTENANCE',
        maint_type_label: '充電',
        badge_label: '充電',
        badge_kind: 'maintenance',
      },
      { operation: { order_status: 'IDLE', vehicle_phase: 'IDLE' } },
    )).toEqual({ label: '充電', bg: '#422006', color: '#FD9A00', kind: 'maintenance' });
  });

  it('accepts current route-code trip ids from MQTT', () => {
    expect(resolveVehicleMonitorBadge(
      {},
      {
        operation: {
          line_kind: 'MAINLINE',
          order_status: 'PENDING',
          trip_code: 'ST1450',
        },
      },
    ).label).toBe('ST1450');
  });
});
