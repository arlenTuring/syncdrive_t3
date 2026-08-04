import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildActionFacilityGroupsFromAreas,
  decodeFacilityTargetValue,
  encodeFacilityTargetValue,
  generalLabelForActionFacilityType,
} from './actionFacilityOptions.ts';
import type { FacilityObject } from '../../map-editor/types/facility';

function facility(
  partial: Partial<FacilityObject> & Pick<FacilityObject, 'id' | 'type'>,
): FacilityObject {
  return {
    name: 'Light',
    customName: '',
    areaPosition: { x: 0, y: 0 },
    position: { x: 0, y: 0 },
    rotation: 0,
    state: 'Normal',
    ...partial,
  } as FacilityObject;
}

describe('actionFacilityOptions', () => {
  it('encodes and decodes general / specific facility targets', () => {
    assert.equal(
      encodeFacilityTargetValue('general_facility', 'Signal'),
      'general:Signal',
    );
    assert.equal(
      encodeFacilityTargetValue('specific_facility', 'sig-1'),
      'facility:sig-1',
    );
    assert.deepEqual(decodeFacilityTargetValue('general:Signal'), {
      targetKind: 'general_facility',
      targetId: 'Signal',
    });
    assert.deepEqual(decodeFacilityTargetValue('facility:sig-1'), {
      targetKind: 'specific_facility',
      targetId: 'sig-1',
    });
  });

  it('classifies equipment vs facility area types', () => {
    const groups = buildActionFacilityGroupsFromAreas([
      {
        facilities: [
          facility({ id: 'sig-b', type: 'Signal', customName: 'B 號誌' }),
          facility({ id: 'sig-a', type: 'Signal', customName: 'A 號誌' }),
          facility({ id: 'pole-1', type: 'Pole', customName: '電桿 1' }),
          facility({ id: 'psd-1', type: 'PSD', customName: '月台門 1' }),
          facility({
            id: 'fac-1',
            type: 'Facility',
            customName: 'E01',
            parameters: { purpose: '充電格' },
          }),
          facility({ id: 'track-1', type: 'Track', customName: '軌道' }),
          facility({ id: 'fake-pole', type: 'Facility', customName: 'R04', parameters: { purpose: '智慧桿' } }),
          facility({ id: 'dock-1', type: 'DockingPoint', customName: '站點' }),
        ],
      },
    ]);

    assert.deepEqual(
      groups.map((group) => group.type),
      ['Signal', 'Pole', 'PSD', 'Facility'],
    );
    assert.deepEqual(
      groups.map((group) => group.category),
      ['equipment', 'equipment', 'equipment', 'facility_area'],
    );
    const signal = groups.find((group) => group.type === 'Signal');
    assert.ok(signal);
    assert.equal(signal.generalLabel, generalLabelForActionFacilityType('Signal'));
    assert.deepEqual(
      signal.facilities.map((item) => item.name),
      ['A 號誌', 'B 號誌'],
    );
    const facilityGroup = groups.find((group) => group.type === 'Facility');
    assert.ok(facilityGroup);
    assert.deepEqual(
      facilityGroup.facilities.map((item) => item.name).sort(),
      ['E01', 'R04'],
    );
  });
});
