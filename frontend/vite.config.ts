import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backendProxyTarget = process.env.SYNCDRIVE_BACKEND_PROXY_TARGET ?? 'http://127.0.0.1:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/syncdrive-api': {
        target: backendProxyTarget,
        changeOrigin: true,
      },
      /**
       * 即時車輛資料走 Socket.IO，正式環境由 nginx 代理到後端；開發時沒有 nginx，
       * 少了這一段就會打到 Vite 自己身上（沒有這個路由）而靜靜地連不上。
       *
       * 症狀是圖台的車輛圖層永遠空的：MQTT 有在跑、後端也確實在轉發，
       * 但瀏覽器端的 hub 一筆都收不到，畫面上一台車也沒有。
       */
      '/socket.io': {
        target: backendProxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
// force rebuild dev server to clear broken cache
