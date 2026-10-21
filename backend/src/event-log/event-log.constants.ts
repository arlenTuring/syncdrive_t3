/**
 * 事件與日誌管理的集中預設值（實作設計，非官方逐字規定；官方矛盾見交付紀錄）。
 *
 * - 事件每頁 8 筆：官方中文段落寫 8 筆、英文寫 3 筆，暫採中文，待確認。
 * - 事件管理清單：待確認／已確認分開查詢，初載 8 筆後游標載入；日誌預設最近 7 天、每頁 20 筆（前端預設，後端只限上限）。
 * - 事件與日誌單次 CSV 上限各 1,000 筆，超過時回應標頭帶總數，畫面提示截斷。
 * - 事件回放預設事件前 30 秒到後 30 秒。
 */
export const EVENT_PAGE_SIZE = 8;
/** 待確認／已確認集合單次最多載入筆數 */
export const LIVE_LIMIT_MAX = 100;
export const LOG_PAGE_SIZE = 20;
export const PAGE_SIZE_MAX = 100;
export const EXPORT_LIMIT = 1_000;
export const REPLAY_BEFORE_MS = 30_000;
export const REPLAY_AFTER_MS = 30_000;
/** 單次查詢的最長時間區間（避免無界掃描）：約 400 天 */
export const QUERY_SPAN_MAX_MS = 400 * 86_400_000;
export const DEFAULT_TIME_ZONE = 'Asia/Taipei';
