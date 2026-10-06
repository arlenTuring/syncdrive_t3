import { describe, expect, it } from 'vitest';
import { stepPlaneZoom } from './planeViewScaleLock';

describe('stepPlaneZoom', () => {
  it('steps by five percentage points and clamps bounds', () => {
    expect(stepPlaneZoom(2.05, 1)).toBe(2.1);
    expect(stepPlaneZoom(2.05, -1)).toBe(2);
    expect(stepPlaneZoom(5, 1)).toBe(5);
    expect(stepPlaneZoom(0.2, -1)).toBe(0.2);
  });
});
