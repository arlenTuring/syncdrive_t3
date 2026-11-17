# 舊畫面轉換工具（規則化、會跳過判斷不了的）

整理舊頁面成 components/ui 時用的輔助腳本。**都是啟發式規則**：轉完一定要跑型別檢查、測試、看畫面。
跳過的（頁籤、選單項目、拖曳把手、動態 class、帶 style 的地圖浮動按鈕…）留給人工。

建議順序（在 `frontend/` 下執行，`src` 是 components/ui 所在的根）：

```bash
node scripts/codemod-design-tokens.mjs <檔案…>                 # 1. 顏色、字級 class → token
python3 scripts/design-migration/convbtn.py src <檔案…>         # 2. <button> → Button / IconButton
python3 scripts/design-migration/postbtn.py src <檔案…>         # 3. 圖示放進 leadingIcon、只有圖示的改 IconButton
python3 scripts/design-migration/convsel.py src <檔案…>         # 4. 原生 checkbox / radio → Checkbox / Radio
python3 scripts/design-migration/convfield.py <檔案…>           # 5. SiteSelect / SiteDateTimeInput 寫死樣式 → size
python3 scripts/design-migration/convdlg.py src <檔案…>         # 6. 置中的自製對話框外框 → <Dialog headerless>
npx tsc -p tsconfig.app.json --noEmit && npm test && npm run lint:design:update
```

注意：
- `convbtn.py` 對沒寫 `type` 的原生 button 會補 `type="submit"`（保留原生預設行為）。
- `convdlg.py` 的 `onClose` 是從遮罩的點擊處理或檔案裡的 onClose／onCancel 猜的；標題取第一個 h1–h4。轉完要逐一確認，
  處理中不能關的對話框要補 `busy`。
