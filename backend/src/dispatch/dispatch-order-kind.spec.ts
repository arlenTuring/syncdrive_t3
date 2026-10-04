import { businessLineKind } from './dispatch-order-kind';

describe('businessLineKind', () => {
  it('classifies from structured purpose instead of labels', () => {
    expect(businessLineKind({ kind: 'passenger', taskType: 'passenger' })).toBe(
      'MAINLINE',
    );
    expect(businessLineKind({ kind: 'movement', taskType: 'dispatch' })).toBe(
      'TRANSITION',
    );
    expect(businessLineKind({ kind: 'maintenance', taskType: 'standby' })).toBe(
      'TRANSITION',
    );
    expect(
      businessLineKind({ kind: 'maintenance', taskType: 'charging' }),
    ).toBe('MAINTENANCE');
  });

  it('整備班次看原任務子類型：待命、暫停是過渡，不是整備', () => {
    const yard = (taskType: string) => ({
      kind: 'maintenance' as const,
      taskType: 'maintenance',
      maintenance: { taskType },
    });
    expect(businessLineKind(yard('standby'))).toBe('TRANSITION');
    expect(businessLineKind(yard('idle'))).toBe('TRANSITION');
    expect(businessLineKind(yard('servicing'))).toBe('MAINTENANCE');
    expect(businessLineKind(yard('charging'))).toBe('MAINTENANCE');
  });
});
