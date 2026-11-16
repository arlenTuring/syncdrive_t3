import {
  generateShiftSchedule,
  needsAlternateVariant,
  selectShiftScheduleVariant,
  setScheduleEngineProgressReporter,
  type GenerateShiftScheduleInput,
  type ScheduleEngineProgress,
} from '../generate';
import type { GenerateShiftScheduleResult, ShiftScheduleVariant } from '../types';

export type { ScheduleEngineProgress };

/** 呼叫端取消（換頁、按取消、開始了更新的生成）時丟出的錯誤 */
export class ScheduleEngineCancelledError extends Error {
  constructor() {
    super('已取消這次排班生成');
    this.name = 'ScheduleEngineCancelledError';
  }
}

let nextRequestId = 1;

type WorkerMessage = {
  id: number;
  type: string;
  result?: GenerateShiftScheduleResult;
  progress?: ScheduleEngineProgress;
  message?: string;
};

/**
 * 在背景執行緒跑排班引擎（白皮書 GEN-15）。
 *
 * - 兩個派車版本（base／alt，見 generateShiftSchedule）各開一個背景執行緒<strong>同時</strong>跑，
 *   各自有完整的搜尋預算；兩份都回來後用 selectShiftScheduleVariant 挑一份。
 *   base 沒有漏接脈衝就不需要 alt，直接停掉 alt 的執行緒。總等待時間約等於較慢的那一份。
 * - 進度：onProgress 收到較慢那個版本的階段回報。
 * - 取消：signal 觸發就終止兩個背景執行緒，丟出 ScheduleEngineCancelledError；不留下任何結果。
 * - 過期結果：每次呼叫都用自己的執行緒與編號，舊的結果不會蓋掉新的（呼叫端取消舊的即可）。
 * - alt 執行失敗只記在 report.variantSelection，用 base；base 失敗才算這次生成失敗。
 * - base 無錯誤細節地中止時，用單一執行緒依序重試一次。
 *
 * 沒有 Worker 的環境（單元測試、Node 重播）直接在目前執行緒依序跑兩個版本，選擇規則相同。
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
  const variants: ShiftScheduleVariant[] = ['base', 'alt'];
  const workers = new Map<ShiftScheduleVariant, Worker>();
  const progressByVariant = new Map<ShiftScheduleVariant, ScheduleEngineProgress>();
  let base: GenerateShiftScheduleResult | null = null;
  let alt: GenerateShiftScheduleResult | null = null;
  let altFailure: string | null = null;
  let settled = false;
  let retrying = false;

  return new Promise<GenerateShiftScheduleResult>((resolve, reject) => {
    const stop = (variant: ShiftScheduleVariant) => {
      workers.get(variant)?.terminate();
      workers.delete(variant);
      progressByVariant.delete(variant);
    };
    const finish = () => {
      settled = true;
      for (const variant of variants) stop(variant);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      finish();
      reject(new ScheduleEngineCancelledError());
    };
    const fail = (message: string) => {
      if (settled) return;
      finish();
      reject(new Error(message));
    };
    /** base 回來、且 alt 已回來／已失敗／不需要時，挑一份 */
    const trySettle = () => {
      if (settled || !base) return;
      if (!needsAlternateVariant(base)) {
        const chosen = selectShiftScheduleVariant(base, null);
        finish();
        resolve(chosen);
        return;
      }
      if (retrying && !alt && altFailure === null && !workers.has('alt')) {
        start('alt');
        return;
      }
      if (!alt && altFailure === null) return;
      const chosen = selectShiftScheduleVariant(base, alt, altFailure !== null ? { altFailure } : {});
      finish();
      resolve(chosen);
    };
    const emitProgress = () => {
      let slowest: ScheduleEngineProgress | null = null;
      for (const progress of progressByVariant.values()) {
        if (!slowest || progress.fraction < slowest.fraction) slowest = progress;
      }
      if (slowest) options.onProgress?.(slowest);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const failVariant = (variant: ShiftScheduleVariant, message: string) => {
      if (settled) return;
      stop(variant);
      if (variant === 'base') fail(message);
      else {
        altFailure = message;
        trySettle();
      }
    };

    const start = (variant: ShiftScheduleVariant) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('./scheduleEngine.worker.ts', import.meta.url), { type: 'module' });
      } catch (error) {
        failVariant(variant, `無法啟動排班背景執行緒：${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      workers.set(variant, worker);
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const data = event.data;
        if (settled || workers.get(variant) !== worker || data.id !== id) return;
        if (data.type === 'progress' && data.progress) {
          progressByVariant.set(variant, data.progress);
          emitProgress();
          return;
        }
        stop(variant);
        if (data.type === 'result' && data.result) {
          if (variant === 'base') base = data.result;
          else alt = data.result;
        } else if (variant === 'base') {
          fail(data.message ?? '排班引擎背景執行失敗');
          return;
        } else {
          altFailure = data.message ?? '排班引擎背景執行失敗';
        }
        trySettle();
      };
      worker.onerror = (event) => {
        if (settled || workers.get(variant) !== worker) return;
        const detail = event.message?.trim();
        console.error('排班背景執行緒發生錯誤', variant, event);
        if (variant === 'base' && !detail && !retrying) {
          retrying = true;
          stop('base');
          stop('alt');
          alt = null;
          altFailure = null;
          options.onProgress?.({ stage: 'normalize', fraction: 0, message: '背景排班中止，正在改用單一背景執行緒重試' });
          if (!settled) start('base');
          return;
        }
        failVariant(variant, detail
          ? `排班引擎背景執行失敗：${detail}`
          : '排班背景執行緒無法載入或意外中止。請重新生成；若仍失敗，再重新整理頁面。');
      };
      worker.onmessageerror = () => {
        if (workers.get(variant) === worker) failVariant(variant, '無法讀取背景排班結果，請重新產生班表。');
      };
      try {
        worker.postMessage({ id, input, variant });
      } catch (error) {
        failVariant(variant, `無法傳送排班資料：${error instanceof Error ? error.message : String(error)}`);
      }
    };
    start('base');
    if (!settled && !retrying) start('alt');
  });
}
