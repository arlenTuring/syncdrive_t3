# T3 UI Kit｜Header／Title 工程規範

設計來源：[Figma 指定區塊](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=1453-6406)  
基準：2026-11-20 重新讀取的元件屬性、色票與畫面。單一主題；沿用定稿 Typography／Color System。此文件搭配 `t3-header-playground.html`。

## 1. 適用範圍

僅依指定連結內的 Title 區塊（`1453:6406`）及其下方 6 個 Header 實例整理。Figma 主元件名稱為 Header，保留其 Type 名稱。

新增展示的 `Type=Label` 一併納入。實作範圍包含這 6 個實例的主元件，以及各 Type 原先隱藏的圖層與顯示屬性。

| Header Type | Figma 實例 | 高度 | 標題字級／行高／字重 | 左側 Icon | 右側內容 |
| --- | --- | --- | --- | --- | --- |
| Web-Header | `1453:6524` | 40px | 18／24px／500 | 24px，容器寬 20px | 語言、通知、使用者、設定 |
| Sub Header | `1453:6525` | 34px | 18／24px／500 | 24px，容器寬 20px | Button 1 |
| Title | `1453:6526` | 20px | 16／20px／500 | 20px，容器寬 18px | 無 |
| Title-EditName | `1453:6527` | 20px | 16／20px／500 | 20px，容器寬 18px | 編輯名稱 |
| Sub Title | `1453:6528` | 34px | 16／20px／400 | 20px，容器寬 18px | Button |
| Label | `1847:58290` | 34px（依內容 HUG） | 14／18px／400，字距 0.5px | 16px，容器寬 14px | 數值群組（預設只開群組，數值及 Tag 關閉）、Button |

## 2. 結構與尺寸

- 樣本寬度均為 **953px**。實作使用 `width:100%`，標題區 `flex:1; min-width:0`，操作區不可被壓縮。953px 是展示寬度，不是全站固定寬度。
- 標題 Icon 與文字間距 8px；標題區與操作區間距 8px。標題過長時單行省略，完整文字保留於 `title`。
- Web-Header 的標題區左右 padding 各 12px；右側 Action gap 16px。Sub Header／Title／Title-EditName／Sub Title 沒有整列額外 padding。
- Icon 的可見尺寸大於 Left-Icon 容器寬度，這是 Figma 原始配置：24／20px 或 20／18px。圖示置中並允許溢出，不將 Icon 縮小成容器寬度。
- Button 高 34px、padding 8px 14px、radius 8px；14／18px、字重 500、字距 0.5px。標題字距 0。
- IconButton 34 × 34px、radius 8px；一般圖示 24px。Layout 使用 18px Icon，按鈕 gap 0，順序為折線圖、長條圖、日曆、表格、卡片。
- Web-Header：語言按鈕範例 48 × 34px；通知／使用者 Avatar 40 × 40px、圓形；使用者文字 16／20px、字重 400。使用者文字與 Avatar gap 4px，箭頭容器 34 × 36px。
- Web-Header 分隔線寬 1px、高 20px。
- 通知 Badge 最小 16 × 16px，radius 1000px，10／14px、500、字距 0.5px；邊框 `--surface-primary`。相對 Avatar 右上角外移 4px。
- Label 的 Title 區域內 gap 4px，返回按鈕位於此區域內，為 24 × 24px／18px Icon。標題、數值皆 14／18px、400、字距 0.5px。外層 gap 8px；按鈕、數值群組沿用 34px 配置。關閉這些項目時依剩餘內容縮高，最小 18px。
- 小螢幕排版不在此 Figma 區塊內定義。示範頁提供橫向檢視，避免任意縮小或隱藏操作項目；工程整合時依頁面可用空間決定斷點。

## 3. 色票

| 項目 | Token／值 |
| --- | --- |
| Header 本體 | 透明背景、無外框 |
| 標題文字、Web／Sub Header 左側 Icon | `--text-primary` |
| Title／Title-EditName／Sub Title 左側 Icon | `--text-tertiary` |
| 輸入名稱提示、通知 Icon、Avatar Icon、Label 左側 Icon | `--text-tertiary` |
| 使用者名稱、一般操作 Icon | `--text-secondary` |
| 使用者下拉箭頭 | `--color-gray-400`（原 Figma 綁定 Colors/Gray/400） |
| 分隔線 | `--border-quaternary` |
| 語言、通知 Avatar、使用者 Avatar、設定底色 | `--link-standard` |
| 主按鈕底色／文字 | `--link-theme-filled`／白色 |
| 自動儲存圓點 | `--status-success`（Figma status/success）；文字維持 `--text-tertiary` |
| Sub Title 單位 Icon | `--text-secondary`；單位文字維持 `--text-tertiary` |
| Label 單位 Icon | `--text-primary`，依該 Type 的獨立綁定 |
| 名稱欄位 Focus 框 | `--border-theme`，inset 0.5px；僅聚焦時顯示 |
| 通知 Badge | `#DC2626`，原 Figma `Color/Red/Red-5`；文字白色 |

`#DC2626` 不是 `--status-error`；保留元件實際色值，避免替換成相近紅色。Icon 以 Figma 原始 SVG 實作，單色路徑使用 `currentColor`。

Header 本體未定義 Hover／Pressed 變體。子按鈕沿用既有 Button／IconButton 規範：Filled Hover／Pressed 使用 `--link-theme-filled-hover`／`--link-theme-filled-pressed`；Standard 使用 `--link-standard-hover`／`--link-standard-pressed`。透明 IconButton Hover／Pressed 為 `--link-standard`／`--link-standard-hover`。這些互動狀態屬子元件沿用規則，不是新增 Header 視覺變體。

## 4. 隱藏內容與顯示設定

