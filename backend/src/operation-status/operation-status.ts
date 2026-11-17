/**
 * 場域營運狀態：控制中心一眼要看到的那一格（正常營運，或哪一種不正常）。
 *
 * 不分模擬或真實，判斷依據都是系統自己的狀態，依嚴重程度取最嚴重的一種：
 * 1. 營運狀態未知：降級狀態與執行紀錄對不上、或讀不到降級狀態
 * 2. 降級運轉中：降級正在啟動、進行或恢復中
 * 3. 未部署班表：沒有使用中的班表，調度不會照班表下單
 * 4. 調度暫停中：即時調度引擎停用，不會下新訂單
 * 5. 正常營運
 */

export type OperationStatusCode = 'unknown' | 'degraded' | 'no_schedule' | 'dispatch_paused' | 'normal';

export const OPERATION_STATUS_LABEL: Record<OperationStatusCode, string> = {
  unknown: '營運狀態未知',
  degraded: '降級運轉中',
  no_schedule: '未部署班表',
  dispatch_paused: '調度暫停中',
  normal: '正常營運',
};

export type OperationStatusInput = {
  /** 降級模組回報的模式；讀取失敗給 null */
  degradedMode: 'normal' | 'degraded' | 'unknown' | null;
  /** 降級計畫名稱（降級進行中才有） */
  degradedPlanName: string | null;
  /** 使用中的班表名稱；沒有部署給 null */
  scheduleName: string | null;
  /** 即時調度引擎是否啟用 */
  dispatchEnabled: boolean;
};

export type OperationStatusRow = {
  status_code: OperationStatusCode;
  status_label: string;
  /** 補充說明（哪一個降級計畫、哪一張班表）；沒有就是空字串 */
  detail: string;
  schedule_name: string | null;
  dispatch_enabled: boolean;
  degraded_mode: string | null;
};

export function resolveOperationStatus(input: OperationStatusInput): OperationStatusRow {
  const code: OperationStatusCode =
    input.degradedMode === null || input.degradedMode === 'unknown'
      ? 'unknown'
      : input.degradedMode === 'degraded'
        ? 'degraded'
        : !input.scheduleName
          ? 'no_schedule'
          : !input.dispatchEnabled
            ? 'dispatch_paused'
            : 'normal';
  const detail =
    code === 'degraded'
      ? (input.degradedPlanName ?? '')
      : code === 'unknown'
        ? (input.degradedMode === null ? '讀不到降級狀態' : '降級狀態與執行紀錄不一致')
        : (input.scheduleName ?? '');
  return {
    status_code: code,
    status_label: OPERATION_STATUS_LABEL[code],
    detail,
    schedule_name: input.scheduleName,
    dispatch_enabled: input.dispatchEnabled,
    degraded_mode: input.degradedMode,
  };
}
