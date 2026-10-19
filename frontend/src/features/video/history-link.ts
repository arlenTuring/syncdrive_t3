/** 事件詳情等其他頁面帶參數開啟歷史影像（例如事件前後 30 秒） */
export type HistoryRequest = { from: number; to: number; vehicleCode?: string | null; sourceIds?: string[]; at?: number };
let pending: HistoryRequest | null = null;

export function takeHistoryRequest() {
  const req = pending;
  pending = null;
  return req;
}
export const OPEN_VIDEO_HISTORY_EVENT = 'syncdrive:open-video-history';
export function openVideoHistory(request: HistoryRequest) {
  pending = request;
  window.dispatchEvent(new CustomEvent(OPEN_VIDEO_HISTORY_EVENT));
}

