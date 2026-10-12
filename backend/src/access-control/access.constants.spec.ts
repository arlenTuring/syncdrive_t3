import { ACCESS_PERMISSIONS, PERMISSION_BY_CODE } from './access.constants';

describe('permission catalog', () => {
  it('has unique stable codes and every operation depends on its page view', () => {
    const codes = ACCESS_PERMISSIONS.map((permission) => permission.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const permission of ACCESS_PERMISSIONS) {
      if (permission.action === 'view') expect(permission.requires).toBeUndefined();
      else expect(PERMISSION_BY_CODE.has(permission.requires!)).toBe(true);
    }
  });

  it('keeps same-name order records separate by module', () => {
    expect(PERMISSION_BY_CODE.has('service.order-records.view')).toBe(true);
    expect(PERMISSION_BY_CODE.has('media.order-records.view')).toBe(true);
  });
});
