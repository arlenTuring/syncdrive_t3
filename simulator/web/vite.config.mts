import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const here = fileURLToPath(new URL('.', import.meta.url))
const frontendSrc = fileURLToPath(new URL('../../frontend/src', import.meta.url))

/**
 * 路徑編輯器的網頁。
 *
 * 圖台本體直接用 syncdrive_t3 前端的 `MapAreaCanvas`——儀表板與虛擬圍籬都是這樣
 * 重用的，所以這裡看到的方塊、站台、號誌、顏色，和地圖編輯器上看到的是同一份程式
 * 畫出來的，不是照著描一個像的。
 *
 * 只讀不改：模擬器不動 frontend/ 底下任何一個檔案，也不在產品裡加頁面。
 * 這一份建置出來的東西進 simulator/public/paths/，由模擬器自己的伺服器出檔。
 */
export default defineConfig({
  root: here,
  base: '/paths/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@fe': frontendSrc },
  },
  build: {
    outDir: fileURLToPath(new URL('../public/paths', import.meta.url)),
    emptyOutDir: true,
  },
})
