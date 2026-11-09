/**
 * 前端重新打包後，舊分頁要載入的程式分片（檔名帶雜湊）已經被新版取代、不存在了，
 * 動態 import 會失敗（「Failed to fetch dynamically imported module」）。
 * 這種錯誤重新整理一次載入新版就好，不需要使用者自己按硬重新整理。
 *
 * 30 秒內只自動重新整理一次，避免伺服器真的掛了時不停重載。
 */
const KEY = 'syncdrive.chunkReloadAt';
const GUARD_MS = 30_000;

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return CHUNK_ERROR.test(message);
}

/** 重新整理一次；30 秒內已經重新整理過就回傳 false（交給畫面顯示錯誤） */
export function reloadForNewBuild(): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY) ?? 0);
  } catch {
    // 無法存取 sessionStorage 時照樣重新整理一次
  }
  if (Date.now() - last < GUARD_MS) return false;
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // 忽略
  }
  window.location.reload();
  return true;
}

/** Vite 預載分片失敗時會發出 vite:preloadError：攔下來直接重新整理 */
export function installChunkReloadHandler(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewBuild()) event.preventDefault();
  });
}
