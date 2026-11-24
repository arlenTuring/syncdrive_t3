# T3 UI Kit｜Dropdown 工程規範

設計來源為 [Dropdown 節點 249:11329](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-11329)。字體與色票沿用定稿的 T3 Typography／Color System。

## 1. 元件範圍

| 元件 | 組合 |
| --- | --- |
| Dropdown | 3 Styles × 2 Sections × 4 States，共 24 個變體。另有相同 24 個隱藏 Label 的展示樣本。 |
| Text-Dropdown | 2 Hierarchies × 4 States，共 8 個變體。 |
| 樣本總數 | 48 個 Dropdown 樣本、8 個 Text-Dropdown 樣本，共 56 個。 |

Dropdown 的 Style 為 Tonal-Theme、Tonal-Gray、Outlined。Section 為 Single、Multiple。State 為 Default、Focus、Active、Disabled。

Text-Dropdown 的 Hierarchy 為 Superior、Subordinate，State 為 Default、Hover、Active、Disabled。Figma 將 Subordinate 拼為 `Subrodinate`、屬性名拼為 `Hierachy`，工程 API 使用 `subordinate`、`hierarchy`。

## 2. 尺寸與組成

| 部位 | 規格 |
| --- | --- |
| Dropdown 寬度 | Figma 樣本 240px。元件依父容器調整寬度，對照測試使用 240px。 |
| 有 Label | Label 高 18px、下 gap 4px、單行欄位高 34px，合計 56px。Label 左右 padding 8px，使用 `.text-body-s-bold`、`--text-tertiary`。 |
| RequiredMark | 星號 `*` 使用 `--status-error-emphasis`。星號與標題以相鄰節點呈現，標題文字從首字開始。 |
| 無 Label | 隱藏整個 Label 與星號，單行高 34px。仍提供可讀名稱。 |
| Single 欄位 | 圓角 8px、左右 padding 12px、文字 14px／18px、字距 0.5px。右側箭頭 20 × 20px。 |
| Multiple 欄位 | 空值沿用 Single 配置。含值時左 padding 4px、右 12px、上下 2px，標籤區上下各 2px、標籤 gap 4px。可換行，欄位高度隨行數伸展。 |
| Input-Chip | 樣本 Item1 為 91 × 26px，圓角 8px、1px 內描邊 `--border-secondary`。左右 padding 16px／8px、gap 8px，文字用 `.text-body-s-bold`、`--text-primary`。Remove 圖示 18 × 18px。 |
| Disabled Chip | 描邊 `--border-disabled`、文字 `--text-disabled`，移除按鈕停用。 |
| Supporting Text | Figma 預設隱藏，啟用時 24px 高，上下 padding 4px、左右 12px，字體 12px／16px、`--text-tertiary`。 |
| Text-Dropdown | Label 樣本寬 71px、高 24px；左 padding 8px、右 4px、圓角 4px。文字 14px／18px、字重 500、字距 0.5px。箭頭 20 × 20px。 |

## 3. Dropdown 色票與狀態

各格依序為背景／0.5px 內描邊。

| Style | Default | Focus | Active | Disabled |
| --- | --- | --- | --- | --- |
| Tonal-Theme | `--surface-theme`／透明 | `--surface-theme`／`--border-theme` | `--surface-theme`／透明 | `--surface-disabled`／透明 |
| Tonal-Gray | `--surface-secondary`／透明 | `--surface-secondary`／`--link-standard` | `--surface-secondary`／透明 | `--surface-disabled`／透明 |
| Outlined Single | 透明／`--border-primary` | `--link-standard-focus`／`--border-theme` | 透明／`--border-primary` | `--surface-disabled`／`--border-primary` |
| Outlined Multiple | 透明／`--border-primary` | `--link-standard-focus`／`--border-theme` | 透明／`--border-primary` | `--surface-disabled`／`--border-disabled` |

Figma 的 `link/standard-focus` 為 12% 灰色，參考實作使用 `var(--link-standard-focus, var(--link-standard))` 與定稿色票銜接。

| State | 外觀與行為 |
| --- | --- |
| Default | 空值顯示「請選擇」，文字 `--text-tertiary`，向下箭頭。 |
| Focus | 選單展開，向上箭頭。「請選擇」文字使用 `--text-primary`（#F3F4F6）。已選值與 Chips 顯示於欄位。 |
| Active | 選單關閉且已有值，向下箭頭，文字 `--text-primary`。 |
| Disabled | 優先於其他狀態，選單關閉、文字 `--text-disabled`，觸發與移除操作停用。 |

[有 Label](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-18165) · [無 Label](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-12333) · [Outlined Multiple Disabled](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-14429)

## 4. Menu 與 Text-Dropdown

