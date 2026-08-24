import * as path from 'path';

/**
 * 解析 backend/scripts 底下的腳本路徑，<strong>不依賴啟動時的工作目錄</strong>。
 *
 * <strong>為什麼要有這個。</strong>先前是直接
 * <code>path.join(process.cwd(), 'scripts/xxx.js')</code>——後端只要不是從
 * <code>backend/</code> 啟動就會 <code>MODULE_NOT_FOUND</code> 掛在啟動階段
 * （2026-08-24 實測：從專案根目錄跑 <code>node backend/dist/main.js</code>，
 * map.service 載入時直接炸，服務起不來，前端因為 Vite 代理不到上游而顯示 500）。
 *
 * 工作目錄是<strong>啟動方式</strong>的屬性，腳本位置卻是<strong>原始碼結構</strong>的
 * 屬性，兩者本來就不該綁在一起。改成從這個模組自己的位置往回推：
 *
 *   開發（ts-node）  backend/src/common  → ../../scripts  → backend/scripts
 *   編譯後           backend/dist/common → ../../scripts  → backend/scripts
 *
 * 兩種情況都落在同一個地方，跟從哪裡啟動無關。
 */
export function backendScriptPath(...segments: string[]): string {
  return path.join(__dirname, '..', '..', 'scripts', ...segments);
}
