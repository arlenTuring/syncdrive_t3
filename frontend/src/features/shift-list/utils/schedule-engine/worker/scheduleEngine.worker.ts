/// <reference lib="webworker" />
/**
 * 排班引擎背景執行緒：生成是一段長時間的同步運算，放在主執行緒會讓頁面無回應、瀏覽器跳出「請稍候」
 * （白皮書 GEN-15）。這裡只負責收輸入、跑一個派車版本、回傳結果與進度；
 * 兩個版本由呼叫端各開一個執行緒同時跑，再用同一個選擇規則挑一份（見 runScheduleEngineInBackground）。
 */
import {
  generateShiftScheduleVariant,
  setScheduleEngineProgressReporter,
  type GenerateShiftScheduleInput,
} from '../generate';
import type { ShiftScheduleVariant } from '../types';

type Request = { id: number; input: GenerateShiftScheduleInput; variant: ShiftScheduleVariant };

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, input, variant } = event.data;
  setScheduleEngineProgressReporter((progress) => {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, type: 'progress', progress });
  });
  try {
    const result = generateShiftScheduleVariant(input, variant);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, type: 'result', result });
  } catch (error) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({
      id,
      type: 'error',
      message: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
    });
  } finally {
    setScheduleEngineProgressReporter(null);
  }
};
