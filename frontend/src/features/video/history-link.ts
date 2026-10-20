/**
 * 從其他頁面（事件詳情、舊的歷史影像連結、即時監控的容量提示）進「影像資源管理」。
 * 帶來源／時間（例如事件前後 30 秒）就直接進資源管理裡的歷史錄影子畫面；不帶條件就到來源清單。
 */
export type HistoryRequest = { from: number; to: number; vehicleCode?: string | null; sourceIds?: string[]; at?: number; eventId?: string | null };
let pending: HistoryRequest | null = null;

export function takeHistoryRequest() {
  const req = pending;
  pending = null;
  return req;
}

export const OPEN_VIDEO_RESOURCES_EVENT = 'syncdrive:open-video-resources';
/** @deprecated 舊名稱；同一個事件，保留給尚未改名的呼叫者 */
export const OPEN_VIDEO_HISTORY_EVENT = OPEN_VIDEO_RESOURCES_EVENT;

/** 帶條件開歷史錄影（資源管理內的子畫面） */
export function openVideoHistory(request: HistoryRequest) {
  pending = request;
  window.dispatchEvent(new CustomEvent(OPEN_VIDEO_RESOURCES_EVENT, { detail: { history: true } }));
}

/** 開影像資源管理首頁（來源清單） */
export function openVideoResources() {
  pending = null;
  window.dispatchEvent(new CustomEvent(OPEN_VIDEO_RESOURCES_EVENT, { detail: { history: false } }));
}
