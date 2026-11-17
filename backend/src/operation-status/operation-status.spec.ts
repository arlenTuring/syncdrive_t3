import { resolveOperationStatus } from './operation-status';

describe('場域營運狀態', () => {
  const normal = { degradedMode: 'normal' as const, degradedPlanName: null, scheduleName: '模擬正線_1112', dispatchEnabled: true };

  it('全部正常：正常營運，補充是使用中的班表', () => {
    expect(resolveOperationStatus(normal)).toMatchObject({ status_code: 'normal', status_label: '正常營運', detail: '模擬正線_1112' });
  });

  it('取最嚴重的一種：未知 > 降級 > 未部署班表 > 調度暫停', () => {
    expect(resolveOperationStatus({ ...normal, dispatchEnabled: false }).status_code).toBe('dispatch_paused');
    expect(resolveOperationStatus({ ...normal, dispatchEnabled: false, scheduleName: null }).status_code).toBe('no_schedule');
    expect(resolveOperationStatus({ ...normal, scheduleName: null, degradedMode: 'degraded', degradedPlanName: 'T3 單線' }))
      .toMatchObject({ status_code: 'degraded', status_label: '降級運轉中', detail: 'T3 單線' });
    expect(resolveOperationStatus({ ...normal, degradedMode: 'unknown' }))
      .toMatchObject({ status_code: 'unknown', detail: '降級狀態與執行紀錄不一致' });
    expect(resolveOperationStatus({ ...normal, degradedMode: null }))
      .toMatchObject({ status_code: 'unknown', detail: '讀不到降級狀態' });
  });
});
