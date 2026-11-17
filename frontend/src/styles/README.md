# 前端設計系統架構

所有畫面的顏色、字級都從同一套 token 來；按鈕、輸入框、對話框、面板、狀態標籤從同一套元件來。
頁面不再自己寫死色碼或字級。規則細節見 `.claude/skills/t3-ui-design/SKILL.md`。

## 分層

```
設計交付（frontend/design-specs/，登記在 manifest.json）
  ├─ t3-design-tokens.source.css ──► styles/design-tokens.css   唯一存放數值的地方：色票、語意色、字級、字型
  │                                    ├─ Tailwind utility       bg-surface-primary、text-text-secondary、text-body-m…
  │                                    └─ styles/tokens.ts       程式端取用：tokenVar()（SVG／style）、readToken()（canvas）
  └─ 各元件 *-engineering-spec.md ──► components/ui/<元件>/<元件>.css   逐字取自文件 §5（@layer components）
                                       └─ components/ui/styles.css      所有元件樣式的單一入口（index.css 只引入它）

components/ui/                        共用元件（頁面一律從 components/ui 匯入）
  button/    Button、IconButton        ← T3 UI Kit 規格
  checkbox/  Checkbox、CheckboxIndicator、headerCheckState ← T3 UI Kit 規格
  radio/     Radio、RadioGroup         ← T3 UI Kit 規格
  switch/    Switch                    ← T3 UI Kit 規格
  dialog/    Dialog                    ← 專案自訂（設計稿尚未提供），樣式在 variants.ts
  field/     TextInput、TextArea、Field ← 同上
  panel/     Panel                     ← 同上
  badge/     Badge                     ← 同上
  variants.ts  專案自訂元件的樣式定義（輸入框、面板層級、狀態色、選單、對話框）
     └─ 各功能頁面                      只組合元件與 utility；className 只用來排版
```

| 要做的事 | 用這個 |
|---|---|
| 按鈕 | `<Button hierarchy variant>`；不是 `<button>` 但要長得像按鈕：`buttonAttributes()` |
| 圖示按鈕 | `<IconButton label icon size hierarchy variant pressed>` |
| 勾選 | `<Checkbox checked onCheckedChange label>`；表頭全選 `checked={headerCheckState(已選, 可選)}`；清單項目裡只要外觀：`<CheckboxIndicator>` |
| 單選 | `<RadioGroup legend value onValueChange options>`（單一個用 `<Radio>`） |
| 開關 | `<Switch checked onCheckedChange aria-label>`；軌道裡要文字：`text="通知"` |
| 輸入框 | `<TextInput>`、`<TextArea>`；包標籤與錯誤訊息：`<Field label error>` |
| 對話框 | `<Dialog title footer onClose>`；確認／提示用 `systemConfirm`／`systemAlert` |
| 卡片、面板 | `<Panel level="primary">` 或 `surfaceClass(level)` |
| 狀態標籤 | `<Badge tone="error">`、`<StatusTag tone="success">` |
| 下拉、選單 | `SiteSelect`、`SiteMultiSelect`；自己做浮層時用 `MENU_PANEL_CLASS`、`menuItemClass()` |
| canvas、SVG、圖表色 | `readToken('status-error')`、`tokenVar('surface-primary')` |

- 設計稿改了 token 數值：只改 `design-tokens.css`。
- 元件規格更新：換掉 `design-specs/` 的文件，同步該元件的 CSS（測試會比對兩者）。
- 新增元件規格：照 `design-specs/README.md` 的步驟做。
- 專案自訂元件要新增一種樣式：只改 `variants.ts`。

## 防呆

- `npm run lint:design`：檢查有沒有新增寫死的色碼、`text-[11px]` 這類任意值、`rgb()`。舊程式的數量記在
  `design-tokens.baseline.json`，**只能減少不能增加**。`npm test` 也會跑這一項。
- `npm run lint:design:report`：依模組列出還剩多少要整理（含自製按鈕、自製勾選類的數量）。
- `npm run lint:design:update`：整理完一批後把進度鎖進基準。
- `styles/tokens.spec.ts`：確認 `tokens.ts` 的名稱跟 CSS 一致。
- `components/ui/button.spec.tsx`：確認 `button.css` 跟按鈕工程文件逐字一致、150＋60 個狀態都有規則、用到的 token 都存在。

## 整理舊畫面的流程

1. 選一個模組（`npm run lint:design:report` 看哪裡最多）。
2. 先跑機械式替換：`node scripts/codemod-design-tokens.mjs <檔案…>`。它只換意思明確的
   class，例如文字層級、框線、常見底色、狀態色、字級。可以先加 `--dry` 看會改什麼。
3. 手動處理剩下的部分：
   - 按鈕改成 `<Button>`／`<IconButton>`，勾選框、單選、開關改成 `<Checkbox>`／`<RadioGroup>`／`<Switch>`。
   - 自製的對話框改成 `<Dialog>`。
   - 選取狀態、圖表色看上下文決定。
   - 「字級＋font-semibold」改成設計稿的 `-bold` 字級，或拿掉多的字重。
4. 看畫面確認，特別是固定尺寸的容器、圖面上的小字。
5. `npm run lint:design:update`，然後 commit。

## 進度

- 已完成：
  - 系統外框：側欄、頂部帳號列、時鐘、工作區外框、登入頁、載入畫面。
  - 共用元件：系統確認框、帳號權限對話框（含勾選框）、下拉單選與多選、日期時間、返回首頁、錯誤畫面、狀態標籤。
  - 系統基礎模組的設定開關列（`ToggleRow`→Switch）與勾選項（`CheckboxOption`→Checkbox）。
- 未整理：其餘功能模組，數量見 `npm run lint:design:report`。
- 不必整理的寫死色碼：
  - 圖台與儀表板裡「使用者可設定的顏色預設值」，例如地圖圖層色、元件配色。
  - 匯出檔、報表 HTML 的內嵌樣式。

  這些是資料，不是介面樣式，留在基準裡即可。
