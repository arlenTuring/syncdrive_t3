/// <reference lib="webworker" />
/**
 * 排班引擎背景執行緒：生成是一段長時間的同步運算，放在主執行緒會讓頁面無回應、瀏覽器跳出「請稍候」
 * （白皮書 GEN-15）。這裡只負責收輸入、跑同一個 generateShiftSchedule、回傳結果與進度；
 * 引擎本身一行都不改，所以同一份輸入搬到背景前後的結果相同。
 */
import { generateShiftSchedule, setScheduleEngineProgressReporter, type GenerateShiftScheduleInput } from '../generate';

type Request = { id: number; input: GenerateShiftScheduleInput };

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, input } = event.data;
  setScheduleEngineProgressReporter((progress) => {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, type: 'progress', progress });
  });
  try {
    const result = generateShiftSchedule(input);
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
