# T3 UI Kit｜Checkbox 工程開發文件

[Figma Checkbox Component Set](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3330) · [Figma 樣式與用法](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=240-23024) · [T3 Design Tokens](https://chatgpt.com/library?file_id=libfile_202bb92aeecc8191bf26b85338556396&account_id=personal)

## 1. 元件介面

母檔共 **42 個 Variant**。每種 Size 含 Basic 的 12 個組合，以及 Error 的 9 個組合。兩種 Size 的色彩一致。Figma 未定義 Error／Disabled。當錯誤與停用同時存在時，本文件採用同 Size、同 Select 的 Basic／Disabled 外觀，錯誤語意仍由頁面依表單狀態決定。

| 參數／事件 | 預設與可用值 | 工程接法 |
| --- | --- | --- |
| `id` | 使用外部 label 時必填且唯一 | 原生 input 的 `id`，與 label 的 `for` 相同。 |
| `label` | 必填可及名稱 | 有可見文字時用 `<label for>`，只有圖示時用 `aria-label`。 |
| `size` | `medium`、`small`。預設 `medium`。 | 外層 `data-size`。 |
| `variant` | `basic`、`error`。預設 `basic`。 | 外層 `data-style`，停用時統一輸出 `basic`。選用 `error` 時設 `aria-invalid="true"`，有錯誤訊息時以 `aria-describedby` 指向其 ID。 |
| `select` | `unchecked`、`checked`、`mixed`。預設 `unchecked`。 | 分別對應 Figma `Uncheck`、`Check`、`Indeterminate`。同步外層 `data-select` 及 input 的 `checked`、`indeterminate` DOM 屬性。 |
| `disabled` | 預設 `false` | 原生 input 的 `disabled`。 |
| `name`／`value` | 隨表單需求提供 | 原生表單屬性。 `mixed` 的 `checked` 為 false，表頭全選可省略 `name`。 |
| `onCheckedChange` | 回傳布林值 | 監聽原生 `change` 一次。由畫面更新值並重算表頭是否為 `mixed`。 |

## 2. 尺寸與圖層

| Size | 操作區（固定） | 內框 | 內框圓角 | Check 圖示框 | Indeterminate 方塊 |
| --- | --- | --- | --- | --- | --- |
| Medium | 24 × 24px | 18 × 18px | 4px | 24 × 24px | 12 × 12px，圓角 2px |
| Small | 24 × 24px | 14 × 14px | 2px | 20 × 20px | 10 × 10px，圓角 2px |

- 內框與符號置中。Check 使用 `MaterialSymbols/UI-Action/check_small`，母檔圖示為 `Outlined`、Weight `300`。Indeterminate 使用填色方塊。
- Hover／Pressed 的圓形底色與外描邊使用同一變數。Medium 外描邊為 6px，色環為 36 × 36px。Small 外描邊為 2px，色環為 28 × 28px。參考 CSS 用單層色環實作，兩種尺寸的操作區均為 24 × 24px。
- Uncheck 的可見內描邊為 1.2px，Basic／Check／Disabled 為 1px。狀態表中的其他內描邊無可見色彩。
- 母檔 Basic usage 的「Dark Mode」標籤文字使用 `Body/Body S Blod`（`.text-body-s-bold`），標示色為 `Colors/Indigo/500`（`var(--color-indigo-500)`）。此色屬於該用法示例。標籤字色、間距與容器由採用畫面配置。

## 3. 互動規則

**Disabled → Pressed → Hover → Default** 控制外觀。三種 Select 與互動狀態獨立。滑入僅在支援 hover 的主要輸入裝置套用，鍵盤 Tab 聚焦時另外顯示 `:focus-visible`。按 Space 或點擊操作區／可見標籤走原生 input 啟用。從 `mixed` 啟用時，因 `checked=false`，第一次啟用送出 `true`。Disabled 不送出變更事件。

外部資料變動時同步 `input.indeterminate`。若畫面使用表頭全選，當可選列全部勾選才顯示 `checked`，部分勾選為 `mixed`，零筆可選或零筆已選為 `unchecked`。表頭操作只更新畫面傳入的選取範圍。若表單使用原生 reset，呼叫端在 reset 後同步元件值與外觀。

## 4. 狀態色矩陣

每格依序為 **外部色環／內框填色／內描邊／符號色**。— 表示無可見色彩。M、S 分別連到母檔的 Medium、Small Variant。

### Basic

| Select | Default | Hover | Pressed | Disabled |
| --- | --- | --- | --- | --- |
| Uncheck | —／—／`border/primary`／— [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3316) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3304) | `link/tonal-hover`／—／`link/theme-filled-hover`／— [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3329) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3300) | `link/tonal-pressed`／—／`link/theme-filled`／— [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3328) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3299) | —／`surface/disabled`／`border/disabled`／— [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3326) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3327) |
| Check | —／`link/theme-filled`／—／`surface/primary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3321) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3296) | `link/tonal-hover`／`link/theme-filled-hover`／—／`surface/primary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3317) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3313) | `link/tonal-pressed`／`link/theme-filled`／—／`surface/primary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3303) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3295) | —／`surface/disabled`／`border/disabled`／`border/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3320) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3294) |
| Indeterminate | —／`surface/primary`／—／`link/theme-filled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3312) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3290) | `link/tonal-hover`／`surface/primary`／—／`link/theme-filled-hover` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3309) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3289) | `link/tonal-pressed`／`surface/primary`／—／`link/theme-filled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3307) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3311) | —／`White/50%`／—／`border/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3310) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3302) |

### Error

| Select | Default | Hover | Pressed | Disabled |
| --- | --- | --- | --- | --- |
| Uncheck | —／—／`status/error`／— [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3323) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3298) | `link/danger-tonal-hover`／—／`status/error-emphasis`／— [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3306) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3325) | `link/danger-tonal-pressed`／—／`status/error`／— [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3318) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3297) | 母檔未定義 |
| Check | —／`status/error`／—／`surface/primary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3315) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3293) | `link/danger-tonal-hover`／`status/error-emphasis`／—／`surface/primary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3322) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3292) | `link/danger-tonal-pressed`／`status/error`／—／`surface/primary` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3314) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3291) | 母檔未定義 |
| Indeterminate | —／`surface/primary`／—／`status/error` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3301) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3308) | `link/danger-tonal-hover`／`surface/primary`／—／`status/error-emphasis` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3305) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3288) | `link/danger-tonal-pressed`／`surface/primary`／—／`status/error` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3324) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=92-3319) | 母檔未定義 |

### Figma Variable Name 與 CSS

| Figma Variable Name | CSS |
| --- | --- |
| `surface/primary` | `var(--surface-primary)` |
| `surface/disabled` | `var(--surface-disabled)` |
| `border/primary` | `var(--border-primary)` |
| `border/disabled` | `var(--border-disabled)` |
| `link/theme-filled` | `var(--link-theme-filled)` |
| `link/theme-filled-hover` | `var(--link-theme-filled-hover)` |
| `link/tonal-hover` | `var(--link-tonal-hover)` |
| `link/tonal-pressed` | `var(--link-tonal-pressed)` |
| `link/danger-tonal-hover` | `var(--link-danger-tonal-hover)` |
| `link/danger-tonal-pressed` | `var(--link-danger-tonal-pressed)` |
| `status/error` | `var(--status-error)` |
| `status/error-emphasis` | `var(--status-error-emphasis)` |
| `White/50%` | `var(--color-white-50)` |

## 5. 參考實作

先載入 T3 Design Tokens。以下用原生 HTML、CSS、JavaScript。框架元件可輸出同一結構並由 props 同步。

```html
<span class="t3-checkbox" data-size="medium" data-style="basic" data-select="unchecked">
  <input id="publish-checkbox" class="t3-checkbox__input" type="checkbox" name="publish" value="yes">
  <span class="t3-checkbox__box" aria-hidden="true">
    <svg class="t3-checkbox__tick" viewBox="0 0 24 24" focusable="false" fill="currentColor">
      <path transform="translate(6.35575 7.35575)" d="M3.64425 8.6885 0 5.04425 1.04425 4 3.64425 6.6 10.24425 0 11.2885 1.04425Z"/>
    </svg>
    <span class="t3-checkbox__mixed"></span>
  </span>