每個類型依主元件的 `componentPropertyReferences.visible` 產生開關。上方互動區與下方 6 個範例都有獨立設定；只列該 Type 實際存在的項目，不將元件集裡其他類型的屬性加入畫面。

### Web-Header（7 項）

| 項目 | Figma 屬性 | key | 預設 | 所屬群組 |
| --- | --- | --- | --- | --- |
| 左側 Icon | TextIcon | `showIcon` | 開 | — |
| 標題文字 | HeadingText | `showTitle` | 開 | — |
| 語言按鈕 | Language | `language` | 開 | — |
| 通知 | Notify | `notify` | 開 | — |
| 使用者頭像 | UserImage | `userImage` | 開 | — |
| 使用者名稱 | UserName | `userName` | 開 | — |
| 設定按鈕 | Set | `settings` | 開 | — |

### Sub Header（14 項）

| 項目 | Figma 屬性 | key | 預設 | 所屬群組 |
| --- | --- | --- | --- | --- |
| 返回按鈕 | Back | `back` | 關 | — |
| 左側 Icon | TextIcon | `showIcon` | 開 | — |
| 標題文字 | HeadingText | `showTitle` | 開 | — |
| 資訊 Icon | Info hover | `info` | 關 | showTitle |
| 更新時間 | RefreshTime | `refresh` | 關 | — |
| 自動儲存 | Automatic storage | `autosave` | 關 | — |
| 操作按鈕群組 | Action | `showActions` | 開 | — |
| 次要按鈕 | Button 2 | `button2` | 關 | showActions |
| 主要按鈕 | Button 1 | `button1` | 開 | showActions |
| 新增按鈕 | Add | `add` | 關 | — |
| 下載按鈕 | Download | `download` | 關 | — |
| 右側關閉 | Close-Right | `close` | 關 | — |
| 標籤 | Tag | `tag` | 關 | — |
| Switch | Switch | `switch` | 關 | — |

### Title（14 項）

| 項目 | Figma 屬性 | key | 預設 | 所屬群組 |
| --- | --- | --- | --- | --- |
| 左側 Icon | TextIcon | `showIcon` | 開 | — |
| 標題文字 | HeadingText | `showTitle` | 開 | — |
| 資訊 Icon | Info hover | `info` | 關 | showTitle |
| 資料呈現群組 | Layout | `layout` | 關 | — |
| 折線圖 | Line Chart | `line` | 開 | layout |
| 長條圖 | Bar Chart | `bar` | 開 | layout |
| 日曆 | Calendar | `calendar` | 開 | layout |
| 表格 | Table | `table` | 開 | layout |
| 卡片 | Card | `card` | 開 | layout |
| 更新時間 | RefreshTime | `refresh` | 關 | — |
| 自動儲存 | Automatic storage | `autosave` | 關 | — |
| 標籤 | Tag | `tag` | 關 | — |
| 下載按鈕 | Download | `download` | 關 | — |
| 右側關閉 | Close-Right | `close` | 關 | — |

### Title-EditName（11 項）

| 項目 | Figma 屬性 | key | 預設 | 所屬群組 |
| --- | --- | --- | --- | --- |
| 左側 Icon | TextIcon | `showIcon` | 開 | — |
| 標題文字 | HeadingText | `showTitle` | 開 | — |
| 資料呈現群組 | Layout | `layout` | 關 | — |
| 折線圖 | Line Chart | `line` | 開 | layout |
| 長條圖 | Bar Chart | `bar` | 開 | layout |
| 日曆 | Calendar | `calendar` | 開 | layout |
| 表格 | Table | `table` | 開 | layout |
| 卡片 | Card | `card` | 開 | layout |
| 更新時間 | RefreshTime | `refresh` | 關 | — |
| 下載按鈕 | Download | `download` | 關 | — |
| 右側關閉 | Close-Right | `close` | 關 | — |

### Sub Title（10 項）

| 項目 | Figma 屬性 | key | 預設 | 所屬群組 |
| --- | --- | --- | --- | --- |
| 左側 Icon | TextIcon | `showIcon` | 開 | — |
| 標題文字 | HeadingText | `showTitle` | 開 | — |
| 資訊 Icon | Info hover | `info` | 關 | showTitle |
| 標籤／數值群組 | Taginfo | `tagInfo` | 關 | — |
| 標籤 | Tag | `tag` | 關 | tagInfo |
| 數值 | Value | `value` | 開 | tagInfo |
| 單位 | Show Unit | `unit` | 開 | value |
| 單位 Icon | Show Unit Icon | `unitIcon` | 關 | unit |
| 主要按鈕 | Button 1 | `button1` | 開 | — |
| Switch | Switch | `switch` | 關 | — |

### Label（11 項）

| 項目 | Figma 屬性 | key | 預設 | 所屬群組 |
| --- | --- | --- | --- | --- |
| 返回按鈕 | Back | `back` | 關 | — |
| 左側 Icon | TextIcon | `showIcon` | 開 | — |
| 標題文字 | HeadingText | `showTitle` | 開 | — |
| 資訊 Icon | Info hover | `info` | 關 | showTitle |
| 標籤／數值群組 | Taginfo | `tagInfo` | 開 | — |
| 標籤 | Tag | `tag` | 關 | tagInfo |
| 數值 | Value | `value` | 關 | tagInfo |
| 單位 | Show Unit | `unit` | 開 | value |
| 單位 Icon | Show Unit Icon | `unitIcon` | 關 | unit |
| 主要按鈕 | Button 1 | `button1` | 開 | — |
| Switch | Switch | `switch` | 關 | — |

### 操作規則

