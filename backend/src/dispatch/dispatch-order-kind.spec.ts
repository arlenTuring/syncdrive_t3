import { businessLineKind } from './dispatch-order-kind';

describe('businessLineKind', () => {
  it('classifies from structured purpose instead of labels', () => {
    expect(businessLineKind({ kind: 'passenger', taskType: 'passenger' })).toBe('MAINLINE');
    expect(businessLineKind({ kind: 'movement', taskType: 'dispatch' })).toBe('TRANSITION');
    expect(businessLineKind({ kind: 'maintenance', taskType: 'standby' })).toBe('TRANSITION');
    expect(businessLineKind({ kind: 'maintenance', taskType: 'charging' })).toBe('MAINTENANCE');
  });
});
