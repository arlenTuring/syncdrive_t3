# T3 UI Kit｜Radio Basic 工程開發文件

[Figma 元件集](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6847) · [Figma 樣式與用法](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=240-23070) · [T3 Design Tokens](https://chatgpt.com/library?file_id=libfile_202bb92aeecc8191bf26b85338556396&account_id=personal)

## 1. 元件介面

本文件對應指定節點的 **Radio Basic**，共 **2 種 Size × 2 種 Select × 4 種 State，16 個 Variant**。同頁另有獨立的 Radio Style Button 元件集。

| 輸入／事件 | 工程接法 |
| --- | --- |
| `label` | 可見標籤放入 `label`，輸入欄位由標籤命名。純圖示用法則設定 `aria-label`。 |
| `size` | `medium` 或 `small`，預設 `medium`，輸出為 `data-size`。 |
| `name`／`value` | 同一組共用 `name` 與表單擁有者，各選項 `value` 唯一。不同組使用不同名稱。群組用 `fieldset`、`legend` 命名。 |
| `checked` | 對應 Figma Select 的 On／Off。受控元件由群組值決定，初始選取由頁面指定。原生 HTML 的 `checked` attribute 用於初始值，執行時由 `input.checked` 反映。 |
| `disabled` | 選用原生 `disabled`。已選取的停用項目保留圓點並套用停用色。 |
| `onValueChange(value)` | 群組監聽原生 `change`。新選項勾選時送出其值。 |

```js
const group = document.querySelector("fieldset");
group.addEventListener("change", event => {
  const input = event.target;
  if (input.matches('input[type="radio"]:checked')) {
    onValueChange(input.value);
  }
});
```

## 2. 尺寸與用法

| Size | 操作區 | 內圈直徑 | On／Off 內描邊 | On 圓點直徑 | Hover／Pressed 色環 |
| --- | --- | --- | --- | --- | --- |
| Medium | 24 × 24px | 20px | 1.5px／1.2px | 10px | 32px |
| Small | 24 × 24px | 14px | 1.2px／1.2px | 7px | 24px |

- 圓形內圈與中心點置中。Hover／Pressed 的色環涵蓋 24px 操作區。Medium 另有 4px 外描邊，色環直徑為 32px。Small 的外描邊厚度為 0px，保留直徑 24px 的圓形底色。參考 CSS 使用同色的單層圓形呈現。
- Basic usage 的標籤與 Radio 相隔 4px，容器上下各 4px、左右 0。標籤沿用 `Body/Body S Blod`（`.text-body-s-bold`），文字色 `text/primary`（`--text-primary`）。範例的 67px 寬度隨文字內容決定。

## 3. 狀態與鍵盤

外觀優先序為 **Disabled → Pressed → Hover → Default**，On／Off 跟隨原生 `:checked`。Hover 僅套用在主要輸入裝置支援滑入時。使用 `:focus-visible` 補上鍵盤焦點外框，此為工程可及性處理。

Tab 進入或離開群組。方向鍵在同組項目間移動與選取，Space 選取目前焦點。點擊已選項目維持選取。選取另一項時，由原生 radio 解除上一項。停用項目跳過鍵盤選取，且不送出變更事件。

## 4. 狀態色矩陣

每格依序為 **色環／內描邊／中心點**。— 表示無該可見圖層。M、S 分別連到 Figma 的 Medium、Small Variant。

| Select | Default | Hover | Pressed | Disabled |
| --- | --- | --- | --- | --- |
| On | —／`text/theme`／`text/theme` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6848) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6868) | `link/tonal-hover`／`text/theme`／`text/theme` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6851) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6871) | `link/tonal-pressed`／`text/theme`／`text/theme` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6854) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6874) | —／`border/disabled`／`border/disabled` [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6857) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6877) |
| Off | —／`border/primary`／— [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6860) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6880) | `link/tonal-hover`／`border/primary`／— [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6862) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6882) | `link/tonal-pressed`／`text/theme`／— [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6864) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6884) | —／`border/disabled`／— [M](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6866) · [S](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=69-6886) |

| Figma Variable Name | CSS |
| --- | --- |
| `border/disabled` | `var(--border-disabled)` |
| `border/primary` | `var(--border-primary)` |
| `border/theme` | `var(--border-theme)` |
| `link/tonal-hover` | `var(--link-tonal-hover)` |
| `link/tonal-pressed` | `var(--link-tonal-pressed)` |
| `text/primary` | `var(--text-primary)` |
| `text/theme` | `var(--text-theme)` |

## 5. 參考實作

先載入 T3 Design Tokens，再加入下列樣式。正式元件省略 `data-preview-state`，此屬性只供測試頁固定展示外觀。