- 「全部顯示」同時開啟群組與子項目；「全部隱藏」關閉所有有綁定的顯示屬性。
- 「還原 Figma 預設」只重設當前 Type 的開關，保留輸入資料及其他 Type 的設定。
- 父群組關閉時，子開關停用並提示需先開啟的群組；子開關自己的勾選值保留，不會越過父群組顯示。
- 各類型顯示設定分開保存；切換類型可回到自己的設定。6 個獨立範例互不影響。
- 固定圖層沒有開關，例如 Web-Header 使用者箭頭與 Title-EditName 的「｜」；全部隱藏仍依 Figma 結構保留。
- Web-Header 分隔線依原始綁定：通知前跟隨 Notify、使用者前跟隨 Language、設定前跟隨 Set。
- 測試欄位可修改標題、使用者名稱、未讀數、更新時間、自動儲存時間、標籤、數值與單位，只顯示當前 Type 適用欄位。未讀數示範限制 0～99，0 不顯示 Badge。

### 隱藏項目的視覺規格

| 項目 | 尺寸／樣式 |
| --- | --- |
| Info hover | 20 × 20px，與標題 gap 4px；圖示使用 Figma 原始 info SVG |
| 更新時間 | 12／16px、400、`--text-secondary`；預設 2027.05.01 10:00:00 |
| 自動儲存 | 18px 圖示，文字 12／16px、400、`--text-tertiary`；gap 4px，文字「草稿已自動儲存（10:00:42）」 |
| Tag | 高 26px、左右 padding 12px、radius 8px；14／18px、500、字距 0.5px；文字與外框 `--color-gray-400`，底色同色 6% |
| Sub Title 數值群組 | 高 34px、gap 6px；數值 18／24px、400、`--text-secondary`，與單位 gap 4px |
| 單位 | 12／16px、400、`--text-tertiary`；單位 Icon 12px、gap 2px |
| Switch Basic | 44 × 26px、內距 4px、18px 白色圓點；On `--cta`、Off `--border-primary`；整顆可點擊 |
| 次要按鈕 | Outlined，外框 `--border-theme-light`、文字 `--text-theme` |

Title 主元件高度為 HUG：開啟 Layout 或操作 Icon 時隨內容增至 34px，只有 Tag 時為 26px。Title-EditName 固定高 20px；34px 操作按鈕依 Figma 原結構置中溢出，不裁切。開啟隱藏項目後，不應繼續將所有 Type 都硬限制在預設展示高度。

示範以當前單一主題的語意 Token 呈現隱藏項目。主元件讀取時的其他模式解析色不覆寫定稿 Color System。圖示使用 Figma 原始 SVG，單色路徑改用 currentColor。

## 5. 互動與介面

### 名稱編輯

Title-EditName 使用原生 input，預設提示「請在此輸入名稱」。僅採用既有 TextField 聚焦時的亮框：`:focus` 套用 `box-shadow: inset 0 0 0 .5px var(--border-theme)`，滑鼠點擊與鍵盤聚焦皆生效，失焦移除。保留原本 20px 高度、透明背景、零 padding、原字型及排版，不套用 TextField 的底色、34px 高度、內距、圓角、Hover 外觀或其他配件。原本通用鍵盤 outline 在此輸入欄位停用，避免出現兩層框。靜態「｜」在輸入聚焦時隱藏，由原生 caret 呈現；關閉 HeadingText 時只隱藏輸入文字欄位，保留原本獨立的「｜」。

- Enter 或 blur 提交，值變動時只發出一次 rename。
- Escape 還原上次提交值；組字期間不攔截 Enter／Escape。
- 可輸入空值，未新增 Figma 未定義的必填或字數限制。
- 切換類型／顯示項目保留輸入資料。

提交、取消及原生輸入行為為可測試的工程補充；Figma 提供編輯名稱的視覺結構。

### 元件 API

`createT3Header(host, options)` 回傳：

| 方法 | 用途 |
| --- | --- |
| update(patch) | 合併資料或當前 Type 的 flags，重建 Header |
| getState() | 取得資料與當前 Type 的 flags 複本 |
| isVisible(key) | 檢查開關及所有父群組後的實際顯示狀態 |
| setAllVisible(bool) | 開啟／關閉當前 Type 全部顯示屬性 |
| resetVisibility() | 還原當前 Type 的 Figma 預設開關 |
| destroy() | 移除該 Header |

| 參數 | 預設 | 說明 |
| --- | --- | --- |
| type | web | web／subheader／title／edit／subtitle／label |
| flags | 前表預設 | 顯示項目，例如 `{layout:true,line:false}` |
| title／name | Title／空字串 | 標題／可編輯名稱 |
| languageText／count／userNameText | EN／1／Luna | Web-Header 資料 |
| refreshText／autosaveText | 2027.05.01 10:00:00／10:00:42 | 更新時間／儲存時間 |
| tagText／valueText／unitText | Label／123／% | 標籤、數值、單位 |
| button1Text／button2Text | Button 1／Button 2 | 按鈕文字；Sub Title／Label 的預設主要按鈕為 Button |
| switchOn／selectedLayout | true／null | Switch 值／呈現方式選取值 |

`update({flags:{...}})` 只合併目前 Type 的指定項目。全顯示、全隱藏及還原不改動資料或選取值。外部不要在名稱逐字輸入期間持續呼叫 update，以免中斷焦點或組字；輸入元件自己的事件不會逐字重建 DOM。

發出冒泡的 `t3-header-action`，`detail={action,value,type}`。action 包含 language、notifications、user-menu、settings、button-1、button-2、back、add、download、close、info、layout、switch、rename。Layout 僅發出一次 layout，value 為 line／bar／calendar／table／card；Switch value 為 boolean。圖示按鈕均提供中文 aria-label，鍵盤焦點可見；Switch 使用 role=switch 與 aria-checked。

語言按鈕以 EN／繁 切換示範。資訊 Icon、通知、使用者、設定、下載等只回報事件，業務視窗及資訊內容由實際產品串接。自動儲存項目展示狀態與時間，不代表真的執行儲存。未新增動畫規格。

