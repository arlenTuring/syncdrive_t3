import { ConflictException } from '@nestjs/common';
import { DispatchController } from './dispatch.controller';
import { REALTIME_CLOCK, applyClockUpdate, describeClock, type ClockState } from '../operating-day/operating-clock';

/** 只測營運時鐘的狀態轉換檢核：用真的時鐘規則、假的持久化 */
function controllerWith(initial: ClockState) {
  let state = initial;
  const clock = {
    snapshot: () => describeClock(state, Date.now()),
    update: async (u: Parameters<typeof applyClockUpdate>[1]) => {
      state = applyClockUpdate(state, u, Date.now());
      return describeClock(state, Date.now());
    },
  };
  const controller = new DispatchController({} as never, {} as never, clock as never, {} as never);
  return { controller, state: () => state };
}

const pausedReplay: ClockState = {
  ...REALTIME_CLOCK,
  mode: 'replay',
  runId: 'mvafnd8f',
  operatingDay: '2026-10-16',
  segments: [{ realStart: 1, opStart: 1792131252510, rate: 10, paused: true }],
  heartbeatAt: 1,
};

describe('POST operating-clock 的 expected_run_id 檢核', () => {
  it('預期的執行 ID 相符：切回即時', async () => {
    const { controller, state } = controllerWith(pausedReplay);
    const res = await controller.updateOperatingClock({ mode: 'realtime', expected_run_id: 'mvafnd8f' });
    expect(res.mode).toBe('realtime');
    expect(state().mode).toBe('realtime');
  });

  it('預期與實際不同（別的執行端剛接手）：409，時鐘不變', async () => {
    const { controller, state } = controllerWith({ ...pausedReplay, runId: 'other-run' });
    await expect(controller.updateOperatingClock({ mode: 'realtime', expected_run_id: 'mvafnd8f' })).rejects.toBeInstanceOf(ConflictException);
    expect(state().runId).toBe('other-run');
  });

  it('預期即時（null）而目前也是即時：冪等成功', async () => {
    const { controller } = controllerWith({ ...REALTIME_CLOCK });
    const res = await controller.updateOperatingClock({ mode: 'realtime', expected_run_id: null });
    expect(res.mode).toBe('realtime');
  });

  it('沒帶 expected_run_id：照舊（執行端心跳不受影響）', async () => {
    const { controller } = controllerWith(pausedReplay);
    const res = await controller.updateOperatingClock({ mode: 'replay', run_id: 'mvafnd8f', operating_day: '2026-10-16', operating_now: 1792131252510, rate: 10, paused: true });
    expect(res.mode).toBe('replay');
  });
});