```html
<fieldset>
  <legend>班次類型</legend>
  <label class="t3-radio-option text-body-s-bold">
    <span class="t3-radio" data-size="medium">
      <input class="t3-radio__input" type="radio" name="trip-type" value="regular" checked>
      <span class="t3-radio__ring" aria-hidden="true"><span class="t3-radio__dot"></span></span>
    </span>
    正線班次
  </label>
  <label class="t3-radio-option text-body-s-bold">
    <span class="t3-radio" data-size="medium">
      <input class="t3-radio__input" type="radio" name="trip-type" value="preparation">
      <span class="t3-radio__ring" aria-hidden="true"><span class="t3-radio__dot"></span></span>
    </span>
    整備班次
  </label>
</fieldset>
```

```css
.t3-radio {
  --radio-ring-size: 20px;
  --radio-dot-size: 10px;
  --radio-halo-outset: 4px;
  --radio-stroke: 1.2px;
  --radio-stroke-on: 1.5px;
  --radio-ring-color: var(--border-primary);
  --radio-dot-color: var(--text-theme);
  --radio-halo-color: transparent;
  position: relative;
  isolation: isolate;
  display: inline-grid;
  place-items: center;
  flex: none;
  inline-size: 24px;
  block-size: 24px;
  vertical-align: middle;
}
.t3-radio[data-size="small"] {
  --radio-ring-size: 14px;
  --radio-dot-size: 7px;
  --radio-halo-outset: 0px;
  --radio-stroke-on: 1.2px;
}
.t3-radio:has(.t3-radio__input:checked) {
  --radio-stroke: var(--radio-stroke-on);
  --radio-ring-color: var(--text-theme);
}
@media (hover: hover) {
  .t3-radio:where(:not([data-preview-state])):has(.t3-radio__input:hover:not(:disabled)) {
    --radio-halo-color: var(--link-tonal-hover);
  }
}
.t3-radio[data-preview-state="hover"] {
  --radio-halo-color: var(--link-tonal-hover);
}
.t3-radio[data-preview-state="pressed"],
.t3-radio:where(:not([data-preview-state])):has(.t3-radio__input:active:not(:disabled)) {
  --radio-halo-color: var(--link-tonal-pressed);
  --radio-ring-color: var(--text-theme);
}
.t3-radio:has(.t3-radio__input:disabled) {
  --radio-ring-color: var(--border-disabled);
  --radio-dot-color: var(--border-disabled);
  --radio-halo-color: transparent;
}
.t3-radio::before {
  position: absolute;
  inset: calc(-1 * var(--radio-halo-outset));
  z-index: -1;
  border-radius: 50%;
  background-color: var(--radio-halo-color);
  content: "";
  pointer-events: none;
}
.t3-radio__input {
  position: absolute;
  inset: 0;
  z-index: 1;
  inline-size: 100%;
  block-size: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.t3-radio__input:disabled { cursor: default; }
.t3-radio__ring {
  display: grid;
  place-items: center;
  inline-size: var(--radio-ring-size);
  block-size: var(--radio-ring-size);
  border-radius: 50%;
  box-shadow: inset 0 0 0 var(--radio-stroke) var(--radio-ring-color);
  pointer-events: none;
}
.t3-radio__dot {
  display: none;
  inline-size: var(--radio-dot-size);
  block-size: var(--radio-dot-size);
  border-radius: 50%;
  background-color: var(--radio-dot-color);
}
.t3-radio__input:checked + .t3-radio__ring .t3-radio__dot { display: block; }
.t3-radio__input:focus-visible + .t3-radio__ring {
  outline: 2px solid var(--border-theme);
  outline-offset: 2px;
}
.t3-radio-option {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding-block: 4px;
  color: var(--text-primary);
}
@media (forced-colors: active) {
  .t3-radio__ring { box-sizing: border-box; box-shadow: none; border: 1px solid ButtonText; }
  .t3-radio__dot { forced-color-adjust: none; background: ButtonText; }
  .t3-radio__input:disabled + .t3-radio__ring { border-color: GrayText; }
  .t3-radio__input:disabled + .t3-radio__ring .t3-radio__dot { background: GrayText; }
  .t3-radio__input:focus-visible + .t3-radio__ring { outline-color: Highlight; }
}
```

## 6. 驗收

| 操作 | 預期 |
| --- | --- |
| Medium 切換 Small | 操作區仍為 24 × 24px，內圈由 20px 變為 14px，On 圓點由 10px 變為 7px。 |
| On 與 Off 依序滑入、按下、放開 | Hover／Pressed 色環在 Medium 為 32px，在 Small 為 24px。Off 滑入沿用 `border/primary`，按下時描邊換為 `text/theme`。 |
| 點另一選項或用方向鍵切換 | 同組只有一項 On，事件只送出新選取值。 |
| 點擊可見標籤或按 Space | 操作原生 input，已選項目保持選取。 |
| 檢查 Disabled On／Off | 內圈用 `border/disabled`。On 同色圓點保留，Off 無圓點，操作不觸發變更。 |
