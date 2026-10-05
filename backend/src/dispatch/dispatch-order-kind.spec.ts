import { businessLineKind, transitionShortLabel } from './dispatch-order-kind';

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

describe('過渡卡短名稱（transitionShortLabel）', () => {
  it('用途＋設施：出廠接出發設施、入廠接目的設施；用途不明回 null（畫面顯示「過渡」）', () => {
    expect(transitionShortLabel('yard_exit', 'E3')).toBe('出廠 E3');
    expect(transitionShortLabel('yard_entry', 'D2')).toBe('入廠 D2');
    expect(transitionShortLabel('standby', 'D3')).toBe('待命 D3');
    expect(transitionShortLabel('hold', 'D1')).toBe('暫停 D1');
    expect(transitionShortLabel('hold', null)).toBe('暫停');
    expect(transitionShortLabel(null, 'E3')).toBeNull();
  });
});