| 部位 | 規格 |
| --- | --- |
| Dropdown Menu | 與欄位等寬，最大高 312px、上下 padding 4px、圓角 8px，背景 `--surface-background`。 |
| Menu 與欄位距離 | Tonal-Theme／Tonal-Gray 為 7px，Outlined 為 16px，依各 Focus 樣本。 |
| Menu item | 本節點使用 40px 高的純文字選項。左右總 padding 20px（Wrapper 12px ＋ Content 8px），文字用 `.text-body-s`、`--text-primary`。 |
| Hover／選取 | Hover 底色 `--link-standard`（rgba(209, 213, 220, 0.12)），單選／多選、已選／未選均適用。已選文字使用 `--text-theme`。 |
| Scroller | 右側槽寬 12px、上下各 4px。滑塊寬 4px、距右 8px、圓角 100px、顏色 `--border-disabled`（rgba(212, 212, 212, 0.10)）；Figma 樣本滑塊高 164px，位置隨捲動更新。 |
| Text-Dropdown Menu | 最小寬 120px，樣本 3 項合計高 128px、圓角 8px，位於觸發區左側 -20px、下方 4px。背景 `--surface-popup`，陰影 `0 4px 24px var(--surface-disabled)`。 |

| Hierarchy | Default 文字 | Hover 文字／背景 | Active 文字 | Disabled 文字 |
| --- | --- | --- | --- | --- |
| Subordinate | `--text-quaternary` | `--text-secondary`／`--link-standard-hover` | `--text-tertiary` | `--text-disabled` |
| Superior | `--link-theme-filled` | `--link-theme-filled-hover`／透明 | `--text-theme` | `--text-disabled` |

Text-Dropdown 的四種狀態都使用向下箭頭，各狀態圖示依 Figma 原始色票呈現。Hover 樣本包含展開的 Menu，測試頁支援滑入開啟、點擊及鍵盤操作。

[Text-Dropdown](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-18900) · [單選 Focus Menu](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-14407) · [多選 Focus Menu](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=249-14411)

## 5. 工程 API 與驗收

| API | 行為 |
| --- | --- |
| `options` | `{ value, label, disabled? }[]`，value 在同一份選項中唯一。label 以文字渲染。 |
| `multiple` | false 為單選，true 為多選。單選回傳 value 或 null，多選回傳 value 陣列。 |
| `value`／`setValue(value)` | 以 value 對應選項，過濾重複與未知值。多選保留選取順序。程式設定值後更新畫面。 |
| `style` | `tonal-theme`、`tonal-gray`、`outlined`。 |
| `label`／`labelVisible`／`required`／`help` | 控制標題、必填記號及輔助文字。 |
| `textOnly`／`hierarchy` | 啟用 Text-Dropdown，hierarchy 為 `subordinate` 或 `superior`。 |
| `disabled`／`setDisabled(boolean)` | 停用欄位與 Chip 移除，已選值繼續顯示。 |
| `onChange(value)` | 使用者選取或移除時通知一次。程式呼叫 setValue 不觸發。 |
| `getValue()`／`destroy()` | 取得目前值；移除實例並清除外部點擊監聽。 |

單選選項點擊後回填值並關閉選單。多選點擊切換選取，選單維持展開，欄位即時顯示 Chips。點選 Remove 只移除該值。最後一個值移除後顯示 placeholder。Escape、外部點擊或焦點移出元件時關閉選單。上下方向鍵移動選項，Home／End 跳到首尾，Enter／Space 使用原生按鈕選取。

工程可將以下 DOM 接線換成專案框架，沿用 CSS class、data 屬性與同一份 value。欄位與選單必須使用相同狀態來源。若選單以 Portal 掛載，外部點擊與焦點判斷需同時包含觸發區和選單。選項點擊造成重繪時，以事件 composedPath 判斷來源，避免把選取誤判成外部點擊。

測試頁的選項用 Item1、Item2 等編號，方便辨識回填值。Figma 的選項示意文字為 Menu item。測試設定放在元件下方的收合區，固定對照格的 Focus／Hover 展開是展示狀態。

| 驗收 | 預期結果 |
| --- | --- |
| 單選選取不同項目 | 值回填、選單關閉，重新開啟能辨識已選項。 |
| 多選連續選取 | 每次點擊立即增減 Chips，選單持續可操作。 |
| 移除 Chip | 只移除目標值，回呼一次，移除最後一個後回到 Default。 |
| 單行／多行 Chips | 單行維持 34px，換行後欄位長高且尾端箭頭垂直置中。 |
| Disabled | 滑鼠、鍵盤及 Remove 都無法更動值。 |
| 隱藏 Label／星號 | 標題排版收合，文字前方沒有額外空格。 |
| Text-Dropdown | 對照兩個 Hierarchy 的四種狀態及 120px 選單。 |
| 捲軸、方向鍵與外部關閉 | 可到達最後一項，捲軸同步位置，選取後仍可重新開啟。 |

