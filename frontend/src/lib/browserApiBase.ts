/**
 * 瀏覽器端 API 基底 URL。
 *
 * <strong>預設一律走同源相對路徑（空字串）。</strong>開發時由 Vite 的
 * <code>/syncdrive-api</code> 代理轉給後端，部署後由 nginx 在同一個網域上代理到
 * 後端容器——兩種情況瀏覽器送出的都是相對路徑，不必知道後端在哪裡。
 *
 * <strong>為什麼不能預設 <code>http://127.0.0.1:3000</code>。</strong>那個位址是
 * <strong>看網頁的那台電腦</strong>，不是伺服器。本機開發時兩者剛好同一台所以看不出
 * 問題；一旦把前端部署到別的機器（例如 GCP VM），使用者的瀏覽器就會去打自己的
 * 3000 埠，畫面上呈現為「後端沒開」，而後端其實好好的。同源相對路徑沒有這個問題，
 * 也不需要為前端開 CORS。
 *
 * 只有使用者在資料來源設定裡<strong>明確填了</strong>後端位址時才用絕對位址——那是
 * 「指到另一台後端」的刻意行為，例如從本機圖台連測試機。
 */
export function resolveBrowserApiBaseUrl(configured?: string | null): string {
  const raw = configured?.trim();
  if (!raw) return '';
  // localhost 與 127.0.0.1 在瀏覽器眼中是不同來源，交叉使用會 Failed to fetch
  return raw.replace(/\/$/, '').replace('//localhost:', '//127.0.0.1:');
}
