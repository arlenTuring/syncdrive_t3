import { describe, expect, it } from 'vitest';
import { createWidget } from '../types';
import { migrateStationEtaChildren } from './migrateDashboardPlane';

describe('station ETA migration', () => {
  it('keeps the original id and binding while adding one editable station label', () => {
    const old = { ...createWidget('station-eta', 100, 20), id: 'eta-n2w', title: 'N2W 到站／出發', stations: [{ stationId: 'n2w', label: 'N2W', events: ['arrive' as const] }] };
    const once = migrateStationEtaChildren([old]);
    const twice = migrateStationEtaChildren(once);
    expect(once).toEqual(twice);
    expect(once.map(widget => widget.id)).toEqual(['eta-n2w-station-label', 'eta-n2w']);
    const list = once[1];
    expect(list.type).toBe('tab-list');
    if (list.type === 'tab-list') expect(list.tabs[0]?.dataUrl).toContain('arrive=n2w');
  });
});
