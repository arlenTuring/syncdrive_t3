import {
  classifySimulationOrder,
  summarizeSimulationRun,
  type SimulationRunOrderRow,
} from './dispatch.simulation-run';

let seq = 0;
function order(status: string, payload: Record<string, unknown> = {}, total: number | null = 3): SimulationRunOrderRow {
  seq += 1;
  return {
    orderId: `SIM-PLAN-r1-T${seq}`,
    tripCode: `T${seq}`,
    vehicleCode: 'PMS01',
    status,
    payload: {
      source: 'plan_replay',
      plan_run_id: 'r1',
      plan_shift_id: 'S1',
      plan_load_digest: 'ld1',
      ...(total != null ? { plan_run_total: total } : {}),
      ...payload,
    },
  };
}
const done = (extra: Record<string, unknown> = {}) =>
  order('END', { vehicle_progress_at: { PROCESSING: 1000, END: 2000 }, ...extra });

describe('模擬執行追蹤：分類', () => {
  it('每張單只落一類；取消與故障分開，取消待結案、故障待結案各自一類', () => {
    expect(classifySimulationOrder(order('PENDING'))).toBe('waiting_start');
    expect(classifySimulationOrder(order('PROCESSING'))).toBe('running');
    expect(classifySimulationOrder(order('PROCESSING', { vehicle_phase: 'FAULTED' }))).toBe('fault_pending');
    expect(classifySimulationOrder(order('PROCESSING', { vehicle_fault: { reason: 'PATH_BLOCKED' } }))).toBe('fault_pending');
    expect(classifySimulationOrder(order('PROCESSING', { vehicle_fault: null, vehicle_phase: 'TRANSITING' }))).toBe('running');
    expect(classifySimulationOrder(order('PROCESSING', { cancel_requested_at: 1 }))).toBe('cancel_pending');
    expect(classifySimulationOrder(order('PENDING', { cancel_requested_at: 1 }))).toBe('cancel_pending');
    expect(classifySimulationOrder(order('END'))).toBe('completed');
    expect(classifySimulationOrder(order('FAULTED', { cancel_requested_at: 1 }))).toBe('aborted');
    expect(classifySimulationOrder(order('FAULTED'))).toBe('faulted');
  });
});

describe('模擬執行追蹤：整輪狀態', () => {
  it('正常完成：建單數等於計畫數、全部有車端 END 回報', () => {
    const result = summarizeSimulationRun('r1', [done(), done(), done()]);
    expect(result.state).toBe('closed');
    expect(result.outcome).toBe('all_completed');
    expect(result.vehicle.started).toBe(3);
    expect(result.issues).toEqual([]);
  });

  it('部分建單失敗：已建的都結束，但少了計畫項，不能算全部完成', () => {
    const result = summarizeSimulationRun('r1', [done(), done()]);
    expect(result.state).toBe('closed');
    expect(result.outcome).toBe('incomplete');
    expect(result.not_created).toBe(1);
    expect(result.issues.join()).toMatch(/1 項計畫沒有建單/);
  });

  it('取消：從沒開始就被取消的單不算「已開始」，結果是有問題的結案', () => {
    const result = summarizeSimulationRun('r1', [
      done(),
      order('FAULTED', { cancel_requested_at: 5, closed_reason: 'cancelled_by_center', vehicle_progress_at: { FAULTED: 6 } }),
      order('FAULTED', { cancel_requested_at: 5, vehicle_progress_at: { PROCESSING: 3, FAULTED: 6 } }),
    ]);
    expect(result.counts.aborted).toBe(2);
    expect(result.counts.completed).toBe(1);
    expect(result.vehicle.started).toBe(2);
    expect(result.outcome).toBe('closed_with_issues');
  });

  it('中心端寫的完成不算車端證據', () => {
    const result = summarizeSimulationRun('r1', [done(), done(), order('END', { vehicle_progress_at: { PROCESSING: 1 } })]);
    expect(result.outcome).toBe('closed_with_issues');
    expect(result.issues.join()).toMatch(/沒有車端 END 回報/);
  });

  it('還有未結束的單：不是 closed，列出卡在哪', () => {
    const result = summarizeSimulationRun('r1', [
      done(),
      order('PROCESSING', { vehicle_phase: 'FAULTED', vehicle_progress_at: { PROCESSING: 1 } }),
      order('PENDING'),
    ]);
    expect(result.state).toBe('in_progress');
    expect(result.outcome).toBeNull();
    expect(result.open_orders.map((o) => o.category)).toEqual(['fault_pending', 'waiting_start']);
  });

  it('已建單、沒有任何車端回報：等待車端回報', () => {
    const result = summarizeSimulationRun('r1', [order('PENDING'), order('PENDING')]);
    expect(result.state).toBe('waiting_vehicle_report');
  });

  it('零訂單：no_orders，不宣稱完成', () => {
    const result = summarizeSimulationRun('r1', []);
    expect(result.state).toBe('no_orders');
    expect(result.outcome).toBeNull();
    expect(result.planned_total).toBeNull();
  });

  it('舊訂單沒有本輪計畫數：計畫數未知，不宣稱整輪完成', () => {
    const result = summarizeSimulationRun('r1', [order('END', { vehicle_progress_at: { END: 1 } }, null)]);
    expect(result.outcome).toBe('plan_size_unknown');
  });

  it('計畫數只看訂單上的記錄，不同值時不判斷完成', () => {
    const result = summarizeSimulationRun('r1', [done(), order('END', { vehicle_progress_at: { END: 1 } }, 5)]);
    expect(result.planned_total).toBeNull();
    expect(result.outcome).toBe('plan_size_unknown');
    expect(result.issues.join()).toMatch(/計畫數不一致/);
  });
});
