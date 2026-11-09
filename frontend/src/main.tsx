import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import App from './App.tsx'
import { LocaleBootstrap } from './i18n/LocaleBootstrap'
import { AuthProvider } from './features/access-control/AuthContext'
import { installChunkReloadHandler } from './lib/chunkReload'

// 重新打包後舊分頁載不到舊分片：自動重新整理載入新版（見 lib/chunkReload.ts）
installChunkReloadHandler()

// React 開發版每次渲染都寫一筆 performance measure，瀏覽器不會自己清，圖台開久了記憶體一直漲。
// 只影響開發版；DevTools Performance 錄製時看到的時間軌不受影響。
if (import.meta.env.DEV) {
  setInterval(() => performance.clearMeasures(), 60_000)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleBootstrap>
      <AuthProvider><App /></AuthProvider>
    </LocaleBootstrap>
  </StrictMode>,
)