## 6. 驗收與驗證

1. 每種類型的開關數量、預設值與主元件的實際 visible 綁定一致。
2. 各項能獨立開關；父群組關閉會抑制子內容，重新開啟可還原子開關值。
3. 全部顯示與全部隱藏正確；還原後回到 Figma 預設；不同 Type 及不同範例設定獨立。
4. 文字、名稱、Switch 與 Layout 的值不因顯示切換而遺失；名稱支援提交、取消與組字。
5. 953px 原始組合、隱藏項目的尺寸、Token、圖示及順序可與 Figma 比對。
6. 名稱欄位點擊及鍵盤聚焦時有單一 Focus 框，失焦移除，欄位高度／背景／內距不變。
7. 自動儲存圓點、Sub Title 單位 Icon、Label 單位 Icon 分別使用正確 Token；Label 11 項設定可獨立操作。

已完成 JavaScript 語法、開關／群組依賴、還原與資料保留、互動事件、Token 引用、文件及示範頁程式碼一致性檢查。瀏覽器視覺驗證尚未完成。

## 7. 參考 CSS

先載入定稿 Typography／Color System。以下 CSS 與示範頁共用。

```css
.t3-header { display:flex; align-items:center; gap:8px; width:100%; min-width:0; color:var(--text-primary); background:transparent; font-family:var(--font-primary); }
.t3-header * { box-sizing:border-box; }
.t3-header__title { display:flex; align-items:center; gap:8px; flex:1 1 0; min-width:0; height:100%; }
.t3-header__heading { margin:0; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:500 18px/24px var(--font-primary); letter-spacing:0; color:var(--text-primary); }
.t3-header__home { flex:0 0 20px; width:20px; display:flex; align-items:center; justify-content:center; }
.t3-header__home svg { flex:none; width:24px; height:24px; }
.t3-header--web { height:40px; }
.t3-header--web .t3-header__title { padding:0 12px; }
.t3-header--subheader,.t3-header--subtitle { height:34px; }
.t3-header--title,.t3-header--edit { height:20px; }
.t3-header--title .t3-header__heading,.t3-header--edit .t3-header__heading { font-size:16px; line-height:20px; }
.t3-header--subtitle .t3-header__heading { font:400 16px/20px var(--font-primary); }
.t3-header--title .t3-header__home,.t3-header--edit .t3-header__home,.t3-header--subtitle .t3-header__home { width:18px; flex-basis:18px; color:var(--text-tertiary); }
.t3-header--title .t3-header__home svg,.t3-header--edit .t3-header__home svg,.t3-header--subtitle .t3-header__home svg { width:20px; height:20px; }
.t3-header__actions,.t3-header__user { display:flex; align-items:center; flex:none; }
.t3-header__actions { gap:8px; }
.t3-header--web .t3-header__actions { gap:16px; }
.t3-header__button,.t3-header__icon-button,.t3-header__avatar,.t3-header__user { border:0; margin:0; cursor:pointer; font-family:var(--font-primary); color:var(--text-secondary); background:transparent; }
.t3-header__button { height:34px; border-radius:8px; padding:8px 14px; font-size:14px; line-height:18px; font-weight:500; letter-spacing:.5px; white-space:nowrap; }
.t3-header__button--filled { color:#fff; background:var(--link-theme-filled); }
.t3-header__button--filled:hover { background:var(--link-theme-filled-hover); }
.t3-header__button--filled:active { background:var(--link-theme-filled-pressed); }
.t3-header__button--standard { background:var(--link-standard); }
.t3-header__button--standard:hover { background:var(--link-standard-hover); }
.t3-header__button--standard:active { background:var(--link-standard-pressed); }
.t3-header__icon-button { display:flex; align-items:center; justify-content:center; flex:none; width:34px; height:34px; padding:2px; border-radius:8px; }
.t3-header__icon-button svg { width:24px; height:24px; }
.t3-header__icon-button:hover,.t3-header__avatar:hover { background:var(--link-standard); }
.t3-header__icon-button:active { background:var(--link-standard-hover); }
.t3-header__icon-button[aria-pressed="true"] { color:var(--text-theme); background:var(--link-standard); }
.t3-header__settings { background:var(--link-standard); }
.t3-header__settings:hover { background:var(--link-standard-hover); }
.t3-header__settings:active { background:var(--link-standard-pressed); }
.t3-header :is(button,input):focus-visible { outline:2px solid var(--border-theme); outline-offset:2px; }
.t3-header__divider { width:1px; height:18px; flex:none; background:var(--border-quaternary); }
.t3-header--web .t3-header__divider { height:20px; }
.t3-header__avatar { display:flex; align-items:center; justify-content:center; position:relative; flex:none; width:40px; height:40px; border-radius:50%; background:var(--link-standard); padding:8px; color:var(--text-tertiary); }
.t3-header__avatar svg { width:24px; height:24px; }
.t3-header__badge { position:absolute; top:-4px; right:-4px; display:flex; align-items:center; justify-content:center; min-width:16px; height:16px; padding:0 4px; border:1px solid var(--surface-primary); border-radius:1000px; background:#dc2626; color:#fff; font:500 10px/14px var(--font-primary); letter-spacing:.5px; }
.t3-header__user { padding:0; gap:0; height:40px; font:400 16px/20px var(--font-primary); }
.t3-header__user-info { display:flex; align-items:center; gap:4px; }
.t3-header__user-arrow { display:flex; width:34px; height:36px; align-items:center; justify-content:center; }
.t3-header__user-arrow svg { width:24px; height:24px; color:var(--text-quaternary); }
.t3-header__edit { display:flex; min-width:0; flex:1; align-items:center; font:500 16px/20px var(--font-primary); color:var(--text-tertiary); }
.t3-header__caret { flex:none; width:16px; }
.t3-header__input { min-width:0; width:100%; height:20px; padding:0; border:0; border-radius:0; background:transparent; color:var(--text-primary); caret-color:var(--text-primary); font:inherit; outline:none; }
.t3-header__input::placeholder { color:var(--text-tertiary); opacity:1; }
.t3-header [hidden] { display:none!important; }
.t3-header__svg { display:flex; align-items:center; justify-content:center; flex:none; }
.t3-header__avatar:hover { background:var(--link-standard-hover); }
.t3-header__user-arrow svg { color:var(--color-gray-400); }
.t3-header--title { height:auto; min-height:20px; }
.t3-header__heading-group { display:flex; align-items:center; gap:4px; min-width:0; }
.t3-header__heading-group .t3-header__heading { flex:0 1 auto; }
.t3-header__info { width:20px; height:20px; padding:0; border-radius:4px; color:var(--text-tertiary); }
.t3-header__info svg { width:20px; height:20px; }
.t3-header__time { flex:none; font:400 12px/16px var(--font-primary); color:var(--text-secondary); white-space:nowrap; }
.t3-header__saved { display:flex; align-items:center; flex:none; gap:4px; font:400 12px/16px var(--font-primary); color:var(--text-tertiary); white-space:nowrap; }
.t3-header__saved svg { width:18px; height:18px; }
.t3-header__layout { display:flex; align-items:center; flex:none; gap:0; height:34px; }
.t3-header__layout .t3-header__icon-button svg { width:18px; height:18px; }
.t3-header__icon-button[aria-pressed="true"] { color:var(--text-theme); background:var(--link-standard); }
.t3-header__button--outlined { border:1px solid var(--border-theme-light); background:transparent; color:var(--text-theme); }
.t3-header__button--outlined:hover { background:var(--surface-theme); }
.t3-header__button--outlined:active { background:var(--link-standard); }
.t3-header__tag { flex:none; padding:3px 12px; height:26px; border:1px solid var(--color-gray-400); border-radius:8px; background:rgb(from var(--color-gray-400) r g b / 6%); color:var(--color-gray-400); font:500 14px/18px var(--font-primary); letter-spacing:.5px; white-space:nowrap; }
.t3-header__value-group { display:flex; align-items:center; flex:none; gap:6px; height:34px; }
.t3-header__value { display:flex; align-items:center; gap:4px; height:34px; font:400 18px/24px var(--font-primary); color:var(--text-secondary); white-space:nowrap; }
.t3-header__unit { display:flex; align-items:center; gap:2px; font:400 12px/16px var(--font-primary); color:var(--text-tertiary); }
.t3-header__unit svg { width:12px; height:12px; }
.t3-header__switch { display:flex; align-items:center; flex:none; width:44px; height:26px; padding:4px; border:0; border-radius:1000px; background:var(--border-primary); cursor:pointer; }
.t3-header__switch-thumb { display:block; width:18px; height:18px; border-radius:50%; background:#fff; }
.t3-header__switch[aria-checked="true"] { background:var(--cta); }
.t3-header__switch[aria-checked="true"] .t3-header__switch-thumb { margin-left:18px; }
/* Name editing borrows only the TextField Focus border, without its surface, size or padding. */
.t3-header__input { box-shadow:none; }
.t3-header .t3-header__input:focus { outline:none; box-shadow:inset 0 0 0 .5px var(--border-theme); }
/* Each SVG keeps currentColor; color is assigned to the actual icon rather than the whole text row. */
.t3-header__saved>.t3-header__svg { color:var(--status-success); }
.t3-header--subtitle .t3-header__unit>.t3-header__svg { color:var(--text-secondary); }
.t3-header--label { height:auto; min-height:18px; }
.t3-header--label .t3-header__title { gap:4px; height:auto; align-self:stretch; }
.t3-header--label .t3-header__home { width:14px; flex-basis:14px; color:var(--text-tertiary); }
.t3-header--label .t3-header__home svg { width:16px; height:16px; }
.t3-header--label .t3-header__heading,.t3-header--label .t3-header__value { font:400 14px/18px var(--font-primary); letter-spacing:.5px; }
.t3-header--label .t3-header__title>.t3-header__icon-button { width:24px; height:24px; }
.t3-header--label .t3-header__title>.t3-header__icon-button svg { width:18px; height:18px; }
.t3-header--label .t3-header__unit>.t3-header__svg { color:var(--text-primary); }
```

