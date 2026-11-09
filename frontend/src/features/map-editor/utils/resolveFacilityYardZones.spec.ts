import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MapAreaObject } from '../types/area';
import { resolveFacilityYardZones } from './zonePartition';

function facility(id: string, name: string, parameters: Record<string, unknown> = {}) {
  return { id, type: 'Facility', name, parameters } as never;
}

describe('resolveFacilityYardZones', () => {
  const areas = [{
    id: 'a',
    facilities: [
      facility('yard', 'ZoneEntrance', { zoneEntranceLinks: [
        { id: 'l1', name: '整備區', xMinM: 0, xMaxM: 1, yMinM: 0, yMaxM: 1, zoneFacilityId: 'pm' },
        { id: 'l2', name: '調度區', xMinM: 0, xMaxM: 1, yMinM: 0, yMaxM: 1, zoneFacilityId: 'ph' },
      ] }),
      facility('pm', 'ZonePartition', { zonePartitionEntranceId: 'yard' }),
      facility('ph', 'ZonePartition'),
      facility('charge', 'ZonePartition'),
      facility('M1', 'FacilityArea', { parentZoneId: 'pm' }),
      facility('H1', 'FacilityArea', { parentZoneId: 'ph' }),
      facility('E1', 'FacilityArea', { parentZoneId: 'charge' }),
      facility('E2', 'FacilityArea', { parentZoneId: 'charge' }),
      facility('loose', 'FacilityArea'),
    ],
  }] as unknown as MapAreaObject[];

  it('同一個入口下的分區算同一個場區（整備區與調度區互通）', () => {
    const zones = resolveFacilityYardZones(areas);
    assert.equal(zones.get('M1'), 'yard');
    assert.equal(zones.get('H1'), 'yard', '分區沒寫入口時，從入口的連結反查');
  });

  it('分區沒掛入口就以分區本身當場區；不在分區裡的格位沒有場區', () => {
    const zones = resolveFacilityYardZones(areas, (id) => `fdock:${id}`);
    assert.equal(zones.get('E1'), 'charge');
    assert.equal(zones.get('E2'), 'charge');
    assert.equal(zones.get('fdock:E1'), 'charge');
    assert.equal(zones.has('loose'), false);
  });
});
