# T3 UI Kit｜DatePicker 與 TimePicker 工程規範

設計基準為 [Figma DatePicker／TimePicker](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=240-23231)。配色與字體沿用 [T3 Design Tokens](https://chatgpt.com/library?file_id=libfile_202bb92aeecc8191bf26b85338556396&account_id=personal)。

## 1. 欄位組成

| 部位 | 規格 |
| --- | --- |
| 寬度 | Figma 樣本 240px。欄位寬度由使用位置決定，240px 作為對照基準。 |
| 有標題 | Label 18px ＋ gap 4px ＋輸入框 34px，合計 56px。 |
| 無標題 | 輸入框 34px。RequiredMark 隨 Label 一起隱藏。 |
| 輸入框 | 圓角 8px，上下 padding 6px、左右 12px。內容列文字 18px 行高、上下各 2px。尾端圖示槽 20 × 20px；日期使用 `today`，時間使用 `schedule`。 |
| Label | 左右 padding 8px，使用 `.text-body-s-bold` 與 `--text-tertiary`。必填星號用 `--status-error-emphasis`。標題文字直接以首字開始，星號隱藏後也顯示「標題」。 |
| Supporting Text | Figma 以 24px 獨立顯示於輸入框下方，包含上下各 4px、左右各 12px。使用 `.text-body-xs` 與 `--text-tertiary`。排版須保留實際高度，長文字可換行。 |
| 欄位文字 | 使用 `.text-body-s`（14px／18px、字距 0.5px）。Default 的 Placeholder 用 `--text-tertiary`；Focus（面板展開）時，提示文字與已填值皆用 `--text-primary`（#F3F4F6）；Active 已填值用 `--text-primary`；Disabled 文字用 `--text-disabled`。此規則適用所有 Style、單選與區間欄位，DatePicker／TimePicker 共用。 |

Figma 欄位屬性包含 `Style`、`State`、`Label`、`Supporting Text`、`RequiredMark`、`Range`。以 `value`、`open`、`disabled` 推導狀態。優先序為 Disabled → Focus → Active → Default。此處 Focus 指面板已展開，Active 指面板關閉且已有值。Tab 到欄位時顯示鍵盤焦點。Figma 的 `Disbaled` 在工程介面統一命名為 `disabled`。

## 2. Style × State

各格為「背景 / 0.5px 描邊」。所有顏色皆為 CSS 變數。

| Style | Default | Focus | Active | Disabled |
| --- | --- | --- | --- | --- |
| Tonal-Theme | `--surface-theme` / 透明 | `--surface-theme` / `--border-theme` | `--surface-theme` / 透明 | `--surface-disabled` / 透明 |
| Tonal-Gray | `--surface-secondary` / 透明 | `--surface-secondary` / `--link-standard` | `--surface-secondary` / 透明 | `--surface-disabled` / 透明 |
| Outlined | 透明 / `--border-primary` | `--link-standard` / `--border-theme` | 透明 / `--border-primary` | `--surface-disabled` / `--border-primary` |

[有標題樣本](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-52230) · [無標題樣本](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-51149) · [區間展開](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-54251) · [時間展開](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-56265)

## 3. 選取面板

面板底色 `--surface-background`、圓角 12px。使用 Figma 的 Original Popup 陰影樣式（下移 4px，`--surface-disabled`）。導航列 40px 高，底部分隔線使用 `--border-quaternary`。箭頭圖層 16 × 9px，距面板左側 24px。以下尺寸是 Figma 參考樣本，面板寬度與欄位寬度獨立。日期面板高度隨實際月份的週列數增加，避免截斷日期。

| 面板 | Figma 尺寸 | 工程行為與顯示 |
| --- | --- | --- |
| [Date](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-29370) | 304 × 339px | 日期 `YYYY-MM-DD`。可切換月／年，單選日期後關閉。「今天」使用系統當天。 |
| [Week](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-29371) | 304 × 339px | 整週選取，樣本週首為日。預覽以起訖日期顯示選取結果。 |
| [Month](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-29372) | 304 × 345px | 3 欄 × 4 列，顯示 `YYYY-MM`。 |
| [Quarter](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-29373) | 304 × 134px | 4 格一列，顯示 `YYYY-Qn`。 |
| [Year](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-29374) | 304 × 345px | 3 欄 × 4 列，十年範圍加首尾相鄰年份，顯示 `YYYY`。 |
| [Time](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-29375) | 190 × 323px | 小時 00–23、分鐘與秒 00–59，三欄可捲動，顯示 `HH:mm:ss`。「此刻」取系統時間，「確定」提交。 |
| [Date Range](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-29376) | 608 × 305px | 雙月面板。端點使用 Active，中間日期使用 Middle(Range)。 |
| [Date + Time](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-29377) | 487 × 355px | Figma 命名 `State=Range, Style=Time`，畫面為單一日期面板加一組時間欄。工程對應單一日期時間 `YYYY-MM-DD HH:mm:ss`，由「確定」提交。 |
| [Month Range](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-29378) | 608 × 345px | 雙年份月份面板，端點與中間月份分別套用 Active／Middle。 |
| [Year Range](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-29379) | 608 × 345px | 雙十年面板，端點與中間年份分別套用 Active／Middle。 |

Today 依使用者裝置的本地年月日判斷，以 `new Date()` 取得當天。日期格使用 1px 虛線圓框 `--text-tertiary` 並加上 `aria-current="date"`，套用範圍為日期格（含週、日期區間與日期時間面板內的日期格）。月、季、年與時間選項使用各自的狀態樣式。

### 時間欄捲軸

| 部位 | Figma 設定 |
| --- | --- |
| 時／分／秒內容欄 | 可視高 264px，上下 padding 4px，左 4px、右 8px；選項 48 × 32px。 |
| Scroller | 絕對定位於各欄右側，寬 6px，從欄頂延伸至欄底，透明軌道。 |
| Scrollbar | 寬 4px、圓角 100px，貼齊軌道左側。Figma 小時滑塊高 123px，分鐘與秒鐘高 68px。 |
| TimePicker 色票 | 三欄滑塊皆使用 `--border-disabled`。 |
| Date + Time 色票 | 小時滑塊使用 `--border-disabled`，分鐘與秒鐘使用 `--color-black-5`。 |
| 捲動接線 | 滑塊位置跟隨各欄實際 scrollTop。滾輪、觸控、鍵盤移動焦點及拖曳滑塊均操作同一個內容欄。自訂軌道處理滑鼠拖曳，內容欄保留原生捲動行為。 |

### 面板內容對照

| 面板 | 頂部 | 內容區 | 底部 |
| --- | --- | --- | --- |
| Date、Week | 前一年、前一月圖示；月份／年份；後一月、後一年圖示。 | 星期列與日期格。Week 以整週顯示選取。 | 今天 |
| Month、Quarter | 前一年圖示、年份、後一年圖示。 | 月份格或季度格。 | — |
| Year | 前十年圖示、十年範圍、後十年圖示。 | 年份格。 | — |
| Date Range | 共用一組前一年、前一月、後一月、後一年圖示，中央並列兩組月份／年份。 | 雙月星期列與日期格。 | — |
| Month Range、Year Range | 共用一組前後年份或十年圖示，中央並列兩組年份或十年範圍。 | 雙面板選項。 | — |
| Time | 時間欄直接開始。 | 時、分、秒捲動欄。 | 此刻、確定 |
| Date + Time | 日期側使用日期導航列，時間側為空白分隔列。 | 日期格與時、分、秒欄。 | 確定 |

所有導航按鈕依 Figma 呈現為 24px 原始圖示，讀屏名稱對應前後月／年。中央月份與年份使用純文字樣式。DatePicker 初始畫面從標題與輸入框開始。

### 面板內的元件

| 元件 | 尺寸與狀態 |
| --- | --- |
| [Date Button](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-29190) | 40 × 40px，四周留 4px，內圓 32px。Default 文字 `--text-secondary`。Hover 底 `--link-standard-hover`。Today 用 1px 虛線 `--text-tertiary`。Middle(Range) 底／字 `--link-tonal`／`--text-theme`。Active 底／字 `--link-theme-filled`／`--text-invert`。OtherMonth 用 `--text-disabled`。 |
| [MQY Button](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-29207) | 標準 92 × 70px，內層圓角 20px，左右留 8px、上下 16px。狀態為 Default、Hover、Middle、Active、OtherYear。季面板以 4 欄平分 280px 內容區。 |
| [Time Button](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-29217) | 48 × 32px，圓角 8px。Default 用 `--text-secondary`，Hover 底用 `--link-tonal-hover`，Active 底用 `--link-tonal`。 |
| [Week Text](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-29218) | 40 × 40px、下 padding 8px。由日到六排列，用 `--text-secondary`。 |
| [Date Header](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-29369) | 高 40px，左右 padding 8px；導航按鈕保留 24 × 24px 圖示槽。上一年、上一月、下一月、下一年各自有可讀名稱。可重用 UI Kit 的 Button 做「今天」、「此刻」、「確定」。 |

## 4. 工程接線與驗收

- 若專案採 Ant Design Vue，單值日期使用 `DatePicker`，週／月／季／年對應 `picker`，日期與時間同選使用 `showTime`。日期、月、年區間使用 `RangePicker`。單獨時間使用 `TimePicker`，設 `format="HH:mm:ss"`。參考 [DatePicker](https://www.antdv.com/components/date-picker) 與 [TimePicker](https://antdv.com/components/time-picker)。
- 控制 `value`、`open`、`disabled` 時，使用同一份狀態推導欄位外觀。Range 的開始／結束值一起提交，區間日期、月或年按順序排列。清空值回到 Default。時間暫選值在「確定」前保留於面板；Escape 或點擊外部後不提交暫選值。
- Label 與欄位關聯；無可見 Label 時仍提供可讀名稱。Supporting Text 用 `aria-describedby` 關聯。鍵盤可開啟面板、移動至選項、選取及以 Escape 關閉；關閉後焦點回欄位。停用欄位無法展開。
- 以表單外層套用 T3 的 34px 欄位、8px 圓角與 `data-style`／`data-state` 樣式。依本表核對彈出容器的尺寸、色票與選取狀態。面板放到可見視窗範圍內，空間不足時避免遮住可操作選項。
- Playground 初次展開顯示使用者系統當天所在月份；已有選取值時顯示該值所在月份。「今天」和「此刻」仍使用系統日期及時間。週表示、逆序區間排序及未確認即取消屬範例實作決策，產品若有資料格式或日期限制，使用產品的規則。

工程與測試頁使用 Figma 的原始箭頭、日期、時間及浮層指示圖示。測試設定置於元件下方的收合區。

### 日期區間選擇驗收

在原本的「互動測試」下方開啟「測試設定」，將面板切換為「日期區間」，再點擊同一個欄位測試。第一次點選暫存開始日，第二次點選提交完整區間。

| 操作 | 預期結果 |
| --- | --- |
| 開啟日期區間欄位 | 顯示開始／結束提示及雙月面板，共用一組箭頭導航。 |
| 選第一個日期 | 暫選開始日期；欄位顯示開始日與結束提示，面板維持展開。 |
| 選第二個日期 | 提交起訖日期並關閉面板，欄位顯示完整區間。 |
| 完成後再次開啟 | 起訖端點使用 Active；兩端之間的日期使用 Middle(Range)。 |
| 跨月選取 | 左右月份的日期可組成同一區間。 |
| 逆序或同日選取 | 逆序時按日期排序；同日時起訖為同一天。 |
| 只選開始日期後按 Escape 或點擊外部 | 取消此次暫選，保留原本已提交的區間。 |
| 勾選 Disabled | 欄位無法展開。 |

日期格點擊後會重繪面板。外部點擊判斷使用事件的 `composedPath()`，確保第一次選日期後面板繼續開啟。

## 5. CSS 參考

以下樣式可套用至專案的欄位外層與面板對應節點。Portal 掛載的面板同樣加上 `.picker-panel`，使選取色票與樣式生效。

```css
.picker { max-width: 100%; width: 240px; color: var(--text-primary); }
.picker-label { display: block; margin: 0 0 4px; padding: 0 8px; color: var(--text-tertiary); }
.picker-label b { color: var(--status-error-emphasis); }
.picker-help { padding: 4px 12px; margin: 0; color: var(--text-tertiary); }
.picker-field {
  --picker-bg: var(--surface-theme);
  --picker-border: transparent;
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; width: 100%; height: 34px; padding: 6px 12px; border: 0; border-radius: 8px;
  background: var(--picker-bg); box-shadow: inset 0 0 0 .5px var(--picker-border);
  color: var(--text-primary); text-align: left;
}
.picker-field[data-style="tonal-gray"] { --picker-bg: var(--surface-secondary); }
.picker-field[data-style="outlined"] { --picker-bg: transparent; --picker-border: var(--border-primary); }
.picker-field[data-state="focus"] { --picker-border: var(--border-theme); }
.picker-field[data-style="tonal-gray"][data-state="focus"] { --picker-border: var(--link-standard); }
.picker-field[data-style="outlined"][data-state="focus"] { --picker-bg: var(--link-standard); }
.picker-field:disabled { --picker-bg: var(--surface-disabled); color: var(--text-disabled); cursor: not-allowed; }
.picker-field .placeholder { color: var(--text-tertiary); }
.picker-field[data-state="focus"]:not(:disabled) .field-value { color: var(--text-primary); }
.picker-field:disabled .placeholder { color: var(--text-disabled); }
.picker-field:focus-visible, .picker-panel button:focus-visible { outline: 2px solid var(--border-theme); outline-offset: 1px; }
.picker-panel {
  position: relative; width: max-content; max-width: 100%; border-radius: 12px;
  background: var(--surface-background); color: var(--text-secondary);
  box-shadow: 0 4px 12px var(--surface-disabled); font: 400 14px/18px var(--font-primary);
}
.picker-panel .panes { display: flex; flex-wrap: wrap; }
.picker-panel header { height: 40px; padding: 0 8px; border-bottom: 1px solid var(--border-quaternary); display: flex; align-items: center; justify-content: space-between; gap: 0; }
.picker-panel .calendar { width: 304px; max-width: 100%; }
.picker-panel .calendar + .calendar { box-shadow: inset 1px 0 var(--border-quaternary); }
.picker-panel .grid { display: grid; padding: 12px; }
.picker-panel .days { grid-template-columns: repeat(7, minmax(0, 40px)); }
.picker-panel .units { grid-template-columns: repeat(3, minmax(0, 1fr)); padding-top: 12px; }
.picker-panel .quarter { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.picker-panel .week-name { height: 40px; display: grid; place-items: center; padding-bottom: 8px; }
.picker-panel .cell { padding: 4px; height: 40px; background: transparent; border: 0; color: inherit; }
.picker-panel .cell span { display: grid; width: 100%; height: 100%; place-items: center; border-radius: 1000px; }
.picker-panel .unit { height: 70px; padding: 16px 8px; }
.picker-panel .unit span { border-radius: 20px; }
.picker-panel .cell:hover span { background: var(--link-standard-hover); }
.picker-panel .cell[data-other="true"] { color: var(--text-disabled); }
.picker-panel .days .cell[data-today="true"] span { border: 1px dashed var(--text-tertiary); }
.picker-panel .cell[data-tone="middle"] span { background: var(--link-tonal); color: var(--text-theme); }
.picker-panel .cell[data-tone="active"] span { background: var(--link-theme-filled); color: var(--text-invert); }
.picker-panel .time { width: 190px; padding: 4px; display: flex; gap: 0; }
.picker-panel .time-column { position: relative; flex: none; width: 60px; box-sizing: content-box; }
.picker-panel .time-column + .time-column { border-left: 1px solid var(--border-quaternary); }
.picker-panel .time-list {
  box-sizing: border-box; width: 60px; height: 264px; padding: 4px 8px 4px 4px;
  overflow-y: auto; overflow-x: hidden; scrollbar-width: none;
}
.picker-panel .time-list::-webkit-scrollbar { display: none; }
.picker-panel .time-scroller { position: absolute; right: 0; top: 0; bottom: 0; width: 6px; overflow: hidden; touch-action: none; }
.picker-panel .time-scrollbar { position: absolute; left: 0; top: 0; width: 4px; height: var(--time-thumb-height); border-radius: 100px; background: var(--border-disabled); }
.picker-panel .time-column[data-part="0"] { --time-thumb-height: 123px; }
.picker-panel .time-column[data-part="1"], .picker-panel .time-column[data-part="2"] { --time-thumb-height: 68px; }
.picker-panel[data-mode="dateTime"] .time-column[data-part="1"] .time-scrollbar,
.picker-panel[data-mode="dateTime"] .time-column[data-part="2"] .time-scrollbar { background: var(--color-black-5); }
.picker-panel .time-list button { width: 48px; height: 32px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: inherit; }
.picker-panel .time-list button:hover { background: var(--link-tonal-hover); }
.picker-panel .time-list button[aria-pressed="true"] { background: var(--link-tonal); }
.picker-panel footer { height: 35px; border-top: 1px solid var(--border-quaternary); display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 12px; }
.picker-panel[data-mode="time"] footer, .picker-panel[data-mode="dateTime"] footer { height: 51px; justify-content: flex-end; }
.picker-panel[data-mode="time"] footer { justify-content: space-between; }
.picker-panel[data-mode="dateTime"] .time { width: 183px; }
.picker-panel[data-mode="dateRange"], .picker-panel[data-mode="monthRange"], .picker-panel[data-mode="yearRange"], .picker-panel[data-mode="month"], .picker-panel[data-mode="year"] { border-bottom: 1px solid var(--border-quaternary); }
.picker-nav {
  display: grid; place-items: center; flex: none;
  width: 24px; height: 24px; padding: 0; border: 0;
  border-radius: 8px; background: transparent; color: var(--text-secondary);
}
.picker-nav-icon { display: block; flex: none; }
.picker-header-titles { display: flex; flex: 1; min-width: 0; justify-content: space-around; }
.picker-header-title { display: flex; flex: 1; align-items: center; justify-content: center; }
.picker-heading-button { padding: 0 4px; border: 0; background: transparent; color: var(--text-secondary); font: 500 14px/18px var(--font-primary); letter-spacing: .5px; }
.picker-datetime-header { display: flex; }
.picker-datetime-header header { width: 304px; flex: none; }
.picker-time-heading { flex: 1; border-bottom: 1px solid var(--border-quaternary); }
.picker-suffix { display: block; flex: none; }
.picker-popup-arrow { position: absolute; top: -9px; left: 24px; display: block; pointer-events: none; }
```
