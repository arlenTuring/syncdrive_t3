import { describe, expect, it } from 'vitest';
import { resolveVehicleMonitorBadge } from './resolveVehicleMonitorBadge';

/** 車輛狀態列 SQL 的一列（只放標籤用到的欄位） */
const row = (fields: Record<string, unknown>) => ({ order_status: 'PROCESSING', ...fields });

describe('resolveVehicleMonitorBadge: categories come from the deployed schedule', () => {
  it('mainline, maintenance (保養／充電) and transition each get their own label', () => {
    expect(resolveVehicleMonitorBadge(row({ line_kind: 'MAINLINE', badge_label: 'TS0620', badge_kind: 'mainline' })))
      .toMatchObject({ label: 'TS0620', kind: 'mainline' });
    expect(resolveVehicleMonitorBadge(row({ line_kind: 'MAINTENANCE', badge_label: '保養', badge_kind: 'maintenance' })))
      .toMatchObject({ label: '保養', kind: 'maintenance' });
    expect(resolveVehicleMonitorBadge(row({ line_kind: 'MAINTENANCE', badge_label: '充電', badge_kind: 'maintenance' })))
      .toMatchObject({ label: '充電', kind: 'maintenance' });
    expect(resolveVehicleMonitorBadge(row({
      line_kind: 'TRANSITION',
      maint_type_label: '整備',
      badge_label: '過渡',
      badge_kind: 'transition',
      badge_detail: '待命 D3',
      trip_badge_bg: '#6D28D9',
      trip_badge_color: '#FFFFFF',
    }))).toEqual({ label: '過渡', kind: 'transition', bg: '#6D28D9', color: '#FFFFFF', detail: '待命 D3' });
  });

  it('a standby order parked in a maintenance slot is transition, never 保養／整備', () => {
    const badge = resolveVehicleMonitorBadge(
      row({ line_kind: 'TRANSITION', maint_type_label: '保養', badge_label: '過渡', badge_kind: 'transition' }),
      { operation: { order_status: 'PROCESSING', vehicle_phase: 'YARD_DWELLING', trip_code: 'MT-D3-R4-27350' } },
    );
    expect(badge.kind).toBe('transition');
    expect(badge.label).toBe('過渡');
  });

  it('MQTT progress without a category does not blank the scheduled label', () => {
    const badge = resolveVehicleMonitorBadge(
      row({ line_kind: 'TRANSITION', badge_label: '過渡', badge_kind: 'transition', badge_detail: '出廠 E3' }),
      { operation: { order_status: 'PROCESSING', vehicle_phase: 'TRANSITING', trip_code: 'MT-E3-R1-0' } },
    );
    expect(badge).toMatchObject({ label: '過渡', detail: '出廠 E3' });
  });

  it('does not guess a maintenance label from location or phase when the schedule has no category', () => {
    expect(resolveVehicleMonitorBadge(
      row({ maint_type_label: '充電' }),
      { operation: { order_status: 'PROCESSING', vehicle_phase: 'CHARGING' } },
    )).toMatchObject({ label: '', kind: 'none' });
  });

  it('no active order stays empty (standby), and switching orders leaves nothing behind', () => {
    expect(resolveVehicleMonitorBadge({}).label).toBe('');
    const before = resolveVehicleMonitorBadge(row({ line_kind: 'MAINTENANCE', badge_label: '保養', badge_kind: 'maintenance' }));
    const after = resolveVehicleMonitorBadge(row({ line_kind: 'MAINLINE', badge_label: 'TN0620', badge_kind: 'mainline' }));
    expect(before.label).toBe('保養');
    expect(after).toMatchObject({ label: 'TN0620', kind: 'mainline' });
  });
});