## 8. 參考 JavaScript

`HEADER_ICONS` 為示範頁內嵌的 Figma SVG（home24、home20、notify、avatar、userDown、settings、back、add、download、close、line、bar、calendar、table、card、info、car、saved）。保留其原始 viewBox；請直接取用示範頁中的向量資料。

```js
const HEADER_PARTS={"web": [{"key": "showIcon", "figma": "TextIcon", "label": "左側 Icon", "default": true, "parent": null, "source": "1234:57394"}, {"key": "showTitle", "figma": "HeadingText", "label": "標題文字", "default": true, "parent": null, "source": "1232:51546"}, {"key": "language", "figma": "Language", "label": "語言按鈕", "default": true, "parent": null, "source": "1232:51518"}, {"key": "notify", "figma": "Notify", "label": "通知", "default": true, "parent": null, "source": "1232:51526"}, {"key": "userImage", "figma": "UserImage", "label": "使用者頭像", "default": true, "parent": null, "source": "1232:51482"}, {"key": "userName", "figma": "UserName", "label": "使用者名稱", "default": true, "parent": null, "source": "1408:40803"}, {"key": "settings", "figma": "Set", "label": "設定按鈕", "default": true, "parent": null, "source": "1453:6324"}], "subheader": [{"key": "back", "figma": "Back", "label": "返回按鈕", "default": false, "parent": null, "source": "1232:51668"}, {"key": "showIcon", "figma": "TextIcon", "label": "左側 Icon", "default": true, "parent": null, "source": "1234:57390"}, {"key": "showTitle", "figma": "HeadingText", "label": "標題文字", "default": true, "parent": null, "source": "1659:5563"}, {"key": "info", "figma": "Info hover", "label": "資訊 Icon", "default": false, "parent": "showTitle", "source": "1659:5565"}, {"key": "refresh", "figma": "RefreshTime", "label": "更新時間", "default": false, "parent": null, "source": "1232:46556"}, {"key": "autosave", "figma": "Automatic storage", "label": "自動儲存", "default": false, "parent": null, "source": "1250:2769"}, {"key": "showActions", "figma": "Action", "label": "操作按鈕群組", "default": true, "parent": null, "source": "1232:46551"}, {"key": "button2", "figma": "Button 2", "label": "次要按鈕", "default": false, "parent": "showActions", "source": "1232:46553"}, {"key": "button1", "figma": "Button 1", "label": "主要按鈕", "default": true, "parent": "showActions", "source": "1232:46554"}, {"key": "add", "figma": "Add", "label": "新增按鈕", "default": false, "parent": null, "source": "1232:46557"}, {"key": "download", "figma": "Download", "label": "下載按鈕", "default": false, "parent": null, "source": "1232:51672"}, {"key": "close", "figma": "Close-Right", "label": "右側關閉", "default": false, "parent": null, "source": "1232:46559"}, {"key": "tag", "figma": "Tag", "label": "標籤", "default": false, "parent": null, "source": "1481:25230"}, {"key": "switch", "figma": "Switch", "label": "Switch", "default": false, "parent": null, "source": "1481:25255"}], "title": [{"key": "showIcon", "figma": "TextIcon", "label": "左側 Icon", "default": true, "parent": null, "source": "1234:57373"}, {"key": "showTitle", "figma": "HeadingText", "label": "標題文字", "default": true, "parent": null, "source": "1659:5470"}, {"key": "info", "figma": "Info hover", "label": "資訊 Icon", "default": false, "parent": "showTitle", "source": "1659:4627"}, {"key": "layout", "figma": "Layout", "label": "資料呈現群組", "default": false, "parent": null, "source": "1232:46564"}, {"key": "line", "figma": "Line Chart", "label": "折線圖", "default": true, "parent": "layout", "source": "1232:46565"}, {"key": "bar", "figma": "Bar Chart", "label": "長條圖", "default": true, "parent": "layout", "source": "1232:46566"}, {"key": "calendar", "figma": "Calendar", "label": "日曆", "default": true, "parent": "layout", "source": "1232:46568"}, {"key": "table", "figma": "Table", "label": "表格", "default": true, "parent": "layout", "source": "1232:46567"}, {"key": "card", "figma": "Card", "label": "卡片", "default": true, "parent": "layout", "source": "1232:46569"}, {"key": "refresh", "figma": "RefreshTime", "label": "更新時間", "default": false, "parent": null, "source": "1232:46570"}, {"key": "autosave", "figma": "Automatic storage", "label": "自動儲存", "default": false, "parent": null, "source": "1265:5620"}, {"key": "tag", "figma": "Tag", "label": "標籤", "default": false, "parent": null, "source": "1285:712"}, {"key": "download", "figma": "Download", "label": "下載按鈕", "default": false, "parent": null, "source": "1232:46571"}, {"key": "close", "figma": "Close-Right", "label": "右側關閉", "default": false, "parent": null, "source": "1232:46572"}], "edit": [{"key": "showIcon", "figma": "TextIcon", "label": "左側 Icon", "default": true, "parent": null, "source": "1239:1152"}, {"key": "showTitle", "figma": "HeadingText", "label": "標題文字", "default": true, "parent": null, "source": "1239:1166"}, {"key": "layout", "figma": "Layout", "label": "資料呈現群組", "default": false, "parent": null, "source": "1239:1155"}, {"key": "line", "figma": "Line Chart", "label": "折線圖", "default": true, "parent": "layout", "source": "1239:1156"}, {"key": "bar", "figma": "Bar Chart", "label": "長條圖", "default": true, "parent": "layout", "source": "1239:1157"}, {"key": "calendar", "figma": "Calendar", "label": "日曆", "default": true, "parent": "layout", "source": "1239:1158"}, {"key": "table", "figma": "Table", "label": "表格", "default": true, "parent": "layout", "source": "1239:1159"}, {"key": "card", "figma": "Card", "label": "卡片", "default": true, "parent": "layout", "source": "1239:1160"}, {"key": "refresh", "figma": "RefreshTime", "label": "更新時間", "default": false, "parent": null, "source": "1239:1161"}, {"key": "download", "figma": "Download", "label": "下載按鈕", "default": false, "parent": null, "source": "1239:1162"}, {"key": "close", "figma": "Close-Right", "label": "右側關閉", "default": false, "parent": null, "source": "1239:1163"}], "subtitle": [{"key": "showIcon", "figma": "TextIcon", "label": "左側 Icon", "default": true, "parent": null, "source": "1234:57386"}, {"key": "showTitle", "figma": "HeadingText", "label": "標題文字", "default": true, "parent": null, "source": "1659:5585"}, {"key": "info", "figma": "Info hover", "label": "資訊 Icon", "default": false, "parent": "showTitle", "source": "1659:5587"}, {"key": "tagInfo", "figma": "Taginfo", "label": "標籤／數值群組", "default": false, "parent": null, "source": "1232:46576"}, {"key": "tag", "figma": "Tag", "label": "標籤", "default": false, "parent": "tagInfo", "source": "1232:46577"}, {"key": "value", "figma": "Value", "label": "數值", "default": true, "parent": "tagInfo", "source": "1232:46578"}, {"key": "unit", "figma": "Show Unit", "label": "單位", "default": true, "parent": "value", "source": "1232:46580"}, {"key": "unitIcon", "figma": "Show Unit Icon", "label": "單位 Icon", "default": false, "parent": "unit", "source": "1232:46581"}, {"key": "button1", "figma": "Button 1", "label": "主要按鈕", "default": true, "parent": null, "source": "1234:56896"}, {"key": "switch", "figma": "Switch", "label": "Switch", "default": false, "parent": null, "source": "1394:30857"}], "label": [{"key": "back", "figma": "Back", "label": "返回按鈕", "default": false, "parent": null, "source": "1530:6256"}, {"key": "showIcon", "figma": "TextIcon", "label": "左側 Icon", "default": true, "parent": null, "source": "1490:498"}, {"key": "showTitle", "figma": "HeadingText", "label": "標題文字", "default": true, "parent": null, "source": "1659:5617"}, {"key": "info", "figma": "Info hover", "label": "資訊 Icon", "default": false, "parent": "showTitle", "source": "1659:5619"}, {"key": "tagInfo", "figma": "Taginfo", "label": "標籤／數值群組", "default": true, "parent": null, "source": "1490:501"}, {"key": "tag", "figma": "Tag", "label": "標籤", "default": false, "parent": "tagInfo", "source": "1490:502"}, {"key": "value", "figma": "Value", "label": "數值", "default": false, "parent": "tagInfo", "source": "1490:503"}, {"key": "unit", "figma": "Show Unit", "label": "單位", "default": true, "parent": "value", "source": "1490:505"}, {"key": "unitIcon", "figma": "Show Unit Icon", "label": "單位 Icon", "default": false, "parent": "unit", "source": "1490:506"}, {"key": "button1", "figma": "Button 1", "label": "主要按鈕", "default": true, "parent": null, "source": "1490:508"}, {"key": "switch", "figma": "Switch", "label": "Switch", "default": false, "parent": null, "source": "1490:509"}]};
const HEADER_TYPES = ['web','subheader','title','edit','subtitle','label'];
// HEADER_PARTS records the visibility bindings on the six actual Figma sources.
function createT3Header(host, options = {}) {
  const {flags:initialFlags={},...initial}=options;
  const state={type:'web',title:'Title',name:'',languageText:'EN',count:1,userNameText:'Luna',refreshText:'2027.05.01 10:00:00',autosaveText:'10:00:42',tagText:'Label',valueText:'123',unitText:'%',button1Text:'Button 1',button2Text:'Button 2',switchOn:true,selectedLayout:null,...initial};
  if(!HEADER_TYPES.includes(state.type))throw new RangeError('Unknown Header type');
  const visibility=Object.fromEntries(HEADER_TYPES.map(t=>[t,Object.fromEntries(HEADER_PARTS[t].map(p=>[p.key,p.default]))]));
  Object.assign(visibility[state.type],initialFlags);
  let committed=state.name;
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
  const svg=key=>{const n=el('span','t3-header__svg');n.innerHTML=HEADER_ICONS[key];return n;};
  const report=(action,value)=>host.dispatchEvent(new CustomEvent('t3-header-action',{bubbles:true,detail:{action,value,type:state.type}}));
  const part=key=>HEADER_PARTS[state.type].find(p=>p.key===key);
  function on(key){const p=part(key);return !!p&&!!visibility[state.type][key]&&(!p.parent||on(p.parent));}
  function mark(node,key){node.dataset.part=key;return node;}
  function button(label,action,style='filled'){const b=el('button','t3-header__button t3-header__button--'+style,label);b.type='button';b.addEventListener('click',()=>typeof action==='function'?action():report(action));return b;}
  function icon(key,label,action=key){const b=el('button','t3-header__icon-button');b.type='button';b.setAttribute('aria-label',label);b.append(svg(key));if(action)b.addEventListener('click',()=>report(action));return b;}
  function divider(){const d=el('span','t3-header__divider');d.setAttribute('aria-hidden','true');return d;}
  function tag(){return mark(el('span','t3-header__tag',state.tagText),'tag');}
  function switchButton(){const b=mark(el('button','t3-header__switch'),'switch');b.type='button';b.setAttribute('role','switch');b.setAttribute('aria-label','切換狀態');b.setAttribute('aria-checked',String(state.switchOn));b.append(el('span','t3-header__switch-thumb'));b.addEventListener('click',()=>{state.switchOn=!state.switchOn;b.setAttribute('aria-checked',String(state.switchOn));report('switch',state.switchOn);});return b;}
  function layout(){const g=mark(el('div','t3-header__layout'),'layout');g.setAttribute('role','group');g.setAttribute('aria-label','資料呈現方式');for(const [key,label] of [['line','折線圖'],['bar','長條圖'],['calendar','日曆'],['table','表格'],['card','卡片']]){if(!on(key))continue;const b=mark(icon(key,label,null),'layout-'+key);b.setAttribute('aria-pressed',String(state.selectedLayout===key));b.addEventListener('click',()=>{state.selectedLayout=key;for(const child of g.children)child.setAttribute('aria-pressed',String(child===b));report('layout',key);});g.append(b);}return g;}
  function render(){
    const root=el('header','t3-header t3-header--'+state.type),title=el('div','t3-header__title');host.replaceChildren(root);
    if(on('back')){const back=mark(icon('back','返回'),'back');if(state.type==='label')title.append(back);else root.append(back);}
    if(on('showIcon')){const home=mark(el('span','t3-header__home'),'showIcon');home.append(svg(['web','subheader'].includes(state.type)?'home24':'home20'));home.setAttribute('aria-hidden','true');title.append(home);}
    if(on('showTitle')||state.type==='edit'){
      if(state.type==='edit'){
        const group=mark(el('div','t3-header__edit'),'editName'),caret=el('span','t3-header__caret','｜'),input=el('input','t3-header__input');caret.setAttribute('aria-hidden','true');mark(input,'showTitle');input.hidden=!on('showTitle');input.type='text';input.value=state.name;input.placeholder='請在此輸入名稱';input.setAttribute('aria-label','標題名稱');
        const commit=()=>{if(input.value!==committed){committed=input.value;state.name=input.value;report('rename',state.name);}};
        input.addEventListener('input',()=>state.name=input.value);input.addEventListener('focus',()=>caret.hidden=true);input.addEventListener('blur',()=>{caret.hidden=!!input.value;commit();});
        input.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Enter'){e.preventDefault();commit();input.blur();}if(e.key==='Escape'){e.preventDefault();input.value=committed;state.name=committed;input.blur();}});caret.hidden=on('showTitle')&&!!state.name;group.append(caret,input);title.append(group);
      }else{
        const group=mark(el('div','t3-header__heading-group'),'showTitle'),h=el('h2','t3-header__heading',state.title);h.title=state.title;group.append(h);
        if(on('info')){const info=mark(icon('info','資訊說明'),'info');info.classList.add('t3-header__info');info.title='資訊說明';group.append(info);}title.append(group);
      }
    }
    root.append(title);
    if(state.type==='web'){
      const actions=el('div','t3-header__actions');
      if(on('language')){const b=mark(button(state.languageText,()=>{state.languageText=state.languageText==='EN'?'繁':'EN';b.textContent=state.languageText;report('language',state.languageText);},'standard'),'language');b.setAttribute('aria-label','切換語言（示範）');actions.append(b);}
      // Divider visibility follows its actual Figma binding, including the shared switches.
      if(on('notify'))actions.append(divider());
      if(on('notify')){const b=mark(el('button','t3-header__avatar'),'notify');b.type='button';b.setAttribute('aria-label','通知，'+state.count+' 則未讀');b.append(svg('notify'));if(state.count>0)b.append(el('span','t3-header__badge',String(state.count)));b.addEventListener('click',()=>report('notifications',state.count));actions.append(b);}
      if(on('language'))actions.append(divider());
      const user=el('button','t3-header__user'),info=el('span','t3-header__user-info'),arrow=el('span','t3-header__user-arrow');user.type='button';user.setAttribute('aria-label','使用者選單：'+state.userNameText);
      if(on('userImage')){const avatar=mark(el('span','t3-header__avatar'),'userImage');avatar.append(svg('avatar'));info.append(avatar);}
      if(on('userName'))info.append(mark(el('span','',state.userNameText),'userName'));
      arrow.append(svg('userDown'));user.append(info,arrow);user.addEventListener('click',()=>report('user-menu',state.userNameText));actions.append(user);
      if(on('settings')){actions.append(divider());const b=mark(icon('settings','設定'),'settings');b.classList.add('t3-header__settings');actions.append(b);}root.append(actions);
    }
    if(on('layout'))root.append(layout());
    if(on('refresh')){root.append(mark(el('time','t3-header__time',state.refreshText),'refresh'));if(state.type==='subheader')root.append(divider());}
    if(on('autosave')){const saved=mark(el('span','t3-header__saved'),'autosave');saved.append(svg('saved'),el('span','','草稿已自動儲存（'+state.autosaveText+'）'));root.append(saved);}
    if(state.type==='subheader'&&on('showActions')){const actions=mark(el('div','t3-header__actions'),'showActions');if(on('button2'))actions.append(mark(button(state.button2Text,'button-2','outlined'),'button2'));if(on('button1'))actions.append(mark(button(state.button1Text,'button-1'),'button1'));root.append(actions);}
    if(on('add'))root.append(divider(),mark(icon('add','新增'),'add'));
    if(state.type==='title'&&on('tag'))root.append(tag());
    if(on('download'))root.append(mark(icon('download','下載'),'download'));
    if(on('close'))root.append(mark(icon('close','關閉'),'close'));
    if(state.type==='subheader'&&on('tag'))root.append(tag());
    if(['subtitle','label'].includes(state.type)&&on('tagInfo')){const group=mark(el('div','t3-header__value-group'),'tagInfo');if(on('tag'))group.append(tag());if(on('value')){const value=mark(el('div','t3-header__value'),'value');value.append(el('span','',state.valueText));if(on('unit')){const unit=mark(el('span','t3-header__unit'),'unit');if(on('unitIcon'))unit.append(mark(svg('car'),'unitIcon'));unit.append(el('span','',state.unitText));value.append(unit);}group.append(value);}root.append(group);}
    if(['subtitle','label'].includes(state.type)&&on('button1'))root.append(mark(button(state.button1Text==='Button 1'?'Button':state.button1Text,'button-1'),'button1'));
    if(on('switch'))root.append(switchButton());
  }
  render();
  return {
    update(patch){if('type'in patch&&!HEADER_TYPES.includes(patch.type))throw new RangeError('Unknown Header type');const {flags:flagPatch={},...values}=patch;const flags={...flagPatch};Object.assign(state,values);for(const key of ['showIcon','showTitle','showActions'])if(key in values)flags[key]=values[key];for(const [key,value] of Object.entries(flags))if(part(key))visibility[state.type][key]=!!value;if('name'in patch)committed=patch.name;render();},
    getState(){return {...state,flags:{...visibility[state.type]}};},
    isVisible:key=>on(key),
    setAllVisible(value){for(const p of HEADER_PARTS[state.type])visibility[state.type][p.key]=!!value;render();},
    resetVisibility(){for(const p of HEADER_PARTS[state.type])visibility[state.type][p.key]=p.default;render();},
    destroy(){host.replaceChildren();}
  };
}
```
