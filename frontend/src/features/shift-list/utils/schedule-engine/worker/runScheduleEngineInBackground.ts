import {
  generateShiftSchedule,
  setScheduleEngineProgressReporter,
  type GenerateShiftScheduleInput,
  type ScheduleEngineProgress,
} from '../generate';
import type { GenerateShiftScheduleResult } from '../types';

export type { ScheduleEngineProgress };

/** 呼叫端取消（換頁、按取消、開始了更新的生成）時丟出的錯誤 */
export class ScheduleEngineCancelledError extends Error {
  constructor() {
    super('已取消這次排班生成');
    this.name = 'ScheduleEngineCancelledError';
  }
}

let nextRequestId = 1;

/**
 * 在背景執行緒跑排班引擎（白皮書 GEN-15）。
 *
 * - 進度：onProgress 收到引擎的階段回報（整理輸入、站位與班距調整第 n 輪、轉場、搜尋、驗證）。
 * - 取消：signal 觸發就終止背景執行緒，丟出 ScheduleEngineCancelledError；不留下任何結果。
 * - 過期結果：每次呼叫都用自己的執行緒與編號，舊的結果不會蓋掉新的（呼叫端取消舊的即可）。
 * - 同一份輸入：背景執行緒跑的是同一個 generateShiftSchedule，輸入以結構化複製傳入，結果相同。
 *
 * 沒有 Worker 的環境（單元測試、Node 重播）直接在目前執行緒跑，行為一樣。
 */
export function runScheduleEngineInBackground(
  input: GenerateShiftScheduleInput,
  options: { signal?: AbortSignal; onProgress?: (progress: ScheduleEngineProgress) => void } = {},
): Promise<GenerateShiftScheduleResult> {
  if (options.signal?.aborted) return Promise.reject(new ScheduleEngineCancelledError());
  if (typeof Worker === 'undefined') {
    setScheduleEngineProgressReporter(options.onProgress ?? null);
    try {
      return Promise.resolve(generateShiftSchedule(input));
    } finally {
      setScheduleEngineProgressReporter(null);
    }
  }
  const id = nextRequestId;
  nextRequestId += 1;
  const worker = new Worker(new URL('./scheduleEngine.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<GenerateShiftScheduleResult>((resolve, reject) => {
    const finish = () => {
      worker.terminate();
      options.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(new ScheduleEngineCancelledError());
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<{ id: number; type: string; result?: GenerateShiftScheduleResult; progress?: ScheduleEngineProgress; message?: string }>) => {
      const data = event.data;
      if (data.id !== id) return;
      if (data.type === 'progress' && data.progress) {
        options.onProgress?.(data.progress);
        return;
      }
      finish();
      if (data.type === 'result' && data.result) resolve(data.result);
      else reject(new Error(data.message ?? '排班引擎背景執行失敗'));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(`排班引擎背景執行失敗：${event.message}`));
    };
    worker.postMessage({ id, input });
  });
}
