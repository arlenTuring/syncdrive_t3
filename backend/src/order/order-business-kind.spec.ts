import { classifyTask, orderBusinessKind } from './order-business-kind';

describe('orderBusinessKind', () => {
  it('line_kind 已是業務分類就照它', () => {
    expect(
      orderBusinessKind({
        lineKind: 'MAINTENANCE',
        payload: { kind: 'passenger' },
      }),
    ).toBe('MAINTENANCE');
    expect(orderBusinessKind({ lineKind: 'transition' })).toBe('TRANSITION');
  });

  it('舊版模擬器 TEST 單：依 kind 與整備子類型換算，待命是過渡不是整備', () => {
    const replay = (payload: Record<string, unknown>) =>
      orderBusinessKind({
        lineKind: 'TEST',
        payload: { source: 'plan_replay', ...payload },
      });
    expect(replay({ kind: 'passenger' })).toBe('MAINLINE');
    expect(replay({ kind: 'movement' })).toBe('TRANSITION');
    expect(
      replay({ kind: 'maintenance', maintenance_task_type: 'standby' }),
    ).toBe('TRANSITION');
    expect(replay({ kind: 'maintenance', maintenance_task_type: 'idle' })).toBe(
      'TRANSITION',
    );
    expect(
      replay({ kind: 'maintenance', maintenance_task_type: 'servicing' }),
    ).toBe('MAINTENANCE');
    expect(
      replay({ kind: 'maintenance', maintenance_task_type: 'charging' }),
    ).toBe('MAINTENANCE');
    // 子類型不明：不猜
    expect(replay({ kind: 'maintenance' })).toBeNull();
  });

  it('人工測試單維持 TEST，不歸任何業務分類', () => {
    expect(
      orderBusinessKind({
        lineKind: 'TEST',
        payload: { source: 'manual_test', kind: 'passenger' },
      }),
    ).toBe('TEST');
  });

  it('classifyTask 與正式調度同一套', () => {
    expect(classifyTask('maintenance', 'washing')).toBe('MAINTENANCE');
    expect(classifyTask('movement', 'dispatch')).toBe('TRANSITION');
    expect(classifyTask(null, null)).toBeNull();
  });
});