## 6. CSS

先載入已定稿的 T3 字體與色票，再套用下列元件樣式。

```css
.t3-dropdown { position: relative; width: 240px; max-width: 100%; font: 400 14px/18px var(--font-primary); letter-spacing: .5px; }
.t3-dropdown__label { display: block; padding: 0 8px; margin-bottom: 4px; color: var(--text-tertiary); font-weight: 500; }
.t3-dropdown__required { color: var(--status-error-emphasis); }
.t3-dropdown__help { margin: 0; padding: 4px 12px; color: var(--text-tertiary); font: 400 12px/16px var(--font-primary); letter-spacing: 0; }
.t3-dropdown__field {
  --dropdown-bg: var(--surface-theme);
  --dropdown-stroke: transparent;
  position: relative; display: flex; align-items: center; width: 100%; min-height: 34px;
  padding: 2px 12px; border: 0; border-radius: 8px; cursor: pointer;
  background: var(--dropdown-bg); box-shadow: inset 0 0 0 .5px var(--dropdown-stroke);
  color: var(--text-primary); font: inherit;
}
.t3-dropdown[data-style="tonal-gray"] .t3-dropdown__field { --dropdown-bg: var(--surface-secondary); }
.t3-dropdown[data-style="outlined"] .t3-dropdown__field { --dropdown-bg: transparent; --dropdown-stroke: var(--border-primary); }
.t3-dropdown[data-state="focus"] .t3-dropdown__field { --dropdown-stroke: var(--border-theme); }
.t3-dropdown[data-style="tonal-gray"][data-state="focus"] .t3-dropdown__field { --dropdown-stroke: var(--link-standard); }
.t3-dropdown[data-style="outlined"][data-state="focus"] .t3-dropdown__field { --dropdown-bg: var(--link-standard-focus, var(--link-standard)); }
.t3-dropdown[data-state="disabled"] .t3-dropdown__field { --dropdown-bg: var(--surface-disabled); color: var(--text-disabled); cursor: not-allowed; }
.t3-dropdown[data-style="outlined"][data-multiple="true"][data-state="disabled"] .t3-dropdown__field { --dropdown-stroke: var(--border-disabled); }
.t3-dropdown__trigger { position: absolute; inset: 0; width: 100%; padding: 0; border: 0; border-radius: inherit; background: transparent; cursor: inherit; }
.t3-dropdown__trigger:focus-visible { outline: 2px solid var(--border-theme); outline-offset: 2px; }
.t3-dropdown__value { flex: 1; min-width: 0; padding: 2px 0; pointer-events: none; }
.t3-dropdown__single { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.t3-dropdown__value[data-placeholder="true"] { color: var(--text-tertiary); }
.t3-dropdown[data-state="focus"] .t3-dropdown__value[data-placeholder="true"] { color: var(--text-primary); }
.t3-dropdown[data-state="disabled"] .t3-dropdown__value { color: var(--text-disabled); }
.t3-dropdown__arrow { display: block; flex: none; pointer-events: none; }
.t3-dropdown[data-multiple="true"][data-has-value="true"] .t3-dropdown__field { padding-left: 4px; }
.t3-dropdown__chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.t3-dropdown__chip { position: relative; display: inline-flex; align-items: center; gap: 8px; min-height: 26px; max-width: 100%; padding: 4px 8px 4px 16px; border-radius: 8px; box-shadow: inset 0 0 0 1px var(--border-secondary); font-weight: 500; pointer-events: auto; }
.t3-dropdown__chip-text { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.t3-dropdown__remove { display: grid; place-items: center; padding: 0; border: 0; background: transparent; width: 18px; height: 18px; flex: none; cursor: pointer; }
.t3-dropdown__remove img { display: block; }
.t3-dropdown[data-state="disabled"] .t3-dropdown__chip { box-shadow: inset 0 0 0 1px var(--border-disabled); }
.t3-dropdown[data-state="disabled"] .t3-dropdown__remove { cursor: not-allowed; }
.t3-dropdown__menu { position: absolute; z-index: 10; top: calc(100% + 7px); left: 0; width: 100%; max-height: 312px; padding: 4px 0; border-radius: 8px; background: var(--surface-background); }
.t3-dropdown[data-style="outlined"] .t3-dropdown__menu { top: calc(100% + 16px); }
.t3-dropdown__list { max-height: 304px; overflow-y: auto; overflow-x: hidden; scrollbar-width: none; }
.t3-dropdown__list::-webkit-scrollbar { display: none; }
.t3-dropdown__option { display: block; width: 100%; height: 40px; padding: 0 20px; border: 0; border-radius: 0; background: transparent; color: var(--text-primary); font: inherit; text-align: left; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.t3-dropdown__option:hover, .t3-dropdown__option:focus-visible { background: var(--link-standard); outline: none; }
.t3-dropdown__option[aria-selected="true"] { color: var(--text-theme); }
.t3-dropdown__option:disabled { color: var(--text-disabled); cursor: not-allowed; }
.t3-dropdown__scroller { position: absolute; width: 12px; right: 0; top: 4px; bottom: 4px; touch-action: none; }
.t3-dropdown__scrollbar { position: absolute; top: 0; right: 8px; width: 4px; height: 164px; border-radius: 100px; background: var(--border-disabled); }
.t3-dropdown[data-kind="text"] { width: max-content; }
.t3-dropdown[data-kind="text"] .t3-dropdown__field { min-height: 24px; width: max-content; padding: 0 4px 0 8px; border-radius: 4px; background: transparent; box-shadow: none; color: var(--text-quaternary); font-weight: 500; }
.t3-dropdown[data-kind="text"] .t3-dropdown__value { padding: 0; }
.t3-dropdown[data-kind="text"][data-state="active"] .t3-dropdown__field { color: var(--text-tertiary); }
.t3-dropdown[data-kind="text"][data-state="hover"] .t3-dropdown__field { background: var(--link-standard-hover); color: var(--text-secondary); }
.t3-dropdown[data-kind="text"][data-hierarchy="superior"] .t3-dropdown__field { color: var(--link-theme-filled); }
.t3-dropdown[data-kind="text"][data-hierarchy="superior"][data-state="active"] .t3-dropdown__field { color: var(--text-theme); }
.t3-dropdown[data-kind="text"][data-hierarchy="superior"][data-state="hover"] .t3-dropdown__field { background: transparent; color: var(--link-theme-filled-hover); }
.t3-dropdown[data-kind="text"][data-state="disabled"] .t3-dropdown__field { color: var(--text-disabled); }
.t3-dropdown[data-kind="text"] .t3-dropdown__menu { top: calc(100% + 4px); left: -20px; width: 120px; min-width: 120px; border-radius: 8px; background: var(--surface-popup); box-shadow: 0 4px 24px var(--surface-disabled); }
.t3-dropdown[data-kind="text"] .t3-dropdown__menu::before { content: ""; position: absolute; top: -4px; left: 0; right: 0; height: 4px; }
.t3-dropdown [hidden] { display: none !important; }
```

