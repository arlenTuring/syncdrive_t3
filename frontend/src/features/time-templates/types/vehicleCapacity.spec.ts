import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseStoredTemplateBody,
  resolveVehicleCapacityFromBody,
  VEHICLE_CAPACITY_DEFAULT,
} from './editor';

describe('resolveVehicleCapacityFromBody', () => {
  it('reads vehicleCapacity from body', () => {
    assert.equal(resolveVehicleCapacityFromBody({ vehicleCapacity: 70 }), 70);
  });

  it('accepts numeric string', () => {
    assert.equal(resolveVehicleCapacityFromBody({ vehicleCapacity: '70' }), 70);
  });

  it('infers from attribute pphpd and headway when missing', () => {
    // 420 pphpd × 600s / 3600 = 70
    assert.equal(
      resolveVehicleCapacityFromBody({}, [
        {
          id: 'a',
          name: '離峰H',
          color: '#0f0',
          headwaySeconds: 600,
          capacityPphpd: 420,
          isDraft: false,
        },
      ]),
      70,
    );
  });

  it('falls back to default', () => {
    assert.equal(resolveVehicleCapacityFromBody({}), VEHICLE_CAPACITY_DEFAULT);
  });
});

describe('parseStoredTemplateBody vehicleCapacity', () => {
  it('includes vehicleCapacity in preview data', () => {
    const parsed = parseStoredTemplateBody({
      vehicleCapacity: 70,
      attributes: [],
      intervals: [],
      tasks: [],
      scheduleRowCount: 2,
    });
    assert.equal(parsed.vehicleCapacity, 70);
  });

  it('infers capacity when body omits the field', () => {
    const parsed = parseStoredTemplateBody({
      attributes: [
        {
          id: 'a',
          name: '尖峰H',
          color: '#f80',
          headwaySeconds: 180,
          capacityPphpd: 1400,
          isDraft: false,
        },
      ],
      intervals: [],
      tasks: [],
    });
    assert.equal(parsed.vehicleCapacity, 70);
  });
});
