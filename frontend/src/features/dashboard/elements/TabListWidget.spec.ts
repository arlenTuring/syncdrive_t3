import { describe, expect, it } from 'vitest';
import { coupleTabListRows, formatTabListCountdown, mergeTabListRows, readTabListPath, resizeTabListColumn } from './TabListWidget';

describe('generic tab list data rows', () => {
  it('reads nested rows and only merges MQTT data into the matching event', () => {
    const query = [{ events: [
      { event: { id: 'arrival-1' }, vehicle_name: 'PMS01' },
      { event: { id: 'departure-2' }, vehicle_name: 'PMS02' },
    ] }];
    const mqtt = { event: { id: 'departure-2' }, remaining_seconds: 30 };
    const rows = mergeTabListRows(query, 'events', mqtt, 'event.id');

    expect(readTabListPath(rows[0], 'remaining_seconds')).toBeUndefined();
    expect(rows[1]).toMatchObject({ vehicle_name: 'PMS02', remaining_seconds: 30 });
  });

  it('does not promote an unconfirmed future departure over the current arrival', () => {
    const rows = coupleTabListRows([
      { coupling_key: 'PMS01-stop-1', row_key: 'PMS01-stop-1', event: 'arrive', label: '到站' },
      { coupling_key: 'PMS01-stop-1', row_key: 'PMS01-stop-1', event: 'depart', label: '出發' },
    ], {
      enabled: true,
      relationKeyField: 'coupling_key',
      stableKeyField: 'row_key',
      statusField: 'event',
      statusOrder: ['arrive', 'depart'],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ __row_key: 'PMS01-stop-1', event: 'arrive', label: '到站' });
  });

  it('shows departure when the source confirms it as the only current state', () => {
    const rows = coupleTabListRows([
      { coupling_key: 'PMS01-stop-1', row_key: 'PMS01-stop-1', event: 'depart', label: '出發' },
    ], {
      enabled: true,
      relationKeyField: 'coupling_key',
      stableKeyField: 'row_key',
      statusField: 'event',
      statusOrder: ['arrive', 'depart'],
    });
    expect(rows[0]).toMatchObject({ __row_key: 'PMS01-stop-1', event: 'depart', label: '出發' });
  });

  it('does not turn invalid or overdue time into a normal zero countdown', () => {
    expect(formatTabListCountdown(null, 1000)).toBe('—');
    expect(formatTabListCountdown(900, 1000, 'overdue')).toBe('延誤');
    expect(formatTabListCountdown(900, 1000, 'due')).toBe('待發');
  });

  it('converts pointer distance through the canvas scale when resizing one column', () => {
    expect(resizeTabListColumn(48, 10, 1)).toBe(58);
    expect(resizeTabListColumn(48, 20.5, 2.05)).toBe(58);
    expect(resizeTabListColumn(48, 40.5, 4.05)).toBe(58);
    expect(resizeTabListColumn(35, -20.5, 2.05)).toBe(30);
  });
});