</span>
<label for="publish-checkbox" class="text-body-s-bold">發布班表</label>
```

```js
export function renderCheckbox(root, { select = "unchecked", variant = "basic", disabled = false } = {}) {
  const input = root.querySelector(".t3-checkbox__input");
  root.dataset.select = select;
  root.dataset.style = disabled ? "basic" : variant;
  input.checked = select === "checked";
  input.indeterminate = select === "mixed";
  input.disabled = disabled;
  if (variant === "error") input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

// 在應用中以頁面狀態決定 select，再回呼 renderCheckbox。
export function bindCheckbox(root, onCheckedChange) {
  const input = root.querySelector(".t3-checkbox__input");
  const handleChange = () => onCheckedChange(input.checked);
  input.addEventListener("change", handleChange);
  return () => input.removeEventListener("change", handleChange);
}
```

`data-preview-state` 用於測試頁固定展示四種外觀。正式元件省略此屬性，外觀跟隨 input 的原生狀態。

```css
.t3-checkbox {
  --cb-box: 18px;
  --cb-radius: 4px;
  --cb-icon: 24px;
  --cb-mixed: 12px;
  --cb-halo-outset: 6px;
  position: relative;
  isolation: isolate;
  display: inline-grid;
  place-items: center;
  flex: none;
  inline-size: 24px;
  block-size: 24px;
  vertical-align: middle;
}
.t3-checkbox[data-size="small"] {
  --cb-box: 14px;
  --cb-radius: 2px;
  --cb-icon: 20px;
  --cb-mixed: 10px;
  --cb-halo-outset: 2px;
}
.t3-checkbox::before {
  position: absolute;
  inset: calc(-1 * var(--cb-halo-outset));
  z-index: -1;
  border-radius: 50%;
  background-color: var(--cb-halo, transparent);
  pointer-events: none;
  content: "";
}
.t3-checkbox__input {
  position: absolute;
  inset: 0;
  z-index: 1;
  inline-size: 100%;
  block-size: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.t3-checkbox__input:disabled { cursor: default; }
.t3-checkbox__box {
  position: relative;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  inline-size: var(--cb-box);
  block-size: var(--cb-box);
  border-radius: var(--cb-radius);
  background-color: var(--cb-fill, transparent);
  box-shadow: inset 0 0 0 var(--cb-border-width, 0px) var(--cb-border, transparent);
  color: var(--cb-mark, transparent);
  pointer-events: none;
}
.t3-checkbox__tick, .t3-checkbox__mixed { display: none; }
.t3-checkbox[data-select="checked"] .t3-checkbox__tick {
  display: block;
  position: absolute;
  inset: 50% auto auto 50%;
  translate: -50% -50%;
  inline-size: var(--cb-icon);
  block-size: var(--cb-icon);
}
.t3-checkbox[data-select="mixed"] .t3-checkbox__mixed {
  display: block;
  inline-size: var(--cb-mixed);
  block-size: var(--cb-mixed);
  border-radius: 2px;
  background-color: currentColor;
}
.t3-checkbox__input:focus-visible + .t3-checkbox__box {
  outline: 2px solid var(--border-theme); /* border/theme，工程焦點規則 */
  outline-offset: 2px;
}
@media (forced-colors: active) {
  .t3-checkbox__box {
    box-shadow: none;
    border: 1px solid ButtonText;
    background: Canvas;
    color: ButtonText;
  }
  .t3-checkbox__input:disabled + .t3-checkbox__box { border-color: GrayText; color: GrayText; }
  .t3-checkbox__mixed { forced-color-adjust: none; background: ButtonText; }
  .t3-checkbox__input:disabled + .t3-checkbox__box .t3-checkbox__mixed { background: GrayText; }
}

.t3-checkbox[data-style="basic"][data-select="unchecked"]:where(:not([data-preview-state]),[data-preview-state="default"]) {
  --cb-halo: transparent;
  --cb-fill: transparent;
  --cb-border: var(--border-primary);
  --cb-mark: transparent;
  --cb-border-width: 1.2px;
}
.t3-checkbox[data-style="basic"][data-select="checked"]:where(:not([data-preview-state]),[data-preview-state="default"]) {
  --cb-halo: transparent;
  --cb-fill: var(--link-theme-filled);
  --cb-border: transparent;
  --cb-mark: var(--surface-primary);
  --cb-border-width: 0px;
}
.t3-checkbox[data-style="basic"][data-select="mixed"]:where(:not([data-preview-state]),[data-preview-state="default"]) {
  --cb-halo: transparent;
  --cb-fill: var(--surface-primary);
  --cb-border: transparent;
  --cb-mark: var(--link-theme-filled);
  --cb-border-width: 0px;
}
.t3-checkbox[data-style="error"][data-select="unchecked"]:where(:not([data-preview-state]),[data-preview-state="default"]) {
  --cb-halo: transparent;
  --cb-fill: transparent;
  --cb-border: var(--status-error);
  --cb-mark: transparent;
  --cb-border-width: 1.2px;
}
.t3-checkbox[data-style="error"][data-select="checked"]:where(:not([data-preview-state]),[data-preview-state="default"]) {
  --cb-halo: transparent;
  --cb-fill: var(--status-error);
  --cb-border: transparent;
  --cb-mark: var(--surface-primary);
  --cb-border-width: 0px;
}
.t3-checkbox[data-style="error"][data-select="mixed"]:where(:not([data-preview-state]),[data-preview-state="default"]) {
  --cb-halo: transparent;
  --cb-fill: var(--surface-primary);
  --cb-border: transparent;
  --cb-mark: var(--status-error);
  --cb-border-width: 0px;
}

.t3-checkbox[data-style="basic"][data-select="unchecked"]:where([data-preview-state="hover"]) {
  --cb-halo: var(--link-tonal-hover);
  --cb-fill: transparent;
  --cb-border: var(--link-theme-filled-hover);
  --cb-mark: transparent;
  --cb-border-width: 1.2px;
}
.t3-checkbox[data-style="basic"][data-select="checked"]:where([data-preview-state="hover"]) {
  --cb-halo: var(--link-tonal-hover);
  --cb-fill: var(--link-theme-filled-hover);
  --cb-border: transparent;
  --cb-mark: var(--surface-primary);
  --cb-border-width: 0px;
}
.t3-checkbox[data-style="basic"][data-select="mixed"]:where([data-preview-state="hover"]) {
  --cb-halo: var(--link-tonal-hover);
  --cb-fill: var(--surface-primary);
  --cb-border: transparent;
  --cb-mark: var(--link-theme-filled-hover);
  --cb-border-width: 0px;
}
.t3-checkbox[data-style="error"][data-select="unchecked"]:where([data-preview-state="hover"]) {
  --cb-halo: var(--link-danger-tonal-hover);
  --cb-fill: transparent;
  --cb-border: var(--status-error-emphasis);
  --cb-mark: transparent;
  --cb-border-width: 1.2px;
}
.t3-checkbox[data-style="error"][data-select="checked"]:where([data-preview-state="hover"]) {
  --cb-halo: var(--link-danger-tonal-hover);
  --cb-fill: var(--status-error-emphasis);
  --cb-border: transparent;
  --cb-mark: var(--surface-primary);
  --cb-border-width: 0px;
}
.t3-checkbox[data-style="error"][data-select="mixed"]:where([data-preview-state="hover"]) {
  --cb-halo: var(--link-danger-tonal-hover);
  --cb-fill: var(--surface-primary);
  --cb-border: transparent;
  --cb-mark: var(--status-error-emphasis);
  --cb-border-width: 0px;
}
@media (hover: hover) {
  .t3-checkbox[data-style="basic"][data-select="unchecked"]:where(:not([data-preview-state]):has(input:hover:not(:disabled))) {
    --cb-halo: var(--link-tonal-hover);
    --cb-fill: transparent;
    --cb-border: var(--link-theme-filled-hover);
    --cb-mark: transparent;
    --cb-border-width: 1.2px;
  }
  .t3-checkbox[data-style="basic"][data-select="checked"]:where(:not([data-preview-state]):has(input:hover:not(:disabled))) {
    --cb-halo: var(--link-tonal-hover);
    --cb-fill: var(--link-theme-filled-hover);
    --cb-border: transparent;
    --cb-mark: var(--surface-primary);
    --cb-border-width: 0px;
  }
  .t3-checkbox[data-style="basic"][data-select="mixed"]:where(:not([data-preview-state]):has(input:hover:not(:disabled))) {
    --cb-halo: var(--link-tonal-hover);
    --cb-fill: var(--surface-primary);
    --cb-border: transparent;
    --cb-mark: var(--link-theme-filled-hover);
    --cb-border-width: 0px;
  }
  .t3-checkbox[data-style="error"][data-select="unchecked"]:where(:not([data-preview-state]):has(input:hover:not(:disabled))) {
    --cb-halo: var(--link-danger-tonal-hover);
    --cb-fill: transparent;
    --cb-border: var(--status-error-emphasis);
    --cb-mark: transparent;
    --cb-border-width: 1.2px;
  }
  .t3-checkbox[data-style="error"][data-select="checked"]:where(:not([data-preview-state]):has(input:hover:not(:disabled))) {
    --cb-halo: var(--link-danger-tonal-hover);
    --cb-fill: var(--status-error-emphasis);
    --cb-border: transparent;
    --cb-mark: var(--surface-primary);
    --cb-border-width: 0px;
  }
  .t3-checkbox[data-style="error"][data-select="mixed"]:where(:not([data-preview-state]):has(input:hover:not(:disabled))) {
    --cb-halo: var(--link-danger-tonal-hover);
    --cb-fill: var(--surface-primary);
    --cb-border: transparent;
    --cb-mark: var(--status-error-emphasis);
    --cb-border-width: 0px;
  }
}

.t3-checkbox[data-style="basic"][data-select="unchecked"]:where([data-preview-state="pressed"],:not([data-preview-state]):has(input:active:not(:disabled))) {
  --cb-halo: var(--link-tonal-pressed);
  --cb-fill: transparent;
  --cb-border: var(--link-theme-filled);
  --cb-mark: transparent;
  --cb-border-width: 1.2px;
}
.t3-checkbox[data-style="basic"][data-select="checked"]:where([data-preview-state="pressed"],:not([data-preview-state]):has(input:active:not(:disabled))) {
  --cb-halo: var(--link-tonal-pressed);
  --cb-fill: var(--link-theme-filled);
  --cb-border: transparent;
  --cb-mark: var(--surface-primary);
  --cb-border-width: 0px;
}
.t3-checkbox[data-style="basic"][data-select="mixed"]:where([data-preview-state="pressed"],:not([data-preview-state]):has(input:active:not(:disabled))) {
  --cb-halo: var(--link-tonal-pressed);
  --cb-fill: var(--surface-primary);
  --cb-border: transparent;
  --cb-mark: var(--link-theme-filled);
  --cb-border-width: 0px;
}
.t3-checkbox[data-style="error"][data-select="unchecked"]:where([data-preview-state="pressed"],:not([data-preview-state]):has(input:active:not(:disabled))) {
  --cb-halo: var(--link-danger-tonal-pressed);
  --cb-fill: transparent;
  --cb-border: var(--status-error);
  --cb-mark: transparent;
  --cb-border-width: 1.2px;
}
.t3-checkbox[data-style="error"][data-select="checked"]:where([data-preview-state="pressed"],:not([data-preview-state]):has(input:active:not(:disabled))) {
  --cb-halo: var(--link-danger-tonal-pressed);
  --cb-fill: var(--status-error);
  --cb-border: transparent;
  --cb-mark: var(--surface-primary);
  --cb-border-width: 0px;
}
.t3-checkbox[data-style="error"][data-select="mixed"]:where([data-preview-state="pressed"],:not([data-preview-state]):has(input:active:not(:disabled))) {
  --cb-halo: var(--link-danger-tonal-pressed);
  --cb-fill: var(--surface-primary);
  --cb-border: transparent;
  --cb-mark: var(--status-error);
  --cb-border-width: 0px;
}

.t3-checkbox[data-style="basic"][data-select="unchecked"]:where([data-preview-state="disabled"],:not([data-preview-state]):has(input:disabled)) {
  --cb-halo: transparent;
  --cb-fill: var(--surface-disabled);
  --cb-border: var(--border-disabled);
  --cb-mark: transparent;
  --cb-border-width: 1.2px;
}
.t3-checkbox[data-style="basic"][data-select="checked"]:where([data-preview-state="disabled"],:not([data-preview-state]):has(input:disabled)) {
  --cb-halo: transparent;
  --cb-fill: var(--surface-disabled);
  --cb-border: var(--border-disabled);
  --cb-mark: var(--border-disabled);
  --cb-border-width: 1px;
}
.t3-checkbox[data-style="basic"][data-select="mixed"]:where([data-preview-state="disabled"],:not([data-preview-state]):has(input:disabled)) {
  --cb-halo: transparent;
  --cb-fill: var(--color-white-50);
  --cb-border: transparent;
  --cb-mark: var(--border-disabled);
  --cb-border-width: 0px;
}
```

## 6. 驗收

| 操作 | 預期 |
| --- | --- |
| 對照兩種 Size、兩種 Style | 42 個母檔 Variant 的色環、內框色、描邊及符號色與矩陣一致。 |
| 切換 Medium／Small | 操作區維持 24 × 24px，內框、勾選圖示和部分勾選方塊依尺寸表切換。 |
| 比對兩種 Size 的 Hover／Pressed | Small 色環為 28 × 28px，Medium 色環為 36 × 36px。兩種尺寸的操作區皆為 24 × 24px。 |
| 部分勾選後按 Space 或點擊 | 第一次回傳 `true`，回寫成 `checked`。再按一次回傳 `false`。 |
| Error 切到 Disabled | 使用同尺寸、同 Select 的 Basic／Disabled 色彩，操作無回呼。 |
| 用 Tab 聚焦、用可見 label 點擊 | 焦點可見，瀏覽器可讀出名稱與選取狀態。點擊文字與點擊方框各觸發一次變更。 |
| Basic／Indeterminate／Disabled | 內框使用 `White/50%`，內部是 `border/disabled` 的方塊。 |