## 7. 可執行元件參考

下列資產為 Figma 原始 SVG 的 data URI，可與程式一起保存為 `t3-dropdown.js`。

```js
const dropdownAssets={"text-0":{"src":"data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiB2aWV3Qm94PSIwIDAgMjAgMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGlkPSJNYXRlcmlhbFN5bWJvbHMvQXJyb3cva2V5Ym9hcmRfYXJyb3dfZG93biI+CjxwYXRoIGlkPSJWZWN0b3IiIGQ9Ik0xMCAxMi41NDQ4TDUuMjg4NTQgNy44MzMzM0w2LjE2NjY3IDYuOTU1MjFMMTAgMTAuNzg4NUwxMy44MzMzIDYuOTU1MjFMMTQuNzExNSA3LjgzMzMzTDEwIDEyLjU0NDhaIiBmaWxsPSIjNkE3MjgyIi8+CjwvZz4KPC9zdmc+Cg=="},"text-1":{"src":"data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiB2aWV3Qm94PSIwIDAgMjAgMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGlkPSJNYXRlcmlhbFN5bWJvbHMvQXJyb3cva2V5Ym9hcmRfYXJyb3dfZG93biI+CjxwYXRoIGlkPSJWZWN0b3IiIGQ9Ik0xMCAxMi41NDQ4TDUuMjg4NTQgNy44MzMzM0w2LjE2NjY3IDYuOTU1MjFMMTAgMTAuNzg4NUwxMy44MzMzIDYuOTU1MjFMMTQuNzExNSA3LjgzMzMzTDEwIDEyLjU0NDhaIiBmaWxsPSIjOTlBMUFGIi8+CjwvZz4KPC9zdmc+Cg=="},"text-3":{"src":"data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiB2aWV3Qm94PSIwIDAgMjAgMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGlkPSJNYXRlcmlhbFN5bWJvbHMvQXJyb3cva2V5Ym9hcmRfYXJyb3dfZG93biI+CjxwYXRoIGlkPSJWZWN0b3IiIGQ9Ik0xMCAxMi41NDQ4TDUuMjg4NTQgNy44MzMzM0w2LjE2NjY3IDYuOTU1MjFMMTAgMTAuNzg4NUwxMy44MzMzIDYuOTU1MjFMMTQuNzExNSA3LjgzMzMzTDEwIDEyLjU0NDhaIiBmaWxsPSIjNEE1NTY1Ii8+CjwvZz4KPC9zdmc+Cg=="},"down-disabled":{"src":"data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiB2aWV3Qm94PSIwIDAgMjAgMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGlkPSJNYXRlcmlhbFN5bWJvbHMvQXJyb3cva2V5Ym9hcmRfYXJyb3dfZG93biI+CjxwYXRoIGlkPSJWZWN0b3IiIGQ9Ik0xMCAxMi41NDQ4TDUuMjg4NTQgNy44MzMzM0w2LjE2NjY3IDYuOTU1MjFMMTAgMTAuNzg4NUwxMy44MzMzIDYuOTU1MjFMMTQuNzExNSA3LjgzMzMzTDEwIDEyLjU0NDhaIiBmaWxsPSIjNEE1NTY1Ii8+CjwvZz4KPC9zdmc+Cg=="},"text-6":{"src":"data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiB2aWV3Qm94PSIwIDAgMjAgMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGlkPSJNYXRlcmlhbFN5bWJvbHMvQXJyb3cva2V5Ym9hcmRfYXJyb3dfZG93biI+CjxwYXRoIGlkPSJWZWN0b3IiIGQ9Ik0xMCAxMi41NDQ4TDUuMjg4NTQgNy44MzMzM0w2LjE2NjY3IDYuOTU1MjFMMTAgMTAuNzg4NUwxMy44MzMzIDYuOTU1MjFMMTQuNzExNSA3LjgzMzMzTDEwIDEyLjU0NDhaIiBmaWxsPSIjNTFBMkZGIi8+CjwvZz4KPC9zdmc+Cg=="},"up":{"src":"data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiB2aWV3Qm94PSIwIDAgMjAgMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGlkPSJNYXRlcmlhbFN5bWJvbHMvQXJyb3cva2V5Ym9hcmRfYXJyb3dfdXAiPgo8cGF0aCBpZD0iVmVjdG9yIiBkPSJNMTAgOC43MTE0Nkw2LjE2NjY3IDEyLjU0NDhMNS4yODg1NCAxMS42NjY3TDEwIDYuOTU1MjFMMTQuNzExNSAxMS42NjY3TDEzLjgzMzMgMTIuNTQ0OEwxMCA4LjcxMTQ2WiIgZmlsbD0iIzk5QTFBRiIvPgo8L2c+Cjwvc3ZnPgo="},"text-2":{"src":"data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiB2aWV3Qm94PSIwIDAgMjAgMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGlkPSJNYXRlcmlhbFN5bWJvbHMvQXJyb3cva2V5Ym9hcmRfYXJyb3dfZG93biI+CjxwYXRoIGlkPSJWZWN0b3IiIGQ9Ik0xMCAxMi41NDQ4TDUuMjg4NTQgNy44MzMzM0w2LjE2NjY3IDYuOTU1MjFMMTAgMTAuNzg4NUwxMy44MzMzIDYuOTU1MjFMMTQuNzExNSA3LjgzMzMzTDEwIDEyLjU0NDhaIiBmaWxsPSIjOTlBMUFGIi8+CjwvZz4KPC9zdmc+Cg=="},"down":{"src":"data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiB2aWV3Qm94PSIwIDAgMjAgMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGlkPSJNYXRlcmlhbFN5bWJvbHMvQXJyb3cva2V5Ym9hcmRfYXJyb3dfZG93biI+CjxwYXRoIGlkPSJWZWN0b3IiIGQ9Ik0xMCAxMi41NDQ4TDUuMjg4NTQgNy44MzMzM0w2LjE2NjY3IDYuOTU1MjFMMTAgMTAuNzg4NUwxMy44MzMzIDYuOTU1MjFMMTQuNzExNSA3LjgzMzMzTDEwIDEyLjU0NDhaIiBmaWxsPSIjOTlBMUFGIi8+CjwvZz4KPC9zdmc+Cg=="},"remove":{"src":"data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiB2aWV3Qm94PSIwIDAgMTggMTgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGlkPSJSZW1vdmUiPgo8cGF0aCBpZD0iVmVjdG9yIiBkPSJNOSA5Ljc5MDMxTDUuMTk1MjUgMTMuNTk1M0M1LjA5MTM3IDEzLjY5OSA0Ljk2MDgxIDEzLjc1MjEgNC44MDM1NiAxMy43NTQ2QzQuNjQ2NDQgMTMuNzU3IDQuNTEzNSAxMy43MDM5IDQuNDA0NzUgMTMuNTk1M0M0LjI5NjEyIDEzLjQ4NjUgNC4yNDE4MSAxMy4zNTQ4IDQuMjQxODEgMTMuMkM0LjI0MTgxIDEzLjA0NTMgNC4yOTYxMiAxMi45MTM1IDQuNDA0NzUgMTIuODA0OEw4LjIwOTY5IDlMNC40MDQ3NSA1LjE5NTI1QzQuMzAxIDUuMDkxMzggNC4yNDc4NyA0Ljk2MDgxIDQuMjQ1MzcgNC44MDM1NkM0LjI0MyA0LjY0NjQ0IDQuMjk2MTIgNC41MTM1IDQuNDA0NzUgNC40MDQ3NUM0LjUxMzUgNC4yOTYxMiA0LjY0NTI1IDQuMjQxODEgNC44IDQuMjQxODFDNC45NTQ3NSA0LjI0MTgxIDUuMDg2NSA0LjI5NjEyIDUuMTk1MjUgNC40MDQ3NUw5IDguMjA5NjlMMTIuODA0OCA0LjQwNDc1QzEyLjkwODYgNC4zMDEgMTMuMDM5MiA0LjI0Nzg3IDEzLjE5NjQgNC4yNDUzN0MxMy4zNTM2IDQuMjQzIDEzLjQ4NjUgNC4yOTYxMiAxMy41OTUzIDQuNDA0NzVDMTMuNzAzOSA0LjUxMzUgMTMuNzU4MiA0LjY0NTI1IDEzLjc1ODIgNC44QzEzLjc1ODIgNC45NTQ3NSAxMy43MDM5IDUuMDg2NSAxMy41OTUzIDUuMTk1MjVMOS43OTAzMSA5TDEzLjU5NTMgMTIuODA0OEMxMy42OTkgMTIuOTA4NiAxMy43NTIxIDEzLjAzOTIgMTMuNzU0NiAxMy4xOTY0QzEzLjc1NyAxMy4zNTM2IDEzLjcwMzkgMTMuNDg2NSAxMy41OTUzIDEzLjU5NTNDMTMuNDg2NSAxMy43MDM5IDEzLjM1NDggMTMuNzU4MiAxMy4yIDEzLjc1ODJDMTMuMDQ1MyAxMy43NTgyIDEyLjkxMzUgMTMuNzAzOSAxMi44MDQ4IDEzLjU5NTNMOSA5Ljc5MDMxWiIgZmlsbD0iI0QxRDVEQyIvPgo8L2c+Cjwvc3ZnPgo="},"text-4":{"src":"data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiB2aWV3Qm94PSIwIDAgMjAgMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGlkPSJNYXRlcmlhbFN5bWJvbHMvQXJyb3cva2V5Ym9hcmRfYXJyb3dfZG93biI+CjxwYXRoIGlkPSJWZWN0b3IiIGQ9Ik0xMCAxMi41NDQ4TDUuMjg4NTQgNy44MzMzM0w2LjE2NjY3IDYuOTU1MjFMMTAgMTAuNzg4NUwxMy44MzMzIDYuOTU1MjFMMTQuNzExNSA3LjgzMzMzTDEwIDEyLjU0NDhaIiBmaWxsPSIjMkI3RkZGIi8+CjwvZz4KPC9zdmc+Cg=="},"text-7":{"src":"data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiB2aWV3Qm94PSIwIDAgMjAgMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGlkPSJNYXRlcmlhbFN5bWJvbHMvQXJyb3cva2V5Ym9hcmRfYXJyb3dfZG93biI+CjxwYXRoIGlkPSJWZWN0b3IiIGQ9Ik0xMCAxMi41NDQ4TDUuMjg4NTQgNy44MzMzM0w2LjE2NjY3IDYuOTU1MjFMMTAgMTAuNzg4NUwxMy44MzMzIDYuOTU1MjFMMTQuNzExNSA3LjgzMzMzTDEwIDEyLjU0NDhaIiBmaWxsPSIjNEE1NTY1Ii8+CjwvZz4KPC9zdmc+Cg=="},"text-5":{"src":"data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiB2aWV3Qm94PSIwIDAgMjAgMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGlkPSJNYXRlcmlhbFN5bWJvbHMvQXJyb3cva2V5Ym9hcmRfYXJyb3dfZG93biI+CjxwYXRoIGlkPSJWZWN0b3IiIGQ9Ik0xMCAxMi41NDQ4TDUuMjg4NTQgNy44MzMzM0w2LjE2NjY3IDYuOTU1MjFMMTAgMTAuNzg4NUwxMy44MzMzIDYuOTU1MjFMMTQuNzExNSA3LjgzMzMzTDEwIDEyLjU0NDhaIiBmaWxsPSIjNTFBMkZGIi8+CjwvZz4KPC9zdmc+Cg=="}};
let dropdownSequence=0;
function createDropdown(config={}) {
  const settings={
    style:'tonal-theme',multiple:false,textOnly:false,hierarchy:'subordinate',
    label:'標題',labelVisible:true,required:true,help:'',placeholder:'請選擇',
    options:[],value:[],disabled:false,onChange:()=>{},...config
  };
  const options=settings.options.map(option=>({...option}));
  if(new Set(options.map(option=>option.value)).size!==options.length) throw new Error('Dropdown option values must be unique.');
  const prefix='t3-dropdown-'+(++dropdownSequence);
  let selected=normalizeValue(settings.value);
  let opened=false;
  const root=document.createElement('div');
  root.className='t3-dropdown';
  root.dataset.style=settings.style;
  root.dataset.multiple=String(settings.multiple);
  root.dataset.kind=settings.textOnly?'text':'field';
  root.dataset.hierarchy=settings.hierarchy;
  const label=document.createElement('label');
  label.className='t3-dropdown__label';label.htmlFor=prefix+'-trigger';
  const star=document.createElement('span');
  star.className='t3-dropdown__required';star.textContent='*';star.setAttribute('aria-hidden','true');
  star.hidden=!settings.required;
  const title=document.createElement('span');title.textContent=settings.label;
  label.append(star,title);label.hidden=settings.textOnly||!settings.labelVisible;
  const field=document.createElement('div');field.className='t3-dropdown__field';
  const trigger=document.createElement('button');
  trigger.className='t3-dropdown__trigger';trigger.type='button';trigger.id=prefix+'-trigger';
  trigger.setAttribute('aria-label',settings.label);
  trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-controls',prefix+'-list');
  const value=document.createElement('div');value.className='t3-dropdown__value';
  const arrow=document.createElement('img');arrow.className='t3-dropdown__arrow';arrow.alt='';
  arrow.width=20;arrow.height=20;
  const menu=document.createElement('div');menu.className='t3-dropdown__menu';
  const list=document.createElement('div');list.className='t3-dropdown__list';list.id=prefix+'-list';
  list.setAttribute('role','listbox');list.setAttribute('aria-label',settings.label);
  if(settings.multiple) list.setAttribute('aria-multiselectable','true');
  const track=document.createElement('div');track.className='t3-dropdown__scroller';track.setAttribute('aria-hidden','true');
  const thumb=document.createElement('div');thumb.className='t3-dropdown__scrollbar';track.append(thumb);
  menu.append(list,track);
  const help=document.createElement('p');help.className='t3-dropdown__help';help.textContent=settings.help;
  help.id=prefix+'-help';help.hidden=!settings.help||settings.textOnly;
  if(settings.help&&!settings.textOnly) trigger.setAttribute('aria-describedby',help.id);
  field.append(trigger,value,arrow,menu);root.append(label,field,help);
  function normalizeValue(input) {
    const entries=Array.isArray(input)?input:input==null?[]:[input];
    const valid=[...new Set(entries)].filter(v=>options.some(option=>option.value===v));
    return settings.multiple?valid:valid.slice(0,1);
  }
  function getValue() { return settings.multiple?selected.slice():(selected[0]??null); }
  function notify() { settings.onChange(getValue()); }
  function choose(option) {
    if(settings.disabled||option.disabled||settings.previewState) return;
    selected=settings.multiple
      ? selected.includes(option.value)?selected.filter(v=>v!==option.value):[...selected,option.value]
      : [option.value];
    if(!settings.multiple) opened=false;
    const index=options.indexOf(option);
    render();
    if(opened) list.children[index]?.focus();
    else trigger.focus();
    notify();
  }
  function syncScroll() {
    const overflow=list.scrollHeight-list.clientHeight;
    const travel=Math.max(0,track.clientHeight-thumb.offsetHeight);
    track.hidden=overflow<=0;
    thumb.style.top=(overflow>0?list.scrollTop/overflow*travel:0)+'px';
  }
  function render() {
    const state=settings.previewState||(settings.disabled?'disabled':opened?(settings.textOnly?'hover':'focus'):selected.length?'active':'default');
    root.dataset.state=state;root.dataset.hasValue=String(selected.length>0);
    trigger.disabled=settings.disabled||state==='disabled';
    trigger.setAttribute('aria-expanded',String(opened));
    const arrowName=settings.textOnly?'text-'+((settings.hierarchy==='superior'?4:0)+['default','hover','active','disabled'].indexOf(state)):
      trigger.disabled?'down-disabled':opened?'up':'down';
    arrow.src=dropdownAssets[arrowName].src;
    value.dataset.placeholder=String(!selected.length&&!settings.textOnly);
    value.replaceChildren();
    if(settings.textOnly||!settings.multiple||!selected.length) {
      const text=document.createElement('span');text.className='t3-dropdown__single';
      text.textContent=settings.textOnly?(selected.length?options.find(o=>o.value===selected[0]).label:settings.label):
        selected.length?options.find(o=>o.value===selected[0]).label:settings.placeholder;
      value.append(text);
    } else {
      const chips=document.createElement('div');chips.className='t3-dropdown__chips';
      for(const key of selected) {
        const option=options.find(o=>o.value===key);
        const chip=document.createElement('span');chip.className='t3-dropdown__chip';
        const text=document.createElement('span');text.className='t3-dropdown__chip-text';text.textContent=option.label;
        const remove=document.createElement('button');remove.type='button';remove.className='t3-dropdown__remove';
        remove.disabled=trigger.disabled;remove.setAttribute('aria-label','移除 '+option.label);
        const image=document.createElement('img');image.src=dropdownAssets.remove.src;image.alt='';image.width=18;image.height=18;
        remove.append(image);remove.addEventListener('click',event=>{
          event.stopPropagation();if(settings.disabled||settings.previewState)return;
          selected=selected.filter(v=>v!==key);render();trigger.focus();notify();
        });
        chip.append(text,remove);chips.append(chip);
      }
      value.append(chips);
    }
    const visible=opened||settings.previewState===(settings.textOnly?'hover':'focus');
    menu.hidden=!visible;
    list.replaceChildren();
    for(const option of options) {
      const row=document.createElement('button');row.type='button';row.className='t3-dropdown__option';
      row.setAttribute('role','option');row.setAttribute('aria-selected',String(selected.includes(option.value)));
      row.disabled=Boolean(option.disabled);row.textContent=option.label;row.tabIndex=-1;
      row.addEventListener('click',()=>choose(option));list.append(row);
    }
    if(visible) requestAnimationFrame(syncScroll);
  }
  function setOpen(next,focusOption=false) {
    if(settings.disabled||settings.previewState)return;
    opened=next;render();
    if(opened&&focusOption) {
      const rows=[...list.children].filter(row=>!row.disabled);
      (rows.find(row=>row.getAttribute('aria-selected')==='true')||rows[0])?.focus();
    }
  }
  trigger.addEventListener('click',()=>setOpen(!opened,true));
  trigger.addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true,true);}
  });
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&opened){event.preventDefault();setOpen(false);trigger.focus();}
    if(event.target.parentElement!==list)return;
    const rows=[...list.children].filter(row=>!row.disabled);
    const index=rows.indexOf(event.target);
    const next=event.key==='ArrowDown'?Math.min(rows.length-1,index+1):
      event.key==='ArrowUp'?Math.max(0,index-1):
      event.key==='Home'?0:event.key==='End'?rows.length-1:null;
    if(next!==null){event.preventDefault();rows[next]?.focus();}
  });
  root.addEventListener('focusout',()=>{
    queueMicrotask(()=>{
      if(opened&&!root.contains(document.activeElement))setOpen(false);
    });
  });
  if(settings.textOnly) {
    root.addEventListener('pointerenter',()=>setOpen(true));
    root.addEventListener('pointerleave',()=>{if(!root.contains(document.activeElement))setOpen(false);});
  }
  const outside=event=>{if(opened&&!event.composedPath().includes(root))setOpen(false);};
  if(!settings.previewState)document.addEventListener('click',outside);
  list.addEventListener('scroll',syncScroll,{passive:true});
  track.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    event.preventDefault();
    const travel=track.clientHeight-thumb.offsetHeight;
    if(travel<=0)return;
    const offset=event.target===thumb?event.clientY-thumb.getBoundingClientRect().top:thumb.offsetHeight/2;
    const move=pointer=>{
      const top=Math.max(0,Math.min(travel,pointer.clientY-track.getBoundingClientRect().top-offset));
      list.scrollTop=top/travel*(list.scrollHeight-list.clientHeight);syncScroll();
    };
    const stop=()=>{
      track.removeEventListener('pointermove',move);track.removeEventListener('pointerup',stop);track.removeEventListener('pointercancel',stop);
    };
    track.setPointerCapture(event.pointerId);
    track.addEventListener('pointermove',move);track.addEventListener('pointerup',stop);track.addEventListener('pointercancel',stop);move(event);
  });
  render();
  return {
    element:root,getValue,
    setValue(input){selected=normalizeValue(input);render();},
    setDisabled(disabled){settings.disabled=Boolean(disabled);if(settings.disabled)opened=false;render();},
    destroy(){document.removeEventListener('click',outside);root.remove();}
  };
}

window.T3Dropdown = { create: createDropdown };
```

使用範例

```js
const control = T3Dropdown.create({
  options: [{ value: "a", label: "Item1" }, { value: "b", label: "Item2" }],
  multiple: true,
  onChange(value) { console.log(value); }
});
document.querySelector("#dropdown-host").append(control.element);
```
