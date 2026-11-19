/**
 * 記住這個分頁最後停在哪一頁：按重新整理後回到同一頁，而不是跳回預設的第一頁。
 *
 * 用 sessionStorage：只跟著這個瀏覽器分頁，關掉分頁或另開新分頁仍從預設頁開始；
 * 讀不到（無痕、封鎖網站資料）時一律當作沒有記錄。
 */
const LAST_VIEW_STORAGE_KEY = 'syncdrive_vtms_last_view';

export function readLastView(): string | null {
  try {
    const raw = window.sessionStorage.getItem(LAST_VIEW_STORAGE_KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

export function writeLastView(view: string): void {
  try {
    window.sessionStorage.setItem(LAST_VIEW_STORAGE_KEY, view);
  } catch {
    // 寫不進去只是重新整理後回到預設頁，不影響使用
  }
}
