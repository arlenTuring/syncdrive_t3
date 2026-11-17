# T3 UI Kit｜Switch 工程開發文件

[Figma 元件集](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=70-13852) · [Figma 樣式與用法](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=240-23116) · [T3 Design Tokens](https://chatgpt.com/library?file_id=libfile_202bb92aeecc8191bf26b85338556396&account_id=personal)

## 1. 元件介面

母檔共 **2 種 Configuration × 2 種 Select × 3 種 State，12 個 Variant**。母件預設為 Basic／On／Default。應用程式的初始 On／Off 依頁面資料決定。

| 參數／事件 | 工程接法 |
| --- | --- |
| `configuration` | `basic` 或 `with-text`，輸出為 `data-configuration`。Basic 的 track 省略文字節點。 |
| `label` | With-Text 的可見文字，沿用 Figma 可替換的 Label Text。可及名稱應含可見文字，並在切換前後保持一致。Basic 用 `aria-label` 或外部標籤命名。 |
| `checked` | On／Off 對應 `a-switch` 的 `checked`。受控元件由頁面回寫。 |
| `disabled` | 傳入 `a-switch` 的 `disabled`，保留滑塊位置。 |
| `name`／`value` | 需要原生 FormData 時，在表單依 checked／disabled 同步隱藏欄位。 |
| `onCheckedChange(checked)` | 接收 `a-switch` 的 `change` 第一個參數。切換由元件的事件處理。 |

## 2. 尺寸

| Configuration | Default／Disabled | Pressed | 內部佈局 |
| --- | --- | --- | --- |
| Basic | 44 × 26px | 44 × 26px | 滑塊對側留白在 Default／Disabled 為 18px，Pressed 為 14px。 |
| With-Text | 母件樣本 65 × 26px | 母件樣本 65 × 26px | 文字寬度依內容。文字距滑塊 4px。文字側額外留白在 Default／Disabled 為 4px，Pressed 為 0px。 |

- 外框各側 padding 4px，外形採充分圓角，母檔半徑 1000px。滑塊 Default／Disabled 為 18 × 18px，Pressed 為 22 × 18px，母檔半徑 32px。
- 從左至右的版面中，On 的滑塊在右側、文字在左側。Off 左右對調。CSS 以邏輯方向定位，支援 RTL。
- With-Text 採 Hug。各狀態的寬度皆為「文字量測寬度 + 34px」。母件寬度為 65px 時，文字量測寬為 31px。採用頁面更換字串後依內容伸縮。
- 文字比照 `.text-body-xs`，Noto Sans TC 12px、字重 400、行高 16px、字距 0px。

## 3. 狀態與事件

**Disabled → Pressed → Default**。Pressed 僅表示按壓中的外觀，滑塊在放開或取消按壓時回復原寬。工程整合由 Ant Design Vue Switch 處理切換、鍵盤與 disabled。以 `@change` 接收新的 checked 值。以 `:focus-visible` 加上焦點外框，屬工程可及性處理。

Figma 的 State 包含 Default、Pressed、Disabled。滑入維持當前外觀。整個軌道的可點擊區由同一個控制項覆蓋，包含滑塊、文字與兩側留白。裝飾層不接收指標事件。Pressed 時軌道寬度保持一致。滑塊增加的 4px 由軌道內部留白吸收。

工程動態設定為 **200ms、`cubic-bezier(0.2, 0, 0, 1)`**。滑塊位置、按壓寬度、軌道顏色與文字位置連續過渡。快速反向切換時，CSS 由當下位置繼續過渡。軌道保留固定布局寬度。系統偏好減少動態時，動畫時間設為 0ms。

## 4. 狀態色矩陣

每格依序為 **軌道／滑塊／內嵌文字**。B、T 分別連到 Basic、With-Text 的 Figma 變體。Basic 的軌道與滑塊沿用同一組色票。

| Select | Default | Pressed | Disabled |
| --- | --- | --- | --- |
| On | `CTA/CTA`／`White/100%`／`White/100%` [B](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=70-13853) · [T](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=70-13862) | `CTA/CTA`／`White/100%`／`White/100%` [B](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=70-13856) · [T](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=70-13866) | `border/disabled`／`surface/disabled`／`text/disabled` [B](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=70-13859) · [T](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=70-13870) |
| Off | `border/primary`／`White/100%`／`White/100%` [B](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=70-13874) · [T](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=70-13883) | `border/primary`／`White/100%`／`White/100%` [B](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=70-13877) · [T](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=70-13887) | `border/disabled`／`surface/disabled`／`text/disabled` [B](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=70-13880) · [T](https://www.figma.com/design/OsaDhOsncK2eM8FE6aAMkF/Syncdrive-UI-Design-Kit?node-id=70-13891) |

| Figma Variable Name | CSS |
| --- | --- |
| `CTA/CTA` | `var(--cta)` |
| `White/100%` | `var(--color-white-100)` |
| `border/disabled` | `var(--border-disabled)` |
| `border/primary` | `var(--border-primary)` |
| `border/theme` | `var(--border-theme)` |
| `surface/disabled` | `var(--surface-disabled)` |
| `text/disabled` | `var(--text-disabled)` |

## 5. 參考實作

先載入 T3 Design Tokens。正式專案以 [Ant Design Vue Switch](https://antdv.com/components/switch) 作為操作元件，並使用相鄰的裝飾層呈現 Figma 外觀。範例假設專案已註冊 `a-switch`。CSS 放在元件的全域樣式，並確認自訂定位規則套用到實際按鈕。

```vue
<script setup>
import { ref } from "vue";

const checked = ref(true);
const disabled = ref(false);
</script>

<template>
  <span class="t3-switch" data-configuration="with-text">
    <a-switch class="t3-switch__input" :checked="checked"
              :disabled="disabled" aria-label="通知"
              @change="checked = $event" />
    <span class="t3-switch__track" aria-hidden="true">
      <span class="t3-switch__thumb"></span>
      <span class="t3-switch__label text-body-xs">通知</span>
    </span>
  </span>
</template>
```

Basic 將 `data-configuration` 設為 `basic`，並可省略文字層。下方原生範例供離線測試頁使用，同一份 CSS 透過 `:checked` 或 Ant Design Vue 控制項的 `aria-checked` 讀取狀態。`data-preview-state` 僅供固定變體樣本使用。

```html
<span class="t3-switch" data-configuration="with-text">
  <input class="t3-switch__input" type="checkbox" role="switch"
         aria-label="通知"
         name="notifications" value="enabled" checked>
  <span class="t3-switch__track" aria-hidden="true">
    <span class="t3-switch__thumb"></span>
    <span class="t3-switch__label text-body-xs">通知</span>
  </span>
</span>
```

```css
.t3-switch {
  --switch-duration: 200ms;
  --switch-easing: cubic-bezier(0.2, 0, 0, 1);
  position: relative;
  isolation: isolate;
  display: inline-flex;
  vertical-align: middle;
  flex: none;
}
.t3-switch > .t3-switch__input {
  position: absolute;
  inset: 0;
  z-index: 2;
  box-sizing: border-box;
  inline-size: 100%;
  min-inline-size: 0;
  block-size: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
}
.t3-switch__track {
  --switch-grow: 0px;
  --switch-label-shift: var(--switch-grow);
  position: relative;
  z-index: 0;
  pointer-events: none;
  box-sizing: border-box;
  display: inline-grid;
  align-items: center;
  flex: none;
  min-inline-size: 44px;
  block-size: 26px;
  border-radius: 999px;
  background-color: var(--border-primary);
  color: var(--color-white-100);
  transition: background-color var(--switch-duration) var(--switch-easing),
              color var(--switch-duration) var(--switch-easing);
}
.t3-switch__thumb {
  position: absolute;
  z-index: 1;
  inset-block-start: 4px;
  inset-inline-start: 4px;
  inline-size: calc(18px + var(--switch-grow));
  block-size: 18px;
  border-radius: 32px;
  background-color: var(--color-white-100);
  transition: inset-inline-start var(--switch-duration) var(--switch-easing),
              inline-size var(--switch-duration) var(--switch-easing),
              background-color var(--switch-duration) var(--switch-easing);
}
.t3-switch__label {
  position: relative;
  inset-inline-start: var(--switch-label-shift);
  justify-self: start;
  margin-inline: 26px 8px;
  white-space: nowrap;
  transition: inset-inline-start var(--switch-duration) var(--switch-easing);
}
.t3-switch[data-configuration="basic"] .t3-switch__label { display: none; }
.t3-switch__input:is(:checked, [aria-checked="true"]) + .t3-switch__track {
  --switch-label-shift: calc(-18px - var(--switch-grow));
  background-color: var(--cta);
}
.t3-switch__input:is(:checked, [aria-checked="true"]) + .t3-switch__track .t3-switch__thumb {
  inset-inline-start: calc(100% - 22px - var(--switch-grow));
}
.t3-switch__input:active:not(:disabled) + .t3-switch__track,
.t3-switch[data-preview-state="pressed"] .t3-switch__input:not(:disabled) + .t3-switch__track {
  --switch-grow: 4px;
}
.t3-switch > .t3-switch__input:disabled { cursor: default; }
.t3-switch__input:disabled + .t3-switch__track {
  background-color: var(--border-disabled);
  color: var(--text-disabled);
}
.t3-switch__input:disabled + .t3-switch__track .t3-switch__thumb {
  background-color: var(--surface-disabled);
}
.t3-switch__input:focus-visible + .t3-switch__track {
  outline: 2px solid var(--border-theme);
  outline-offset: 2px;
}
.t3-switch[data-preview-state] {
  --switch-duration: 0ms;
}
@media (prefers-reduced-motion: reduce) {
  .t3-switch { --switch-duration: 0ms; }
}
@media (forced-colors: active) {
  .t3-switch__track { outline: 1px solid ButtonText; color: ButtonText; background: Canvas; }
  .t3-switch__thumb { forced-color-adjust: none; background: ButtonText; }
  .t3-switch__input:is(:checked, [aria-checked="true"]) + .t3-switch__track .t3-switch__thumb { background: Highlight; }
  .t3-switch__input:disabled + .t3-switch__track { color: GrayText; outline-color: GrayText; }
  .t3-switch__input:disabled + .t3-switch__track .t3-switch__thumb { background: GrayText; }
  .t3-switch__input:focus-visible + .t3-switch__track { outline: 2px solid Highlight; }
}
```

## 6. 驗收

| 操作 | 預期結果 |
| --- | --- |
| Basic 按下再放開 | Track 維持 44 × 26px，滑塊寬度為 18px → 22px → 18px，對側留白為 18px → 14px → 18px。 |
| With-Text 更換文字 | Track 隨文字長度伸縮。按壓時文字距滑塊仍為 4px，文字側額外留白由 4px 改為 0px，Track 寬度保持一致。 |
| 切換 On／Off | 滑塊與文字位置互換，軌道切換為對應色，送出一次布林值。 |
| 快速連續切換與減少動態 | 反向切換從當下位置銜接，停下後滑塊距軌道邊緣 4px。開啟系統減少動態後直接到達終態。 |
| 點擊整個 Switch | Basic 與 With-Text 在 On／Off 各自測試左側、中央及右側，包含滑塊、文字與留白，每次點擊只切換一次。 |
| Disabled On／Off | 保留滑塊位置，套用停用色。滑鼠與鍵盤皆無變更事件。 |
| Tab、Space、滑入 | Tab 顯示焦點，Space 切換。滑入維持原本配色。 |
