import { describe, expect, it } from 'vitest';
import { mergeTabListRows, readTabListPath } from './TabListWidget';

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
});
