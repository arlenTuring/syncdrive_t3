import {
  nextAvailableVehicleCode,
  REGISTERED_VEHICLE_CODE_PATTERN,
  VTMS_VEHICLE_CODE_PATTERN,
} from './vehicle-codes';

describe('vehicle codes', () => {
  it('allocates the first free protocol-compatible identity after the legacy fleet', () => {
    expect(nextAvailableVehicleCode(Array.from(
      { length: 11 },
      (_, index) => `PMS${String(index + 1).padStart(2, '0')}`,
    ))).toBe('PMS12');
  });

  it('never allocates the reserved PMS99 identity', () => {
    const used = Array.from({ length: 98 }, (_, index) => `PMS${String(index + 1).padStart(2, '0')}`);
    expect(nextAvailableVehicleCode(used)).toBeNull();
  });

  it('keeps identity format validation separate from registration', () => {
    expect(VTMS_VEHICLE_CODE_PATTERN.test('PMS12')).toBe(true);
    expect(VTMS_VEHICLE_CODE_PATTERN.test('PMS99')).toBe(true);
    expect(VTMS_VEHICLE_CODE_PATTERN.test('PMS100')).toBe(false);
  });

  it('allows a user-defined safe registration identity without assuming a PMS prefix', () => {
    expect(REGISTERED_VEHICLE_CODE_PATTERN.test('PMS20')).toBe(true);
    expect(REGISTERED_VEHICLE_CODE_PATTERN.test('yard-shuttle_7')).toBe(true);
    expect(REGISTERED_VEHICLE_CODE_PATTERN.test('all')).toBe(false);
    expect(REGISTERED_VEHICLE_CODE_PATTERN.test('bad/topic')).toBe(false);
  });
});
