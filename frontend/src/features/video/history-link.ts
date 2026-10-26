/** 跨頁只傳送一次性的歷史影像查詢草稿；接收頁只預填，不自動查詢。 */
export type HistoryRequest = { from: number; to: number; vehicleCode?: string | null; sourceIds?: string[]; at?: number; eventId?: string | null };
let pending: HistoryRequest | null = null;

export function takeHistoryRequest() {
  const req = pending;
  pending = null;
  return req;
}

export const OPEN_VIDEO_RESOURCES_EVENT = 'syncdrive:open-video-resources';
export const OPEN_VIDEO_HISTORY_EVENT = 'syncdrive:open-video-history';

/** 前往獨立影像管理紀錄並預填條件。 */
export function openVideoHistory(request: HistoryRequest) {
  pending = request;
  window.dispatchEvent(new CustomEvent(OPEN_VIDEO_HISTORY_EVENT));
}

/** 開影像資源管理首頁（來源清單） */
export function openVideoResources() {
  window.dispatchEvent(new CustomEvent(OPEN_VIDEO_RESOURCES_EVENT));
}
